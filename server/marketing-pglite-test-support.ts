// Shared PGlite (a real Postgres, compiled to WASM) bootstrap for every marketing-tools test suite
// (server/usage/feature-limits.test.ts, server/campaigns/*.test.ts, server/studio/*.test.ts,
// server/shop/*.test.ts) — same approach as server/ask/pglite-test-support.ts, pulled out to this
// top-level file (alongside server/test-setup.ts) rather than into any one feature folder, since
// db/migrations/0003_marketing.sql's tables are shared by all of them and no single feature owns it.
// Applies 0001, 0002, then 0003, in the same order scripts/hosting-migrate.mjs applies them in (0002
// and 0003 both assume schema "orderat" and role "orderat_app" already exist from 0001). One instance
// per process, truncated between tests — starting a fresh WASM instance per test is what made these
// suites slow before (see server/ask/pglite-test-support.ts's own note).

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

const MARKETING_TABLES = [
  "orderat.feature_usage",
  "orderat.feature_usage_daily",
  // shop_photos/shop_orders/shop_views_daily reference orderat.shops, so truncating shops must
  // cascade to them too — plain `truncate ... cascade` (rather than listing every dependent table)
  // keeps this list correct even if a later migration adds another table referencing shops.
  "orderat.shops",
  "orderat.shop_photos",
  "orderat.shop_orders",
  "orderat.shop_views_daily",
];

let dbPromise: Promise<InstanceType<typeof PGlite>> | undefined;

function getDb() {
  dbPromise ??= (async () => {
    const db = new PGlite();
    await db.exec(MIGRATION_0001);
    await db.exec(MIGRATION_0002);
    await db.exec(MIGRATION_0003);
    await db.exec(MIGRATION_0008); // shops.payment_methods
    return db;
  })();
  return dbPromise;
}

/** A fresh-looking SqlClient backed by the shared PGlite instance, with every marketing table
 * truncated so each test starts with no rows. */
export async function createMarketingTestSql(): Promise<SqlClient> {
  const db = await getDb();
  await db.exec(`truncate table ${MARKETING_TABLES.join(", ")} cascade;`);
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}
