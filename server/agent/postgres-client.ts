// Node SqlClient adapter (server/dev.ts), using the "postgres" npm package. The Deno equivalent
// (supabase/functions/_shared/db.ts) is a separate small file, not this one, because Deno resolves
// its own driver through an "npm:" specifier rather than node_modules — see that file's comment for
// why the two aren't shared beyond the SqlClient interface and PostgresStore they both feed.

import postgres from "postgres";
import type { SqlClient } from "./postgres-store.ts";

/** Supabase's pooler requires TLS; a local/dev Postgres usually doesn't have a cert configured at
 * all, so require ssl only when it's not localhost, rather than hardcoding one or the other. */
function sslModeFor(connectionString: string): "require" | false {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "localhost" || hostname === "127.0.0.1" ? false : "require";
  } catch {
    return "require";
  }
}

/** One client per process, created lazily on first use — never per request. `prepare: false` because
 * the transaction pooler (port 6543) doesn't support session-level prepared statements. `max: 5`
 * (well under orderat_app's CONNECTION LIMIT 10 from the migration) since server/dev.ts is a single
 * long-lived process that may field a handful of concurrent local requests, unlike an Edge Function
 * isolate, which only ever needs `max: 1`. */
export function createPostgresSqlClient(connectionString: string): SqlClient {
  const sql = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: sslModeFor(connectionString),
  });
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
  };
}
