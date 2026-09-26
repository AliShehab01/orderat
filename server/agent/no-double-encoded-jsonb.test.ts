// Guard: the hosted functions use postgres.js, which JSON-encodes values bound to jsonb-typed
// parameters. PostgresStore passes JSON.stringify(...) strings, so "$n::jsonb" would store order
// items/changes double-encoded (a JSON string). Found live in the founder platform; bind JSON text as
// "$n::text::jsonb". PGlite does not reproduce the driver behaviour, hence this source-level check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("jsonb parameters", () => {
  it("are always bound as text then cast (never $n::jsonb)", () => {
    const offenders = tsFiles(join(__dirname, "..")).filter((f) => /\$\d+::jsonb|"::jsonb"/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
