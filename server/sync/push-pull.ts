// The `sync` action's push + pull orchestration (docs/sme-phase-2-cloud.md's "Sync"): applies each
// incoming change under record-access.ts's permission rules, tracking conflicts and rejections, then
// pulls the next page of records and filters it the same way. Kept out of server/sync/handler.ts so
// this file can be unit-tested against a real (if WASM) Postgres without going through HTTP at all.

import type { SqlClient } from "../agent/postgres-store.ts";
import type { Member } from "./permissions.ts";
import { isPlainObject } from "./json-equal.ts";
import { canPull, decidePush, productAccess, type Entity, type PushDecision } from "./record-access.ts";
import { gatherProductFacts, planStockForOrder } from "./stock-apply.ts";
import { ledgerOf } from "./stock-ledger.ts";
import { namesAnyOrder } from "./stock-merge.ts";
import { findRecord, findRecordsByIds, pullRecords, resequenceRecordIfUnchanged, writeAtomic, writeRecordIfUnchanged, type AtomicWrite, type RecordRow } from "./store.ts";
import type { ChangeInput } from "./validate.ts";

export interface Conflict {
  entity: Entity;
  id: string;
  seq: number;
}

export interface Rejected {
  entity: Entity;
  id: string;
  reason: "forbidden";
  /** The server's current copy, so the phone can put its refused edit back exactly (there is no
   * "fetch one record" action). Absent when the record does not exist on the server yet, or when this
   * member may not see it (canPull) - then the phone should drop its local copy. */
  record?: { data: Record<string, unknown>; deleted: boolean; seq: number; updatedAt: string };
}

export interface PushResult {
  conflicts: Conflict[];
  rejected: Rejected[];
}

const PULL_PAGE_SIZE = 500;

/** How many times one change is read, decided and written before the push gives up (throws, so the
 * sync answers 500 and the phone retries it later). Each further attempt means yet another write to
 * this very record landed between this one's read and its write; with a handful of devices per shop,
 * even a second attempt is rare. */
const MAX_WRITE_ATTEMPTS = 5;

export interface PushOptions {
  /** The clock the server's own stock moves are stamped with (tests pin it). */
  now?: () => Date;
}

/**
 * Applies every change in `changes`, in order, each one atomically on its own record — not wrapped in
 * one all-or-nothing SQL transaction, because the spec's own unit of atomicity is a single record
 * ("the server applies each change in a transaction" reads, in context, as "each accepted change is
 * applied atomically", matching the per-record primary key every change targets); one change rejected
 * by permissions never blocks the rest of the batch from applying.
 *
 * Atomic per record (security retest 1 Oct 2026, R01): a change is read, checked (record-access.ts's
 * decidePush) and written as one unit. The write is a compare-and-swap on the seq that was read
 * (store.ts's writeRecordIfUnchanged), so it only lands on the very version it was decided on; when
 * another write got in between, the record is read and decided again. A `prepare` or `money` push
 * therefore merges its few fields onto the order as it is now — an owner's new total stays — and a push
 * onto a record that was deleted meanwhile is decided against the tombstone.
 *
 * A change whose `baseSeq` is behind the seq of the version it replaced (or, for a brand-new record,
 * any positive baseSeq at all — that can only mean the client thinks a server copy exists that doesn't)
 * is still applied (last writer wins) and reported in `conflicts` with that version's seq — also when
 * that version only appeared while this change was being applied.
 *
 * Order stock (third review, 3 Oct 2026, F1-F3): the orders of a batch are applied before the existing products
 * whose stock moves name them (the batch is otherwise applied in its own order), so such an order is on the
 * server when the move is judged (server/sync/stock-merge.ts), and an order's ledger has already moved the stock
 * of its products (server/sync/order-stock.ts) when the phone's own copy of that move arrives and is ignored.
 * Only those products move: customers and new products keep their place before the orders, because every
 * write draws a seq and the phones apply a pull in seq order (Android drops an order whose customer, and
 * leaves an order line unlinked from a product, that it does not have yet). Results are reported in the batch's
 * own order. An order write whose record carries a ledger, and a product write that has stock bookkeeping to
 * record, are single atomic units spanning several rows (store.ts writeAtomic) inside the same
 * compare-and-swap retry.
 *
 * Seq order of an order and its products (fourth review, R1): an installed Android app applies a pull in seq order and
 * keeps a null link for an order line whose product it has not got yet, so the products of an order must have lower seqs
 * than the order. The atomic write of an order draws its products' seqs first (sync_apply). The product a phone pushes
 * in the same batch is written after the order (above), so once the batch is done every order it wrote whose products
 * now have a higher seq is given a fresh seq again (orderAfterItsProducts), and a pull delivers the products first.
 * Conflicts are reported exactly as before: they are decided when each change is applied.
 */
