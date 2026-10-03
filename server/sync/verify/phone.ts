// A simulated phone (or browser) of a shop: its local records, its dirty bookkeeping and the sync round it runs against the
// REAL handler (fleet.ts). It builds the wire shapes of the released iOS 1.0 (Orderat/Data/CloudRecordMapping.swift and
// Store.swift at 54abcd9: orderPatch/productPatch, the stock and payment methods of Store, SyncEngine.syncNow with
// Store.applyPushResult / applyPulledChanges), and, with the profile switched, the behaviours the other clients differ in
// (docs/superpowers .../integrity-oct3-spec.md): a ledger `stockDeducted` and `removedPaymentIds` written by the new apps,
// payments deleted by absence on the released Android and the live web, move ids in the case each platform writes them,
// the order each platform pushes its entities in, and the pull strictness of an installed Android app (R1).
//
// The records are kept as canonical JSON (what is on the wire), so a field a client does not know is kept the way every
// client keeps it (iOS JSONValue.overlaying, Android and web raw copies): a pulled record replaces the local one whole, and a
// local edit changes only the fields the platform's own code touches.

import type { Fleet, J } from "./fleet.ts";

export type Kind = "ios1" | "iosNew" | "androidOld" | "androidNew" | "webOld" | "webNew";

export interface Profile {
  kind: Kind;
  idCase: "upper" | "lower";
  /** The new apps write the order's `stockDeducted` ledger on every stock transition. */
  ledger: boolean;
  /** How a payment deletion reaches the server: the released iOS leaves it out and logs `payment: "<amount>" -> "removed"`; the
   * released Android and the live web leave it out; the new apps also append its id to `removedPaymentIds`. */
  paymentRemoval: "history" | "absence" | "ids";
  /** iOS sorts its dirty keys ("order:..." before "product:..."); the others push in their own entity order (products first). */
  alphabetical: boolean;
  batch: number;
  /** New iOS (R2): a pulled record it skipped (edited mid-sync) never moves the base of the record. */
  keepBaseOfSkipped: boolean;
  /** An installed Android applies a pull in seq order: an order whose customer is not there yet is dropped, a line whose product
   * is not there yet keeps a null link (fourth review R1). */
  strictPull: boolean;
}

const PROFILES: Record<Kind, Profile> = {
  ios1: { kind: "ios1", idCase: "upper", ledger: false, paymentRemoval: "history", alphabetical: true, batch: 200, keepBaseOfSkipped: false, strictPull: false },
  iosNew: { kind: "iosNew", idCase: "upper", ledger: true, paymentRemoval: "ids", alphabetical: true, batch: 200, keepBaseOfSkipped: true, strictPull: false },
  androidOld: { kind: "androidOld", idCase: "lower", ledger: false, paymentRemoval: "absence", alphabetical: false, batch: 200, keepBaseOfSkipped: false, strictPull: true },
  androidNew: { kind: "androidNew", idCase: "lower", ledger: true, paymentRemoval: "ids", alphabetical: false, batch: 200, keepBaseOfSkipped: false, strictPull: false },
  webOld: { kind: "webOld", idCase: "lower", ledger: false, paymentRemoval: "absence", alphabetical: false, batch: 500, keepBaseOfSkipped: false, strictPull: false },
  webNew: { kind: "webNew", idCase: "lower", ledger: true, paymentRemoval: "ids", alphabetical: false, batch: 500, keepBaseOfSkipped: false, strictPull: false },
};

/** The entity order the non-iOS clients push in (the web's map.ENTITY_ORDER). */
const ENTITY_ORDER = ["shop", "customer", "product", "occasion", "order", "expense", "setting"];

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The checks Swift's JSONDecoder makes on a sync answer (CloudSyncClient.swift SyncResponse, PulledRecordChange, SyncConflict, SyncRejection,
 * SyncMembership): a key missing or of another type fails the whole decode (`decodingFailed`), and the round with it, for good. */
