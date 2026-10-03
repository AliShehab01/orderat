// Final pre-deploy verification harness (3 Oct 2026): a shop on a real (WASM) Postgres behind the REAL HTTP handler
// (server/sync/handler.ts createSyncHandler), driven by simulated phones (phone.ts) that build the exact wire shapes the
// released and the new clients send. Nothing here reaches into the server's internals: requests go in as `Request`s with the
// session header, answers come back as parsed JSON, exactly like a phone sees them.

import type { SqlClient } from "../../agent/postgres-store.ts";
import { createSession, newSessionToken, upsertUser } from "../../auth/store.ts";
import { createSyncHandler, type SyncHandlerDeps } from "../handler.ts";
import type { Permissions } from "../permissions.ts";

export type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Answer {
  status: number;
  json: J;
}

export class Fleet {
  readonly shopId = crypto.randomUUID();
  /** The server's clock (it stamps its own stock moves with it, and counts the 60 syncs per minute by it). */
  clock = Date.parse("2026-10-03T09:00:00.000Z");
  /** Every request made, in order: [action, status]. */
  readonly requests: { action: string; status: number; changes: number; ms: number; queries: number }[] = [];
  /** SQL statements the server has run for this fleet so far: in production each one is a round trip to the database. */
  queries = 0;
  handler: (req: Request) => Promise<Response>;
  /** What the handler logged, content-free: handy to assert what the server did. */
  readonly logs: Record<string, unknown>[] = [];

  constructor(readonly sql: SqlClient, handler?: (req: Request) => Promise<Response>) {
    this.handler =
      handler ??
      createSyncHandler({
        sql: this.counting(sql),
        uploadPhoto: async () => true,
        getSignedPhotoUrl: async () => undefined,
        now: () => new Date(this.clock),
        log: (entry) => this.logs.push(entry),
      });
  }

  private counting(sql: SqlClient): SqlClient {
    return {
      query: <T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> => {
        this.queries += 1;
        return sql.query<T>(text, params);
      },
    };
  }

  /** Swaps the server for another build of the same handler (the frozen old server of old-server/, the new one): same database. */
  useHandler(create: (deps: SyncHandlerDeps) => (req: Request) => Promise<Response>): void {
    this.handler = create({ sql: this.counting(this.sql), uploadPhoto: async () => true, getSignedPhotoUrl: async () => undefined, now: () => new Date(this.clock), log: (entry) => this.logs.push(entry) });
  }

  /** Advances the server's clock; every call does it by itself, so the 60-per-minute limit never bites in a test. */
  tick(ms = 2000): void {
    this.clock += ms;
  }

  now(): string {
    return new Date(this.clock).toISOString();
  }

  async newUser(label: string): Promise<{ userId: string; session: string }> {
    const user = await upsertUser(this.sql, { id: crypto.randomUUID(), provider: "apple", providerSub: `${label}-${crypto.randomUUID()}` });
    const { token, tokenHash } = await newSessionToken();
    await createSession(this.sql, { tokenHash, userId: user.id, now: new Date(this.clock) });
    return { userId: user.id, session: token };
  }

  /** One request through the handler; never throws on a non-200 (the status is the answer). A handler that throws (an
   * uncaught error in the real Edge Function becomes a 500 with no body) is reported as status 500. */
  async call(session: string | undefined, body: unknown): Promise<Answer> {
    this.tick();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (session) headers["x-orderat-session"] = session;
    const action = typeof body === "object" && body !== null ? String((body as J).action) : "?";
    const changes = typeof body === "object" && body !== null && Array.isArray((body as J).changes) ? (body as J).changes.length : 0;
    const started = performance.now();
    const queriesBefore = this.queries;
    let answer: Answer;
    try {
      const res = await this.handler(new Request("https://example.test/orderat-sync", { method: "POST", headers, body: JSON.stringify(body) }));
      const text = await res.text();
      let json: J = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { unparsable: text };
      }
      answer = { status: res.status, json };
    } catch (error) {
      answer = { status: 500, json: { thrown: error instanceof Error ? error.message : String(error) } };
    }
    this.requests.push({ action, status: answer.status, changes, ms: performance.now() - started, queries: this.queries - queriesBefore });
    return answer;
  }

  /** Creates the shop for `ownerSession` (what "Upload this phone's shop" does first). */
  async createShop(ownerSession: string, name = "Sara's Cakes"): Promise<void> {
    const res = await this.call(ownerSession, { action: "create_shop", shopId: this.shopId, name });
    if (res.status !== 200) throw new Error(`create_shop failed: ${res.status} ${JSON.stringify(res.json)}`);
  }

  /** Invites a new account as staff with these flags (invite_create by the owner, invite_join, members_update). */
  async addStaff(ownerSession: string, label: string, permissions: Permissions): Promise<{ userId: string; session: string }> {
    const staff = await this.newUser(label);
    const invite = await this.call(ownerSession, { action: "invite_create", shopId: this.shopId });
    if (invite.status !== 200) throw new Error(`invite_create failed: ${invite.status}`);
    const joined = await this.call(staff.session, { action: "invite_join", code: invite.json.code });
    if (joined.status !== 200) throw new Error(`invite_join failed: ${joined.status} ${JSON.stringify(joined.json)}`);
    if (Object.values(permissions).some(Boolean)) {
      const set = await this.call(ownerSession, { action: "members_update", shopId: this.shopId, userId: staff.userId, permissions });
      if (set.status !== 200) throw new Error(`members_update failed: ${set.status}`);
    }
    return staff;
  }

  /** The server's own current copy of every record of the shop: entity/id -> { data, deleted, seq }. */
  async stored(): Promise<Map<string, { entity: string; id: string; data: J; deleted: boolean; seq: number }>> {
    const rows = await this.sql.query<{ entity: string; id: string; data: J; deleted: boolean; seq: string | number }>(
      `select entity, id, data, deleted, seq from orderat.records where shop_id = $1 order by seq`,
      [this.shopId],
    );
    return new Map(rows.map((r) => [`${r.entity}/${r.id}`, { entity: r.entity, id: r.id, data: r.data, deleted: r.deleted, seq: Number(r.seq) }]));
  }

  async storedData(entity: string, id: string): Promise<J> {
    const rows = await this.sql.query<{ data: J }>(`select data from orderat.records where shop_id = $1 and entity = $2 and id = $3`, [this.shopId, entity, id]);
    if (!rows[0]) throw new Error(`no ${entity}/${id} on the server`);
    return rows[0].data;
  }

  /** The counts of the bookkeeping tables of this shop: used to check that repeated identical syncs grow nothing. */
  async counts(): Promise<{ records: number; orderStock: number; stockOps: number; maxSeq: number; payloadBytes: number }> {
    const one = async (text: string) => Number((await this.sql.query<{ n: string | number }>(text, [this.shopId]))[0]!.n);
    return {
      records: await one(`select count(*) as n from orderat.records where shop_id = $1`),
      orderStock: await one(`select count(*) as n from orderat.order_stock where shop_id = $1`),
      stockOps: await one(`select count(*) as n from orderat.stock_ops where shop_id = $1`),
      maxSeq: await one(`select coalesce(max(seq), 0) as n from orderat.records where shop_id = $1`),
      payloadBytes: await one(`select coalesce(sum(length(data::text)), 0) as n from orderat.records where shop_id = $1`),
    };
  }
}