export async function pushChanges(
  sql: SqlClient,
  shopId: string,
  member: Member,
  changes: ChangeInput[],
  updatedBy: string,
  options: PushOptions = {},
): Promise<PushResult> {
  const now = options.now ?? (() => new Date());
  const outcomes = new Array<AppliedChange>(changes.length);

  const later = await productsAfterTheirOrders(sql, shopId, changes);
  const sequence = [...changes.keys()].filter((i) => !later.has(i)).concat([...later.keys()]);
  const writtenOrders = new Map<string, RecordRow>();
  for (const index of sequence) {
    const outcome = await applyChange(sql, shopId, member, changes[index]!, updatedBy, now, later.get(index));
    outcomes[index] = outcome;
    if (outcome.written && changes[index]!.entity === "order" && !changes[index]!.deleted) writtenOrders.set(outcome.written.id, outcome.written);
  }
  // One order alone has its products' seqs below its own already (its atomic write); more than that needs a look.
  if (writtenOrders.size > 1 || (writtenOrders.size === 1 && changes.some((c) => c.entity === "product"))) {
    await orderAfterItsProducts(sql, shopId, [...writtenOrders.values()]);
  }

  const conflicts: Conflict[] = [];
  const rejected: Rejected[] = [];
  for (const outcome of outcomes) {
    if (outcome.rejected) rejected.push(outcome.rejected);
    if (outcome.conflict) conflicts.push(outcome.conflict);
  }
  return { conflicts, rejected };
}

/** The changes to apply after every other change of the batch (index -> the product's seq before the batch): the
 * pushes of EXISTING products whose stock moves name an order that is in the same batch (see pushChanges), in
 * batch order. The seq is what such a push is checked for a conflict against: the order written before it moves
 * the product's seq itself (the server's stock effect), which is not another phone's write. */
async function productsAfterTheirOrders(sql: SqlClient, shopId: string, changes: ChangeInput[]): Promise<Map<number, number>> {
  const orderIds = new Set(changes.filter((c) => c.entity === "order").map((c) => c.id));
  if (orderIds.size === 0) return new Map();
  const naming = [...changes.keys()].filter((i) => {
    const c = changes[i]!;
    return c.entity === "product" && !c.deleted && namesAnyOrder(c.data, orderIds);
  });
  if (naming.length === 0) return new Map();
  const existing = new Map((await findRecordsByIds(sql, shopId, "product", naming.map((i) => changes[i]!.id))).filter((r) => !r.deleted).map((r) => [r.id, r.seq]));
  return new Map(naming.filter((i) => existing.has(changes[i]!.id)).map((i) => [i, existing.get(changes[i]!.id)!]));
}

