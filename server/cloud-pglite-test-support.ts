// Shared PGlite (a real Postgres, compiled to WASM) bootstrap for every SME-phase-2 cloud test suite
// (server/auth/*.test.ts, server/sync/*.test.ts, server/parse/*.test.ts) — same approach as
// server/marketing-pglite-test-support.ts and server/ask/pglite-test-support.ts, pulled out to this
// top-level file (alongside server/test-setup.ts) since db/migrations/0004_cloud.sql's tables are
// shared by all three feature folders and no single one owns it. Applies 0001, 0002, 0003, 0004, 0005
// (web sessions' expires_at column), then 0006 (phone-to-web pairing) and 0007 (Sign in with Apple
// refresh tokens), the same order
// scripts/hosting-migrate.mjs applies them in (0004 assumes schema "orderat" and role "orderat_app"
// already exist from 0001, and is otherwise independent of 0002/0003's own tables; 0005 alters 0004's
// sessions table; 0006's web_pairings references 0004's users).
// One instance per process, truncated between tests — starting a fresh WASM instance per test is what
// made these suites slow before (see server/ask/pglite-test-support.ts's own note).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "./agent/postgres-store.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const MIGRATION_0001 = readFileSync(join(MIGRATIONS_DIR, "0001_orderat_isolation.sql"), "utf8");
const MIGRATION_0002 = readFileSync(join(MIGRATIONS_DIR, "0002_ai_usage.sql"), "utf8");
const MIGRATION_0003 = readFileSync(join(MIGRATIONS_DIR, "0003_marketing.sql"), "utf8");
const MIGRATION_0008 = readFileSync(join(MIGRATIONS_DIR, "0008_shop_payment_methods.sql"), "utf8");
const MIGRATION_0004 = readFileSync(join(MIGRATIONS_DIR, "0004_cloud.sql"), "utf8");
const MIGRATION_0005 = readFileSync(join(MIGRATIONS_DIR, "0005_web_sessions.sql"), "utf8");
const MIGRATION_0006 = readFileSync(join(MIGRATIONS_DIR, "0006_web_pairing.sql"), "utf8");
const MIGRATION_0007 = readFileSync(join(MIGRATIONS_DIR, "0007_apple_tokens.sql"), "utf8");

const CLOUD_TABLES = [
  "orderat.sessions",
  "orderat.sync_rate_limit",
  "orderat.web_pairings",
  "orderat.pair_start_rate_limit",
  "orderat.pair_approve_rate_limit",
  "orderat.apple_tokens",
  // shop_members/invites/records reference orderat.shops_cloud, so truncating shops_cloud must
  // cascade to them too — plain `truncate ... cascade` (rather than listing every dependent table)
  // keeps this list correct even if a later migration adds another table referencing shops_cloud.
  "orderat.shops_cloud",
  "orderat.shop_members",
  "orderat.invites",
  "orderat.records",
  // users has no incoming reference from the tables above once they're already truncated, but is
  // listed last anyway for readability (roughly "leaves first, root last").
  "orderat.users",
];

let dbPromise: Promise<InstanceType<typeof PGlite>> | undefined;

function getDb() {
  dbPromise ??= (async () => {
    const db = new PGlite();
    await db.exec(MIGRATION_0001);
    await db.exec(MIGRATION_0002);
    await db.exec(MIGRATION_0003);
    await db.exec(MIGRATION_0004);
    await db.exec(MIGRATION_0005);
    await db.exec(MIGRATION_0006);
    await db.exec(MIGRATION_0007);
    await db.exec(MIGRATION_0008);
    return db;
  })();
  return dbPromise;
}

/** A fresh-looking SqlClient backed by the shared PGlite instance, with every cloud table truncated
 * so each test starts with no rows. */
export async function createCloudTestSql(): Promise<SqlClient> {
  const db = await getDb();
  await db.exec(`truncate table ${CLOUD_TABLES.join(", ")} cascade;`);
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}
