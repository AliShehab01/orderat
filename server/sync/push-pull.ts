// The `sync` action's push + pull orchestration (docs/sme-phase-2-cloud.md's "Sync"): applies each
// incoming change under record-access.ts's permission rules, tracking conflicts and rejections, then
// pulls the next page of records and filters it the same way. Kept out of server/sync/handler.ts so
// this file can be unit-tested against a real (if WASM) Postgres without going through HTTP at all.

import type { SqlClient } from "../agent/postgres-store.ts";
import type { Member } from "./permissions.ts";
import { canPull, decidePush, type Entity } from "./record-access.ts";
import { findRecord, pullRecords, upsertRecord, type RecordRow } from "./store.ts";
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

/**
 * Applies every change in `changes`, in order, each as its own permission check + upsert — not
 * wrapped in one all-or-nothing SQL transaction, because the spec's own unit of atomicity is a single
 * record ("the server applies each change in a transaction" reads, in context, as "each accepted
 * change is applied atomically", matching the per-record primary key every change targets); one
 * change rejected by permissions never blocks the rest of the batch from applying.
 *
 * A change whose `baseSeq` is behind the record's *previous* seq (or, for a brand-new record, any
 * positive baseSeq at all — that can only mean the client thinks a server copy exists that doesn't)
 * is still applied (last writer wins) and reported in `conflicts`.
 */
export async function pushChanges(sql: SqlClient, shopId: string, member: Member, changes: ChangeInput[], updatedBy: string): Promise<PushResult> {
  const conflicts: Conflict[] = [];
  const rejected: Rejected[] = [];

  for (const change of changes) {
    const existing = await findRecord(sql, shopId, change.entity, change.id);
    const decision = decidePush(member, change.entity, change.id, change.data, change.deleted, existing?.data);
    if (!decision.allowed) {
      const visible = existing && canPull(member, change.entity);
      rejected.push({
        entity: change.entity,
        id: change.id,
        reason: decision.reason,
        ...(visible ? { record: { data: existing.data, deleted: existing.deleted, seq: existing.seq, updatedAt: existing.updatedAt } } : {}),
      });
      continue;
    }

    await upsertRecord(sql, shopId, change.entity, change.id, decision.data, change.deleted, updatedBy);

    const previousSeq = existing?.seq ?? 0;
    if (previousSeq > (change.baseSeq ?? 0)) {
      conflicts.push({ entity: change.entity, id: change.id, seq: previousSeq });
    }
  }

  return { conflicts, rejected };
}

export interface PullResult {
  changes: RecordRow[];
  cursor: number;
  more: boolean;
}

/**
 * The next page of records after `cursor`, filtered to what `member` may see (record-access.ts's
 * canPull — currently only "expense", gated on the `money` permission). The returned `cursor` always
 * reflects the highest seq considered on this page, even when some of those rows were filtered out
 * for this particular caller, so a filtered-out row is never re-fetched on the next call.
 */
export async function pullForMember(sql: SqlClient, shopId: string, member: Member, cursor: number): Promise<PullResult> {
  const page = await pullRecords(sql, shopId, cursor, PULL_PAGE_SIZE);
  const newCursor = page.length > 0 ? page[page.length - 1]!.seq : cursor;
  return { changes: page.filter((row) => canPull(member, row.entity)), cursor: newCursor, more: page.length === PULL_PAGE_SIZE };
}