/** The product ids on an order's lines, each once (a line with no product, or with a product id that is not text, has none). */
function lineProductIds(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.filter(isPlainObject).map((line) => line.productId).filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** Gives each of these orders (as this batch wrote them) a fresh seq, nothing else of it touched, when a product on one of its
 * lines now has a higher seq: the product the phone pushed in the same batch (written after the order so its stock move is
 * judged against it), or a product another order of the batch moved. Only while the order is still as the batch left it: an
 * order another write changed since keeps that write and its seq (which is later than the products' anyway). */
async function orderAfterItsProducts(sql: SqlClient, shopId: string, orders: RecordRow[]): Promise<void> {
  const linked = new Map(orders.map((order) => [order.id, lineProductIds(order.data.items)]));
  const productIds = [...new Set([...linked.values()].flat())];
  if (productIds.length === 0) return;
  const seqs = new Map((await findRecordsByIds(sql, shopId, "product", productIds)).filter((record) => !record.deleted).map((record) => [record.id, record.seq]));
  for (const order of orders) {
    if (linked.get(order.id)!.some((productId) => (seqs.get(productId) ?? 0) > order.seq)) {
      await resequenceRecordIfUnchanged(sql, shopId, "order", order.id, order.seq);
    }
  }
}

/** What applying one change came to: a refusal, or the row as written (with the conflict it was written over, if any). */
interface AppliedChange {
  conflict?: Conflict;
  rejected?: Rejected;
  written?: RecordRow;
}

/** One change of pushChanges: read, decide and write, again from the read whenever the write finds the
 * record changed since. */
async function applyChange(
  sql: SqlClient,
  shopId: string,
  member: Member,
  change: ChangeInput,
  updatedBy: string,
  now: () => Date,
  seqBeforeBatch?: number,
): Promise<AppliedChange> {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const existing = await findRecord(sql, shopId, change.entity, change.id);
    const stored = existing ? { data: existing.data, deleted: existing.deleted } : undefined;

    // An existing live product takes the stock merge, judged against what the database says about its moves.
    const liveProduct = change.entity === "product" && !change.deleted && existing !== undefined && !existing.deleted;
    const stock = liveProduct && productAccess(member) !== "none" ? await gatherProductFacts(sql, shopId, change.id, existing.data, change.data) : undefined;
    const decision = decidePush(member, change.entity, change.id, change.data, change.deleted, stored, { stock });
    if (!decision.allowed) {
      // The server's copy goes back only to a member allowed to pull it; for anyone else, the phone
      // drops its local copy (docs/sme-phase-2-cloud.md "Sync").
      const visible = existing && canPull(member, change.entity, change.id);
      return {
        rejected: {
          entity: change.entity,
          id: change.id,
          reason: decision.reason,
          ...(visible ? { record: { data: existing.data, deleted: existing.deleted, seq: existing.seq, updatedAt: existing.updatedAt } } : {}),
        },
      };
    }

    const written = await writeDecision(sql, shopId, change, decision, existing, updatedBy, now().toISOString());
    if (!written) continue; // Another write landed since the read: decide again on the record as it is now.

    const previousSeq = seqBeforeBatch ?? existing?.seq ?? 0;
    return previousSeq > (change.baseSeq ?? 0) ? { conflict: { entity: change.entity, id: change.id, seq: previousSeq }, written } : { written };
  }
  throw new Error(`sync push: a ${change.entity} record kept changing while it was written (${MAX_WRITE_ATTEMPTS} attempts)`);
}

/** Writes an allowed decision: as one atomic unit with its stock bookkeeping when it has any (a product push that
 * applies, ignores or lists moves; an order whose ledger the products' stock must follow), as the plain
 * compare-and-swap of one record otherwise. Undefined when the record, or anything the decision read, moved. */
async function writeDecision(
  sql: SqlClient,
  shopId: string,
  change: ChangeInput,
  decision: Extract<PushDecision, { allowed: true }>,
  existing: RecordRow | undefined,
  updatedBy: string,
  at: string,
): Promise<RecordRow | undefined> {
  const plain = () => writeRecordIfUnchanged(sql, shopId, change.entity, change.id, decision.data, change.deleted, updatedBy, existing?.seq);
  const primary: AtomicWrite["primary"] = { entity: change.entity, id: change.id, expectSeq: existing?.seq, data: decision.data, deleted: change.deleted };
  const none: Omit<AtomicWrite, "primary"> = { deps: [], effects: [], orderStock: [], ops: [], listed: [] };

  const plan = decision.stock;
  if (change.entity === "product") {
    const bookkeeping = plan !== undefined && (plan.ops.length > 0 || plan.orderStock.length > 0 || plan.deps.length > 0 || plan.listed.length > 0);
    // Fourth review, R4: a product write that replaces a stored list of stock moves (a deletion, a product that comes back, a
    // push with no plan) goes through sync_apply as well, which records the moves the list holds before it is replaced.
    const replacesMoves = existing !== undefined && Array.isArray(existing.data.stockMoves) && existing.data.stockMoves.length > 0;
    if (!bookkeeping && !(plan === undefined && replacesMoves)) return plain();
    return writeAtomic(sql, shopId, updatedBy, {
      primary,
      ...none,
      deps: (plan?.deps ?? []).map((d) => ({ entity: "order" as const, id: d.orderId, seq: d.seq })),
      orderStock: plan?.orderStock ?? [],
      ops: (plan?.ops ?? []).map((o) => ({ opId: o.opId, productId: change.id, outcome: o.outcome })),
      listed: (plan?.listed ?? []).map((opId) => ({ opId, productId: change.id })),
    });
  }

  const ledger = change.entity === "order" && !change.deleted ? ledgerOf(decision.data) : undefined;
  if (ledger) {
    const stockPlan = await planStockForOrder(sql, shopId, change.id, decision.data, existing?.data, ledger, at);
    if (stockPlan.orderStock.length === 0) return plain();
    return writeAtomic(sql, shopId, updatedBy, { primary, ...none, effects: stockPlan.effects, orderStock: stockPlan.orderStock });
  }
  return plain();
}

export interface PullResult {
  changes: RecordRow[];
  cursor: number;
  more: boolean;
}

/**
 * The next page of records after `cursor`, filtered to what `member` may see (record-access.ts's
 * canPull, per entity and permission). A record left out is simply not sent — never turned into a
 * deletion — so a phone keeps whatever it already holds. The returned `cursor` always reflects the
 * highest seq considered on this page, even when some of those rows were filtered out for this
 * particular caller, so a filtered-out row is never re-fetched on the next call; when a later grant
 * makes such rows visible, members_update gives them a fresh seq (server/sync/handler.ts).
 */
export async function pullForMember(sql: SqlClient, shopId: string, member: Member, cursor: number): Promise<PullResult> {
  const page = await pullRecords(sql, shopId, cursor, PULL_PAGE_SIZE);
  const newCursor = page.length > 0 ? page[page.length - 1]!.seq : cursor;
  return { changes: page.filter((row) => canPull(member, row.entity, row.id)), cursor: newCursor, more: page.length === PULL_PAGE_SIZE };
}