export function assertDecodableByIos(body: J, label = "phone"): void {
  const fail = (what: string): never => {
    throw new Error(`${label}: iOS could not decode the sync answer: ${what}`);
  };
  const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  const isStr = (v: unknown) => typeof v === "string";
  const isObj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!Array.isArray(body.changes)) fail("changes");
  for (const c of body.changes as J[]) {
    if (!isStr(c.entity) || !isStr(c.id) || !isObj(c.data) || typeof c.deleted !== "boolean" || !isInt(c.seq) || !isStr(c.updatedAt)) fail(`change ${JSON.stringify(c).slice(0, 200)}`);
  }
  if (!isInt(body.cursor)) fail("cursor");
  if (typeof body.more !== "boolean") fail("more");
  if (!Array.isArray(body.conflicts) || !(body.conflicts as J[]).every((c) => isStr(c.entity) && isStr(c.id) && isInt(c.seq))) fail("conflicts");
  if (!Array.isArray(body.rejected)) fail("rejected");
  for (const r of body.rejected as J[]) {
    if (!isStr(r.entity) || !isStr(r.id) || !isStr(r.reason)) fail("rejected entry");
    if (r.record !== undefined && !(isObj(r.record.data) && typeof r.record.deleted === "boolean" && isInt(r.record.seq) && isStr(r.record.updatedAt))) fail("rejected record");
  }
  if (body.membership !== undefined) {
    const m = body.membership as J;
    if (!isStr(m.role) || !isObj(m.permissions) || !["orders", "prepare", "money", "products"].every((k) => typeof m.permissions[k] === "boolean")) fail("membership");
  }
}
const DEDUCTED = new Set(["confirmed", "ready", "collected"]);
const isDeducted = (status: string) => DEDUCTED.has(status);

export interface RoundReport {
  ok: boolean;
  /** Statuses of the failed request, when `ok` is false. */
  failedStatus?: number;
  requests: number;
  pushed: number;
  conflicts: J[];
  rejected: J[];
  pulled: number;
  /** Every record this round's pulls delivered, in the order they came: `entity/id@seq`. */
  pulledKeys: string[];
}

export class SimPhone {
  readonly profile: Profile;
  /** The live local records by `entity:id`. */
  readonly records = new Map<string, { entity: string; id: string; data: J }>();
  cursor = 0;
  readonly dirty = new Set<string>();
  readonly seqs = new Map<string, number>();
  readonly rev = new Map<string, number>();
  readonly tombstones = new Map<string, { entity: string; id: string; data: J; baseSeq: number }>();
  /** The phone is attached to the cloud shop (before that nothing is marked dirty). */
  cloudOn = false;
  online = true;
  /** Shop-wide stock tracking switch of this phone (the shop record's stock.enabled, which it reads from the pulled shop). */
  stockEnabled = true;
  /** What a strict (Android) pull dropped or left unlinked: the records an installed Android app would lose for good. */
  readonly droppedByPull: string[] = [];
  readonly nulledLinks: string[] = [];
  /** Every `rejected` answer this phone ever got (a rejection of an owner's change is always a bug). */
  readonly allRejected: J[] = [];
  readonly allConflicts: J[] = [];
  readonly failures: number[] = [];
  /** Hook: runs once, right after the first request of a round is answered and before the answer is applied: an edit made
   * "while the sync call was in flight". */
  duringRound?: () => void;

  constructor(readonly fleet: Fleet, readonly session: string, kind: Kind, readonly label: string = kind) {
    this.profile = PROFILES[kind];
  }

  // ------------------------------------------------------------------ ids and time
  newId(): string {
    const id = crypto.randomUUID();
    return this.profile.idCase === "upper" ? id.toUpperCase() : id;
  }
  now(): string {
    return this.fleet.now();
  }
  private key(entity: string, id: string): string {
    return `${entity}:${id}`;
  }

