import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore, type SqlClient } from "./postgres-store.ts";
import { describeOrderStoreContract } from "./order-store.contract.ts";

const MIGRATION_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations", "0001_orderat_isolation.sql");
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");

/**
 * One PGlite instance (a real Postgres, compiled to WASM) for this whole file, migrated once with
 * the actual db/migrations/0001_orderat_isolation.sql — this is what proves that file works, not
 * just that PostgresStore's queries are syntactically plausible against some mock. PGlite is a
 * single implicit connection with no separate roles to connect as, so this does not exercise
 * orderat_app's privilege separation (NOLOGIN, grants, RLS-as-owner-bypass) — only a real project
 * can prove that; everything about the *shape* of the schema and every query PostgresStore runs
 * against it is covered here. Starting a fresh WASM instance per test (there are ~20, across two
 * contract runs) is what made this suite slow/flaky before; reusing one instance and truncating
 * between tests keeps each test isolated at a fraction of the cost.
 */
let dbPromise: Promise<InstanceType<typeof PGlite>> | undefined;
function getDb() {
  dbPromise ??= (async () => {
    const db = new PGlite();
    await db.exec(MIGRATION_SQL);
    return db;
  })();
  return dbPromise;
}

async function createPgliteStore(): Promise<PostgresStore> {
  const db = await getDb();
  await db.exec("truncate table orderat.orders, orderat.processed_messages;");
  const sql: SqlClient = {
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
  };
  return new PostgresStore(sql);
}

describeOrderStoreContract("PostgresStore (PGlite)", createPgliteStore);
