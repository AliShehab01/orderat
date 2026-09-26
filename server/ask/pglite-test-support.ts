// Shared PGlite (a real Postgres, compiled to WASM) bootstrap for the "Ask Orderat" test suites
// (limits.test.ts, handler.test.ts) — same approach as server/agent/postgres-store.test.ts, pulled
// out here because two test files need it. Runs 0001 then 0002 against one instance, the same order
// scripts/hosting-migrate.mjs applies them in (0002_ai_usage.sql assumes schema "orderat" and role
// "orderat_app" already exist). One instance per process, truncated between tests, for the same
// reason postgres-store.test.ts gives: starting a fresh WASM instance per test is what made these
// suites slow before.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "../agent/postgres-store.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations");
const MIGRATION_0001 = readFileSync(join(MIGRATIONS_DIR, "0001_orderat_isolation.sql"), "utf8");
const MIGRATION_0002 = readFileSync(join(MIGRATIONS_DIR, "0002_ai_usage.sql"), "utf8");

let dbPromise: Promise<InstanceType<typeof PGlite>> | undefined;

function getDb() {
  dbPromise ??= (async () => {
    const db = new PGlite();
    await db.exec(MIGRATION_0001);
    await db.exec(MIGRATION_0002);
    return db;
  })();
  return dbPromise;
}

/** A fresh-looking SqlClient backed by the shared PGlite instance, with `orderat.ai_usage` and
 * `orderat.ai_usage_daily` truncated so each test starts with no rows. */
export async function createAskUsageTestSql(): Promise<SqlClient> {
  const db = await getDb();
  await db.exec("truncate table orderat.ai_usage, orderat.ai_usage_daily;");
  return {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
}