  // ------------------------------------------------------------------ local records
  get(entity: string, id: string): J {
    const r = this.records.get(this.key(entity, id));
    if (!r) throw new Error(`${this.label}: no local ${entity} ${id}`);
    return r.data;
  }
  all(entity: string): { id: string; data: J }[] {
    return [...this.records.values()].filter((r) => r.entity === entity).map((r) => ({ id: r.id, data: r.data }));
  }
  private put(entity: string, id: string, data: J): void {
    this.records.set(this.key(entity, id), { entity, id, data });
  }
  markDirty(entity: string, id: string): void {
    if (!this.cloudOn) return;
    const k = this.key(entity, id);
    this.dirty.add(k);
    this.rev.set(k, (this.rev.get(k) ?? 0) + 1);
  }

  /** A local delete (iOS Store.deleteMenuItem and friends): the record goes at once, a tombstone with its last data stays pending. */
  deleteRecord(entity: string, id: string): void {
    const k = this.key(entity, id);
    const r = this.records.get(k);
    if (!r) throw new Error(`${this.label}: no local ${entity} ${id}`);
    this.records.delete(k);
    if (!this.cloudOn) return;
    this.dirty.delete(k);
    this.rev.set(k, (this.rev.get(k) ?? 0) + 1);
    this.tombstones.set(k, { entity, id, data: clone(r.data), baseSeq: this.seqs.get(k) ?? 0 });
  }

  // ------------------------------------------------------------------ the shop's own records (iOS CloudRecordMapping)
  createShop(shopId: string, extra: J = {}): void {
    this.put("shop", shopId, {
      nameAr: "كيكس سارة", nameEn: "Sara's Cakes", phone: "+97333000000", currencyCode: "BHD", pickupHours: null, dailyCapacity: null,
      businessType: "home", vat: { enabled: false, trn: "", rateBps: 0, pricesIncludeVat: true }, stock: { enabled: true }, createdAt: this.now(), ...extra,
    });
    this.markDirty("shop", shopId);
  }

  createCustomer(name: string, phone: string): string {
    const id = this.newId();
    this.put("customer", id, { name, phone, area: null, notes: null, createdAt: this.now() });
    this.markDirty("customer", id);
    return id;
  }

  createProduct(input: { name: string; priceMinor: number; costMinor?: number; track: boolean; stock?: number; low?: number }): string {
    const id = this.newId();
    this.put("product", id, {
      nameAr: input.name, nameEn: null, aliases: [], priceMinor: input.priceMinor, costMinor: input.costMinor ?? 0, dailyCapacity: null, active: true, photoId: null,
      trackStock: input.track, stockQuantity: input.stock ?? 0, lowStockThreshold: input.low ?? 0, stockMoves: [], createdAt: this.now(),
    });
    this.markDirty("product", id);
    return id;
  }

  editProduct(id: string, patch: J): void {
    Object.assign(this.get("product", id), patch);
    this.markDirty("product", id);
  }

  // ------------------------------------------------------------------ orders (iOS Store.createOrder / updateStatus / ...)
  createOrder(input: { customerId: string; lines: { productId: string | null; name: string; qty: number; priceMinor: number; costMinor?: number }[]; deliveryFeeMinor?: number; notes?: string | null }): string {
    const id = this.newId();
    this.put("order", id, {
      customerId: input.customerId, status: "newOrder", fulfillmentType: "pickup", dueAt: this.now(),
      address: { area: null, block: null, road: null, building: null, notes: null }, deliveryFeeMinor: input.deliveryFeeMinor ?? 0, paymentStatus: "unpaid",
      items: input.lines.map((l) => ({ id: this.newId(), productId: l.productId, nameSnapshot: l.name, quantity: l.qty, unitPriceMinor: l.priceMinor, unitCostMinor: l.costMinor ?? 0 })),
      payments: [], changes: [{ id: this.newId(), field: "order", oldValue: null, newValue: "created", note: null, at: this.now() }],
      notes: input.notes ?? null, vatRateBps: null, vatIncluded: null, vatMinor: null, invoiceNumber: null, invoiceIdentifier: null, createdAt: this.now(), updatedAt: this.now(),
    });
    // The new apps write a ledger only once the order takes stock; a new order carries none yet.
    this.markDirty("order", id);
    return id;
  }

