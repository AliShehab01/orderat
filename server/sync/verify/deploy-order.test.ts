// Final verification: what the deploy order does and does not break. The documented order is the migration first, then
// orderat-sync. If the function goes out before the migration, the requests that need 0010 (a product push with stock bookkeeping,
// an order that carries a ledger, an invite claim) fail with 500 until it is applied, and nothing is lost: the phones keep
// everything dirty, the plain requests (uploads, pulls, payments, statuses of released apps) keep working, and the moment the
// migration lands everything goes through once.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "../../agent/postgres-store.ts";
import { Fleet } from "./fleet.ts";
import { SimPhone } from "./phone.ts";

// These tests build real shops on a WASM Postgres; under a loaded machine (the whole suite, three workers) they take several times longer.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db", "migrations");
const FILES = ["0001_orderat_isolation.sql", "0002_ai_usage.sql", "0003_marketing.sql", "0004_cloud.sql", "0005_web_sessions.sql", "0006_web_pairing.sql", "0007_apple_tokens.sql", "0008_shop_payment_methods.sql", "0009_ai_trusted_limits.sql", "0010_order_stock.sql"];
const sqlOf = (name: string) => readFileSync(join(DIR, name), "utf8");

let db: InstanceType<typeof PGlite>;
let sql: SqlClient;
let fleet: Fleet;

beforeAll(async () => {
  db = new PGlite();
  for (const name of FILES.slice(0, 9)) await db.exec(sqlOf(name));
  sql = { async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> { return (await db.query<T>(text, params)).rows; } };
  fleet = new Fleet(sql); // the NEW server, on a database that has not had 0010 yet
});

afterAll(async () => {
  await db?.close();
});

describe("the new function deployed before the migration", () => {
  it("uploads and pulls work, the stock bookkeeping fails with 500 and heals when the migration is applied; nothing is lost or applied twice", async () => {
    const owner = await fleet.newUser("owner");
    const A = new SimPhone(fleet, owner.session, "ios1", "A");
    A.createShop(fleet.shopId);
    const customer = A.createCustomer("Sara", "1");
    const product = A.createProduct({ name: "Cake", priceMinor: 1000, track: true, stock: 10 });
    await fleet.createShop(owner.session);
    A.attach();
    const upload = await A.sync();
    expect(upload.ok, "a first upload needs none of 0010").toBe(true);
    expect(upload.rejected).toEqual([]);

    // A day's work: a new order with a payment (plain writes), then a confirm (a product push with a move: needs 0010).
    const o = A.createOrder({ customerId: customer, lines: [{ productId: product, name: "Cake", qty: 3, priceMinor: 1000 }] });
    A.recordPayment(o, 1000);
    expect((await A.sync()).ok, "an order with a payment is a plain write").toBe(true);
    A.setStatus(o, "confirmed");
    const failed = await A.sync();
    expect(failed.ok).toBe(false);
    expect(failed.failedStatus).toBe(500);
    expect(A.dirty.size, "everything the phone could not send stays dirty").toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) expect((await A.sync()).failedStatus, "and it keeps failing the same way, harmlessly").toBe(500);
    // A phone with nothing to push still pulls.
    const B = new SimPhone(fleet, owner.session, "ios1", "B");
    B.cloudOn = true;
    expect((await B.sync()).ok).toBe(true);
    expect(B.get("order", o).paymentStatus).toBe("deposit");

    // The migration lands (the founder applies it): the very next sync goes through, once.
    await db.exec(sqlOf(FILES[9]!));
    const healed = await A.sync();
    expect(healed.ok).toBe(true);
    expect(healed.rejected).toEqual([]);
    expect((await fleet.storedData("product", product)).stockQuantity).toBe(7);
    expect((await A.sync()).pushed).toBe(0);
    expect((await B.sync()).ok).toBe(true);
    expect(B.get("product", product).stockQuantity).toBe(7);
    expect(B.get("order", o).status).toBe("confirmed");
    expect((await fleet.storedData("order", o)).payments).toHaveLength(1);
  });
});
