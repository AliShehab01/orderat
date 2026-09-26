import { describe, expect, it } from "vitest";
import { validateCampaignsQuery } from "./validate";

function urlWith(query: string): URL {
  return new URL(`https://x.supabase.co/functions/v1/orderat-campaigns${query}`);
}

describe("validateCampaignsQuery", () => {
  it("accepts no params at all", () => {
    expect(validateCampaignsQuery(urlWith(""))).toEqual({ ok: true, query: { country: undefined, today: undefined } });
  });

  it("accepts a valid GCC country", () => {
    expect(validateCampaignsQuery(urlWith("?country=BH"))).toEqual({ ok: true, query: { country: "BH", today: undefined } });
  });

  it("rejects a country outside the GCC six", () => {
    expect(validateCampaignsQuery(urlWith("?country=EG"))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a lowercase country code", () => {
    expect(validateCampaignsQuery(urlWith("?country=bh"))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("accepts a valid today date", () => {
    expect(validateCampaignsQuery(urlWith("?today=2026-09-26"))).toEqual({ ok: true, query: { country: undefined, today: "2026-09-26" } });
  });

  it("rejects a malformed today date", () => {
    expect(validateCampaignsQuery(urlWith("?today=26-09-2026"))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects an impossible calendar date", () => {
    expect(validateCampaignsQuery(urlWith("?today=2026-02-30"))).toEqual({ ok: false, error: "invalid_body" });
  });

  it("accepts both params together", () => {
    expect(validateCampaignsQuery(urlWith("?country=SA&today=2026-09-26"))).toEqual({ ok: true, query: { country: "SA", today: "2026-09-26" } });
  });
});
