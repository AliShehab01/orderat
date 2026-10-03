// FROZEN FIXTURE (final verification, 3 Oct 2026): this file is server/sync/push-pull.ts exactly as it is on origin/main (c07cc28),
// the server code deployed before the integrity rounds of 3 Oct, except that the relative imports of the other server folders
// point one level deeper. It is used only by ../migration-0010.test.ts to seed a database through the OLD code path before
// migration 0010 is applied. Do not edit it and do not import it from production code.
// The `sync` action's push + pull orchestration (docs/sme-phase-2-cloud.md's "Sync"): applies each
// incoming change under record-access.ts's permission rules, tracking conflicts and rejections, then
// pulls the next page of records and filters it the same way. Kept out of server/sync/handler.ts so
// this file can be unit-tested against a real (if WASM) Postgres without going through HTTP at all.

import type { SqlClient } from "../../../agent/postgres-store.ts";
import type { Member } from "./permissions.ts";
import { canPull, decidePush, type Entity } from "./record-access.ts";
import { findRecord, pullRecords, writeRecordIfUnchanged, type RecordRow } from "./store.ts";
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
 */
export async function pushChanges(sql: SqlClient, shopId: string, member: Member, changes: ChangeInput[], updatedBy: string): Promise<PushResult> {
  const conflicts: Conflict[] = [];
  const rejected: Rejected[] = [];

  for (const change of changes) {
    const outcome = await applyChange(sql, shopId, member, change, updatedBy);
    if (outcome.rejected) rejected.push(outcome.rejected);
    if (outcome.conflict) conflicts.push(outcome.conflict);
  }

  return { conflicts, rejected };
}

/** One change of pushChanges: read, decide and write, again from the read whenever the write finds the
 * record changed since. */
async function applyChange(sql: SqlClient, shopId: string, member: Member, change: ChangeInput, updatedBy: string): Promise<{ conflict?: Conflict; rejected?: Rejected }> {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const existing = await findRecord(sql, shopId, change.entity, change.id);
    const stored = existing ? { data: existing.data, deleted: existing.deleted } : undefined;
    const decision = decidePush(member, change.entity, change.id, change.data, change.deleted, stored);
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

    const written = await writeRecordIfUnchanged(sql, shopId, change.entity, change.id, decision.data, change.deleted, updatedBy, existing?.seq);
    if (!written) continue; // Another write landed since the read: decide again on the record as it is now.

    const previousSeq = existing?.seq ?? 0;
    return previousSeq > (change.baseSeq ?? 0) ? { conflict: { entity: change.entity, id: change.id, seq: previousSeq } } : {};
  }
  throw new Error(`sync push: a ${change.entity} record kept changing while it was written (${MAX_WRITE_ATTEMPTS} attempts)`);
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
