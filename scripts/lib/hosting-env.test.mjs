import { describe, expect, it } from "vitest";
import { extractRows } from "./hosting-env.mjs";

describe("extractRows", () => {
  it("reads the rows field of the Supabase CLI's JSON object", () => {
    const cli = { boundary: "abc", rows: [{ filename: "0001_a.sql" }], warning: "untrusted data" };
    expect(extractRows(cli)).toEqual([{ filename: "0001_a.sql" }]);
  });

  it("still accepts a bare array", () => {
    expect(extractRows([{ exists: true }])).toEqual([{ exists: true }]);
  });

  it("fails loudly on an unknown shape instead of treating it as 'no rows'", () => {
    expect(() => extractRows({ message: "error" })).toThrow(/rows/);
  });
});
