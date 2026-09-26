import { describe, expect, it } from "vitest";
import type { Campaign, StudioStyle } from "./content";
import { createCampaignsHandler } from "./handler";

const STYLE_WHITE: StudioStyle = {
  id: "white", name: { ar: "أبيض", en: "White" }, emoji: "⬜", swatch: "#FFFFFF", previewUrl: null, occasion: null,
  prompt: "SECRET-SERVER-ONLY-PROMPT-TEXT",
};
const STYLE_TEACHERS: StudioStyle = {
  id: "teachers_day", name: { ar: "يوم المعلم", en: "Teacher's Day" }, emoji: "🍎", swatch: "#E4572E", previewUrl: null, occasion: "teachers_day",
  prompt: "ANOTHER-SECRET-PROMPT",
};

const TEACHERS: Campaign = {
  id: "teachers-day-2026", occasion: "teachers_day", name: { ar: "يوم المعلم", en: "Teachers' Day" }, emoji: "🍎",
  countries: ["BH", "SA"], startDate: "2026-10-05", endDate: "2026-10-05", promoteFrom: "2026-09-21", accent: "#E4572E",
  headline: { ar: "ع", en: "H" }, tips: { ar: [], en: [] }, productIdeas: { ar: [], en: [] },
  captions: { ar: [], en: [] }, hashtags: { ar: [], en: [] }, studioStyles: ["teachers_day", "white"],
};
const NATIONAL: Campaign = {
  ...TEACHERS, id: "bahrain-national-day-2026", countries: ["BH"], startDate: "2026-12-16", endDate: "2026-12-17", promoteFrom: "2026-12-01",
};

function makeHandler(now = new Date("2026-09-26T12:00:00Z")) {
  return createCampaignsHandler({ campaigns: [TEACHERS, NATIONAL], styles: [STYLE_WHITE, STYLE_TEACHERS], version: "test-1", now: () => now, log: () => {} });
}

function req(query = "", init: RequestInit = {}): Request {
  return new Request(`https://x.supabase.co/functions/v1/orderat-campaigns${query}`, init);
}

describe("createCampaignsHandler", () => {
  it("returns every in-window campaign and the full style catalog, with a cache header", async () => {
    const handler = makeHandler();
    const res = await handler(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json() as { version: string; campaigns: Campaign[]; studioStyles: unknown[] };
    expect(body.version).toBe("test-1");
    // Both are in-window on 2026-09-26: teachers-day-2026 hasn't ended yet, and national's
    // promoteFrom (Dec 1) is within the 120-day promotion horizon (which reaches to ~Jan 24 2027).
    expect(body.campaigns.map((c) => c.id)).toEqual(["teachers-day-2026", "bahrain-national-day-2026"]);
    expect(body.studioStyles).toHaveLength(2);
  });

  it("drops a campaign once its promoteFrom is further out than the 120-day horizon", async () => {
    // From 2026-07-01 (+120 days = 2026-10-29), teachers-day-2026's promoteFrom (Sep 21) is still
    // within the horizon, but national's (Dec 1) is not, so only teachers-day-2026 comes back.
    const handler = makeHandler(new Date("2026-07-01T00:00:00Z"));
    const res = await handler(req());
    const body = await res.json() as { campaigns: Campaign[] };
    expect(body.campaigns.map((c) => c.id)).toEqual(["teachers-day-2026"]);
  });

  it("filters by country", async () => {
    const handler = makeHandler(new Date("2026-11-01T00:00:00Z"));
    const res = await handler(req("?country=SA"));
    const body = await res.json() as { campaigns: Campaign[] };
    // teachers-day-2026 has already ended by Nov 1; national's promoteFrom (Dec 1) is also outside
    // Nov 1 + 120 days is fine, but national's countries is ["BH"] only, so filtering by SA drops it.
    expect(body.campaigns).toEqual([]);
  });

  it("filters by an explicit today query param instead of the server clock", async () => {
    const handler = makeHandler(new Date("2020-01-01T00:00:00Z")); // server clock says something else entirely
    const res = await handler(req("?today=2026-12-01"));
    const body = await res.json() as { campaigns: Campaign[] };
    expect(body.campaigns.map((c) => c.id)).toEqual(["bahrain-national-day-2026"]);
  });

  it("never includes a style's server-only prompt in the response", async () => {
    const handler = makeHandler();
    const res = await handler(req());
    const text = await res.text();
    expect(text).not.toContain("SECRET-SERVER-ONLY-PROMPT-TEXT");
    expect(text).not.toContain("ANOTHER-SECRET-PROMPT");
    expect(text).not.toContain("prompt");
  });

  it("returns 400 invalid_body for a bad country code", async () => {
    const handler = makeHandler();
    const res = await handler(req("?country=EG"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("returns 400 invalid_body for a non-GET request", async () => {
    const handler = makeHandler();
    const res = await handler(req("", { method: "POST" }));
    expect(res.status).toBe(400);
  });

  it("answers an allowed CORS preflight without reaching the campaign logic", async () => {
    const handler = makeHandler();
    const res = await handler(req("", { method: "OPTIONS", headers: { origin: "https://alishehab01.github.io" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://alishehab01.github.io");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("reflects an allowed Origin on the real GET response", async () => {
    const handler = makeHandler();
    const res = await handler(req("", { headers: { origin: "http://localhost:5173" } }));
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("never logs anything beyond counts/status", async () => {
    const logs: Record<string, unknown>[] = [];
    const handler = createCampaignsHandler({ campaigns: [TEACHERS], styles: [STYLE_WHITE], version: "v1", now: () => new Date("2026-09-26T00:00:00Z"), log: (e) => logs.push(e) });
    await handler(req());
    expect(logs).toEqual([{ event: "campaigns", status: 200, country: "all", count: 1 }]);
  });
});
