import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computePendingMigrations, listLocalMigrations } from "./hosting-migrate.mjs";

describe("computePendingMigrations", () => {
  it("returns local files not present in the applied set, in the given (sorted) order", () => {
    const local = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];
    expect(computePendingMigrations(local, ["0001_a.sql"])).toEqual(["0002_b.sql", "0003_c.sql"]);
  });

  it("returns everything when nothing has been applied yet (a fresh project)", () => {
    const local = ["0001_a.sql", "0002_b.sql"];
    expect(computePendingMigrations(local, [])).toEqual(local);
  });

  it("returns nothing when everything is already applied", () => {
    const local = ["0001_a.sql", "0002_b.sql"];
    expect(computePendingMigrations(local, local)).toEqual([]);
  });

  it("ignores an applied filename that no longer exists locally", () => {
    expect(computePendingMigrations(["0002_b.sql"], ["0001_a.sql", "0002_b.sql"])).toEqual([]);
  });
});

describe("listLocalMigrations", () => {
  it("lists only .sql files, sorted by filename", () => {
    const dir = mkdtempSync(join(tmpdir(), "orderat-migrations-test-"));
    writeFileSync(join(dir, "0002_second.sql"), "-- second");
    writeFileSync(join(dir, "0001_first.sql"), "-- first");
    writeFileSync(join(dir, "README.md"), "not a migration");
    expect(listLocalMigrations(dir)).toEqual(["0001_first.sql", "0002_second.sql"]);
  });

  it("finds the real migration(s) this repo ships", () => {
    const files = listLocalMigrations();
    expect(files).toContain("0001_orderat_isolation.sql");
  });
});