  total(order: J): number {
    const lines = (order.items as J[]).reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0) + (order.deliveryFeeMinor ?? 0);
    return lines + (order.vatIncluded === false ? order.vatMinor ?? 0 : 0);
  }
  paid(order: J): number {
    return (order.payments as J[]).reduce((s, p) => s + p.amountMinor, 0);
  }
  private recomputePaymentStatus(order: J, note: string | null = null): void {
    const paid = this.paid(order);
    const status = paid <= 0 ? "unpaid" : paid >= this.total(order) ? "paid" : "deposit";
    if (order.paymentStatus === status) return;
    order.changes.push({ id: this.newId(), field: "paymentStatus", oldValue: order.paymentStatus, newValue: status, note, at: this.now() });
    order.paymentStatus = status;
  }

  private tracked(productId: string): boolean {
    const r = this.records.get(this.key("product", productId));
    return !!r && r.data.trackStock === true;
  }

  /** Product stock move (Store.adjustStock): quantity changes, the move goes first, the list keeps 50; the product is dirty. */
  adjustStock(productId: string, delta: number, reason: string, orderId: string | null = null, note: string | null = null): void {
    const r = this.records.get(this.key("product", productId));
    if (!r || delta === 0) return;
    r.data.stockQuantity = (r.data.stockQuantity ?? 0) + delta;
    r.data.stockMoves = [{ id: this.newId(), delta, reason, orderId, note, at: this.now() }, ...(r.data.stockMoves ?? [])].slice(0, 50);
    this.markDirty("product", productId);
  }

  adjustStockManually(productId: string, delta: number, reason: "received" | "damaged" | "correction", note: string | null = null): void {
    this.adjustStock(productId, delta, reason, null, note);
  }

  private unitsByProduct(items: J[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const i of items) if (i.productId) m.set(i.productId, (m.get(i.productId) ?? 0) + i.quantity);
    return m;
  }

  /** The ledger of a legacy order, derived from the products' moves (the new apps' rule). */
  private ledgerFromMoves(orderId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.all("product")) {
      let net = 0;
      for (const m of (p.data.stockMoves ?? []) as J[]) if (m.orderId === orderId && ["orderConfirmed", "orderEdited", "orderCancelled"].includes(m.reason)) net += m.delta;
      if (net < 0) out[p.id] = -net;
    }
    return out;
  }

  setStatus(orderId: string, status: string, note: string | null = null): void {
    const order = this.get("order", orderId);
    const old = order.status as string;
    if (old === status) return;
    const was = isDeducted(old), will = isDeducted(status);
    if (was !== will) {
      if (this.profile.ledger) {
        if (will) {
          const ledger: Record<string, number> = {};
          for (const [pid, qty] of [...this.unitsByProduct(order.items)].sort(([a], [b]) => (a < b ? -1 : 1))) {
            if (qty > 0 && this.stockEnabled && this.tracked(pid)) {
              this.adjustStock(pid, -qty, "orderConfirmed", orderId);
              ledger[pid] = qty;
            }
          }
          order.stockDeducted = ledger;
        } else {
          const ledger: Record<string, number> = order.stockDeducted ?? this.ledgerFromMoves(orderId);
          for (const [pid, qty] of Object.entries(ledger).sort(([a], [b]) => (a < b ? -1 : 1))) if (qty > 0) this.adjustStock(pid, qty, "orderCancelled", orderId);
          order.stockDeducted = {};
        }
      } else if (this.stockEnabled) {
        // The released apps (iOS Store.applyStockForStatusChange): every line of a tracked product, gated on the shop switch.
        for (const item of order.items as J[]) {
          if (!item.productId || !this.tracked(item.productId)) continue;
          this.adjustStock(item.productId, (will ? -1 : 1) * item.quantity, will ? "orderConfirmed" : "orderCancelled", orderId);
        }
      }
    }
    order.status = status;
    order.updatedAt = this.now();
    order.changes.push({ id: this.newId(), field: "status", oldValue: old, newValue: status, note, at: this.now() });
    this.markDirty("order", orderId);
  }

  /** "Edit items" (Store.updateOrderDetails): the lines replaced wholesale, stock follows while the order holds stock. */
  editItems(orderId: string, lines: { id?: string; productId: string | null; name: string; qty: number; priceMinor: number; costMinor?: number }[], notes?: string | null): void {
    const order = this.get("order", orderId);
    const items = lines.map((l) => ({ id: l.id ?? this.newId(), productId: l.productId, nameSnapshot: l.name, quantity: l.qty, unitPriceMinor: l.priceMinor, unitCostMinor: l.costMinor ?? 0 }));
    const itemsChanged = JSON.stringify(order.items) !== JSON.stringify(items);
    if (isDeducted(order.status)) {
      const oldUnits = this.unitsByProduct(order.items), newUnits = this.unitsByProduct(items);
      if (this.profile.ledger) {
        const ledger: Record<string, number> = { ...(order.stockDeducted ?? this.ledgerFromMoves(orderId)) };
        for (const pid of new Set([...oldUnits.keys(), ...newUnits.keys()])) {
          const change = (newUnits.get(pid) ?? 0) - (oldUnits.get(pid) ?? 0);
          if (change === 0) continue;
          if (pid in ledger) {
            this.adjustStock(pid, -change, "orderEdited", orderId);
            const next = ledger[pid]! + change;
            if (next > 0) ledger[pid] = next;
            else delete ledger[pid];
          } else if ((oldUnits.get(pid) ?? 0) === 0 && this.stockEnabled && this.tracked(pid)) {
            this.adjustStock(pid, -(newUnits.get(pid) ?? 0), "orderEdited", orderId);
            ledger[pid] = newUnits.get(pid) ?? 0;
          }
        }
        order.stockDeducted = ledger;
      } else if (this.stockEnabled) {
        for (const pid of new Set([...oldUnits.keys(), ...newUnits.keys()])) {
          if (!this.tracked(pid)) continue;
          const delta = (newUnits.get(pid) ?? 0) - (oldUnits.get(pid) ?? 0);
          if (delta !== 0) this.adjustStock(pid, -delta, "orderEdited", orderId);
        }
      }
    }
    order.items = items;
    if (notes !== undefined) order.notes = notes;
    order.updatedAt = this.now();
    if (itemsChanged) order.changes.push({ id: this.newId(), field: "items", oldValue: null, newValue: "edited", note: null, at: this.now() });
    this.recomputePaymentStatus(order);
    this.markDirty("order", orderId);
  }

  setNotes(orderId: string, notes: string): void {
    const order = this.get("order", orderId);
    order.notes = notes;
    order.updatedAt = this.now();
    this.markDirty("order", orderId);
  }

  recordPayment(orderId: string, amountMinor: number, method = "cash", note: string | null = null): string {
    const order = this.get("order", orderId);
    const id = this.newId();
    order.payments.push({ id, amountMinor, method, note, paidAt: this.now() });
    this.recomputePaymentStatus(order, note);
    order.updatedAt = this.now();
    this.markDirty("order", orderId);
    return id;
  }

  removePayment(orderId: string, paymentId: string): void {
    const order = this.get("order", orderId);
    const index = (order.payments as J[]).findIndex((p) => p.id === paymentId);
    if (index < 0) throw new Error(`${this.label}: no payment ${paymentId}`);
    const [removed] = (order.payments as J[]).splice(index, 1);
    if (this.profile.paymentRemoval === "history") {
      // iOS 1.0 Store.removePayment
      order.changes.push({ id: this.newId(), field: "payment", oldValue: String(removed.amountMinor), newValue: "removed", note: null, at: this.now() });
    }
    if (this.profile.paymentRemoval === "ids") {
      const ids: string[] = Array.isArray(order.removedPaymentIds) ? order.removedPaymentIds : [];
      if (!ids.some((x) => x.toLowerCase() === paymentId.toLowerCase())) order.removedPaymentIds = [...ids, paymentId];
    }
    this.recomputePaymentStatus(order);
    order.updatedAt = this.now();
    this.markDirty("order", orderId);
  }

  // ------------------------------------------------------------------ the sync round (SyncEngine.syncNow)
  /** The first upload: every record dirty (Store.markEverythingDirtyForInitialUpload). */
  attach(): void {
    this.cloudOn = true;
    this.dirty.clear();
    for (const r of this.records.values()) {
      const k = this.key(r.entity, r.id);
      this.dirty.add(k);
      this.rev.set(k, (this.rev.get(k) ?? 0) + 1);
    }
  }

  /** The changes still waiting, in the order and the batches this platform sends them. */
  plan(): J[][] {
    const keys = [...this.dirty].filter((k) => this.records.has(k));
    if (this.profile.alphabetical) keys.sort();
    else {
      const rank = (k: string) => {
        const i = ENTITY_ORDER.indexOf(k.slice(0, k.indexOf(":")));
        return i < 0 ? ENTITY_ORDER.length : i;
      };
      keys.sort((a, b) => rank(a) - rank(b)); // stable: a platform's own insertion order within one entity
    }
    const changes: J[] = keys.map((k) => {
      const r = this.records.get(k)!;
      return { entity: r.entity, id: r.id, data: clone(r.data), deleted: false, baseSeq: this.seqs.get(k) ?? 0 };
    });
    for (const t of this.tombstones.values()) changes.push({ entity: t.entity, id: t.id, data: clone(t.data), deleted: true, baseSeq: t.baseSeq });
    const batches: J[][] = [];
    for (let i = 0; i < changes.length; i += this.profile.batch) batches.push(changes.slice(i, i + this.profile.batch));
    return batches;
  }

  /** Runs one syncNow: every pending batch, then pull pages while `more`, up to 5 passes while new work arrives. */
  async sync(): Promise<RoundReport> {
    const report: RoundReport = { ok: true, requests: 0, pushed: 0, conflicts: [], rejected: [], pulled: 0, pulledKeys: [] };
    if (!this.online) return { ...report, ok: false, failedStatus: 0 };
    let passes = 5;
    for (;;) {
      const snapshot = new Map(this.rev);
      const batches = this.plan();
      let more = false;
      const send = async (changes: J[], unsent: J[]): Promise<boolean> => {
        const answer = await this.request(changes, unsent, snapshot, report);
        if (!answer) return false;
        more = answer.more === true;
        return true;
      };
      if (batches.length === 0) {
        if (!(await send([], []))) return report;
      } else {
        for (let i = 0; i < batches.length; i++) {
          const unsent = batches.slice(i + 1).flat();
          if (!(await send(batches[i]!, unsent))) return report;
        }
      }
      while (more) if (!(await send([], []))) return report;
      passes -= 1;
      if (passes <= 0 || this.plan().length === 0) break;
    }
    return report;
  }

  /** One pull request with nothing to push (a client paging): the answer's page is applied and the cursor moves on. */
  async pullOnePage(): Promise<{ report: RoundReport; body: J | undefined }> {
    const report: RoundReport = { ok: true, requests: 0, pushed: 0, conflicts: [], rejected: [], pulled: 0, pulledKeys: [] };
    const body = await this.request([], [], new Map(this.rev), report);
    return { report, body };
  }

  private async request(changes: J[], unsent: J[], snapshot: Map<string, number>, report: RoundReport): Promise<J | undefined> {
    const answer = await this.fleet.call(this.session, { action: "sync", shopId: this.fleet.shopId, cursor: this.cursor, changes });
    report.requests += 1;
    report.pushed += changes.length;
    if (answer.status !== 200) {
      report.ok = false;
      report.failedStatus = answer.status;
      this.failures.push(answer.status);
      return undefined;
    }
    const body = answer.json;
    assertDecodableByIos(body, this.label);
    // The edit made while the call was in flight, before its answer is applied.
    const hook = this.duringRound;
    this.duringRound = undefined;
    hook?.();
    report.conflicts.push(...(body.conflicts ?? []));
    report.rejected.push(...(body.rejected ?? []));
    this.allConflicts.push(...(body.conflicts ?? []));
    this.allRejected.push(...(body.rejected ?? []));
    this.applyPushResult(changes, body.rejected ?? [], snapshot);
    this.applyPulled(body.changes ?? [], snapshot, unsent, report);
    this.cursor = body.cursor;
    return body;
  }

  private revisionChanged(k: string, snapshot: Map<string, number>): boolean {
    return (this.rev.get(k) ?? 0) !== (snapshot.get(k) ?? 0);
  }

  /** Store.applyPushResult: accepted changes are no longer dirty; a rejected one is put back to the server's copy. */
  private applyPushResult(sent: J[], rejected: J[], snapshot: Map<string, number>): void {
    const rejectedKeys = new Set(rejected.map((r) => this.key(r.entity, r.id)));
    for (const c of sent) {
      const k = this.key(c.entity, c.id);
      if (rejectedKeys.has(k) || this.revisionChanged(k, snapshot)) continue;
      this.dirty.delete(k);
      this.tombstones.delete(k);
    }
    for (const r of rejected) {
      const k = this.key(r.entity, r.id);
      if (this.revisionChanged(k, snapshot)) continue;
      this.dirty.delete(k);
      this.tombstones.delete(k);
      if (!r.record) this.records.delete(k);
      else {
        this.seqs.set(k, r.record.seq);
        if (r.record.deleted) this.records.delete(k);
        else this.put(r.entity, r.id, clone(r.record.data));
      }
    }
  }

  /** Store.applyPulledChanges (and, for a strict Android, the in-order reference resolution of its pull). */
  private applyPulled(changes: J[], snapshot: Map<string, number>, unsent: J[], report: RoundReport): void {
    const unsentKeys = new Set(unsent.map((c) => this.key(c.entity, c.id)));
    for (const c of changes) {
      const k = this.key(c.entity, c.id);
      report.pulled += 1;
      report.pulledKeys.push(`${c.entity}/${c.id}@${c.seq}`);
      const stale = this.revisionChanged(k, snapshot) || unsentKeys.has(k);
      if (!(stale && this.profile.keepBaseOfSkipped)) this.seqs.set(k, c.seq);
      if (stale) continue;
      this.dirty.delete(k);
      this.tombstones.delete(k);
      if (c.deleted) {
        this.records.delete(k);
        continue;
      }
      const data = clone(c.data) as J;
      if (this.profile.strictPull && c.entity === "order") {
        if (data.customerId && !this.records.has(this.key("customer", data.customerId))) {
          this.droppedByPull.push(k);
          continue;
        }
        for (const item of (data.items ?? []) as J[]) {
          if (item.productId && !this.records.has(this.key("product", item.productId))) {
            this.nulledLinks.push(`${k}->${item.productId}`);
            item.productId = null;
          }
        }
      }
      this.put(c.entity, c.id, data);
      if (c.entity === "shop") this.stockEnabled = data.stock?.enabled === true;
    }
  }

  // ------------------------------------------------------------------ what the phone shows
  /** The comparable summary of what this phone holds: stock, statuses, payments. */
  view(): { products: Record<string, J>; orders: Record<string, J> } {
    const products: Record<string, J> = {};
    for (const p of this.all("product")) products[p.id] = { stock: p.data.stockQuantity, name: p.data.nameAr, price: p.data.priceMinor, moves: (p.data.stockMoves ?? []).length };
    const orders: Record<string, J> = {};
    for (const o of this.all("order")) {
      orders[o.id] = {
        status: o.data.status, paymentStatus: o.data.paymentStatus,
        units: [...this.unitsByProduct(o.data.items)].sort().map(([p, q]) => `${p}:${q}`),
        payments: (o.data.payments as J[]).map((p) => `${p.id.toLowerCase()}:${p.amountMinor}`).sort(),
      };
    }
    return { products, orders };
  }

  /** A deep copy of every local record, by `entity/id`: for comparing two phones, or a phone and the server. */
  snapshot(): Map<string, J> {
    return new Map([...this.records.values()].map((r) => [`${r.entity}/${r.id}`, clone(r.data)]));
  }
}
