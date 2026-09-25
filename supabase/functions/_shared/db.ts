// Deno SqlClient adapter for the hosted Edge Functions, using the "postgres" npm package (via a
// pinned "npm:" specifier — Deno resolves this itself, no supabase/functions/deno.json entry or
// node_modules needed) rather than @supabase/supabase-js: Orderat talks to Postgres directly as the
// least-privilege "orderat_app" role over the transaction pooler, never through PostgREST or a
// Supabase-wide service role key (see db/migrations/0001_orderat_isolation.sql and
// server/agent/postgres-store.ts). This file's Node twin is server/agent/postgres-client.ts; the two
// aren't shared beyond the SqlClient interface because Deno resolves its driver via "npm:", not
// node_modules, so a single implementation can't import the same way from both runtimes.

import postgres from "npm:postgres@3.4.9";
import type { SqlClient } from "../../../server/agent/postgres-store.ts";

// One client per isolate: module-level state in a Deno Edge Function isolate is reused across every
// request the isolate handles (it's only ever re-run when a fresh isolate is spun up), so creating
// the client here — once, lazily, on first call — and reusing it is what avoids opening a new pool
// per request. `postgres()` itself doesn't open a TCP connection; that happens lazily on the first
// query, which is also why it's safe to call even before ORDERAT_DATABASE_URL is validated.
let cached: SqlClient | undefined;

export function getSqlClient(connectionString: string): SqlClient {
  if (cached) return cached;
  if (!connectionString) {
    // Defer the failure to the first real query (a clear error there) rather than throwing during
    // module init, which would take the whole isolate down before it can even log which secret is
    // missing.
    cached = {
      query() {
        return Promise.reject(new Error("ORDERAT_DATABASE_URL is not set"));
      },
    };
    return cached;
  }
  // prepare:false — the transaction pooler (port 6543) doesn't support session-level prepared
  // statements. max:1 — one Edge Function isolate handles one request at a time, so a pool bigger
  // than one connection would just sit idle and eat into orderat_app's CONNECTION LIMIT 10.
  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",
  });
  cached = {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
  };
  return cached;
}
