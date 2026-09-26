// Validates the real content/campaigns.json + content/studio-styles.json against
// docs/marketing-tools.md's rules (this is the safety net the spec calls for: "A unit test validates
// every entry"), plus unit tests for the pure helpers content.ts exports. The JSON here is imported
// the plain Node/vitest way (esbuild's built-in JSON loader, resolveJsonModule in tsconfig) — the
// Deno-specific `with { type: "json" }` import lives only in the two Edge Function index.ts files
// that actually get deployed; see content.ts's header for why that split exists.

import { describe, expect, it } from "vitest";
import campaignsFile from "../../content/campaigns.json";
import studioStylesFile from "../../content/studio-styles.json";
import {
  filterCampaigns,
  findCampaignById,
  findStyleById,
  isValidDateString,
  toPublicStyle,
  todayInRiyadh,
  validateMarketingContent,
  type Campaign,
  type StudioStyle,
} from "./content";

describe("the real content files", () => {
  it("pass every validation rule with no issues", () => {
    const issues = validateMarketingContent({ campaigns: campaignsFile, styles: studioStylesFile });
    expect(issues).toEqual([]);
  });

  it("have at least the two sample campaigns and eight studio styles", () => {
    expect(campaignsFile.campaigns.length).toBeGreaterThanOrEqual(2);
    expect(studioStylesFile.styles.length).toBeGreaterThanOrEqual(8);
  });

  it("never expose a style's prompt through toPublicStyle", () => {
    for (const style of studioStylesFile.styles as StudioStyle[]) {
      const pub = toPublicStyle(style) as Record<string, unknown>;
      expect(pub).not.toHaveProperty("prompt");
      expect(JSON.stringify(pub)).not.toContain(style.prompt.slice(0, 20));
    }
  });

  it("every campaign's studioStyles reference a style that actually exists", () => {
    const ids = new Set((studioStylesFile.styles as StudioStyle[]).map((s) => s.id));
    for (const c of campaignsFile.campaigns as Campaign[]) {
      for (const styleId of c.studioStyles) expect(ids.has(styleId)).toBe(true);
    }
  });
});

describe("validateMarketingContent", () => {
  const baseStyle = {
    id: "white", name: { ar: "أبيض", en: "White" }, emoji: "⬜", swatch: "#FFFFFF", previewUrl: null, occasion: null, prompt: "a prompt",
  };
  const baseCampaign = {
    id: "camp-1", occasion: "teachers_day", name: { ar: "ع", en: "N" }, emoji: "🍎", countries: ["BH"],
    startDate: "2026-10-05", endDate: "2026-10-05", promoteFrom: "2026-09-21", accent: "#E4572E",
    headline: { ar: "ع", en: "H" }, tips: { ar: ["a"], en: ["a"] }, productIdeas: { ar: ["a"], en: ["a"] },
    captions: { ar: ["مرحبا {shop}"], en: ["hi {shop}"] }, hashtags: { ar: ["#a"], en: ["#a"] }, studioStyles: ["white"],
  };

  it("accepts a minimal valid bundle", () => {
    expect(validateMarketingContent({ campaigns: { version: "v1", campaigns: [baseCampaign] }, styles: { styles: [baseStyle] } })).toEqual([]);
  });

  it("flags a missing top-level version", () => {
    const issues = validateMarketingContent({ campaigns: { campaigns: [] }, styles: { styles: [] } });
    expect(issues.some((i) => i.includes('"version"'))).toBe(true);
  });

  it("flags a campaign missing both languages of a bilingual field", () => {
    const bad = { ...baseCampaign, headline: { ar: "فقط" } };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("headline"))).toBe(true);
  });

  it("flags an invalid calendar date (Feb 30)", () => {
    const bad = { ...baseCampaign, endDate: "2026-02-30" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("YYYY-MM-DD"))).toBe(true);
  });

  it("flags promoteFrom after startDate", () => {
    const bad = { ...baseCampaign, promoteFrom: "2026-10-06" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("promoteFrom <= startDate"))).toBe(true);
  });

  it("flags startDate after endDate", () => {
    const bad = { ...baseCampaign, startDate: "2026-10-06", endDate: "2026-10-05" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("promoteFrom <= startDate"))).toBe(true);
  });

  it("flags a studioStyles id that doesn't exist", () => {
    const bad = { ...baseCampaign, studioStyles: ["no-such-style"] };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("unknown studio style"))).toBe(true);
  });

  it("flags a non-hex accent", () => {
    const bad = { ...baseCampaign, accent: "orange" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("accent"))).toBe(true);
  });

  it("flags a country code outside the GCC six", () => {
    const bad = { ...baseCampaign, countries: ["EG"] };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("countries"))).toBe(true);
  });

  it("flags a caption placeholder that isn't in the allowed set", () => {
    const bad = { ...baseCampaign, captions: { ar: ["مرحبا {unknown}"], en: ["hi {shop}"] } };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [bad] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes('unknown placeholder "{unknown}"'))).toBe(true);
  });

  it("accepts every allowed caption placeholder", () => {
    const ok = { ...baseCampaign, captions: { ar: ["{shop} {item} {price} {link} {date}"], en: ["{shop} {item} {price} {link} {date}"] } };
    expect(validateMarketingContent({ campaigns: { version: "v1", campaigns: [ok] }, styles: { styles: [baseStyle] } })).toEqual([]);
  });

  it("flags a duplicate campaign id", () => {
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [baseCampaign, baseCampaign] }, styles: { styles: [baseStyle] } });
    expect(issues.some((i) => i.includes("duplicate campaign id"))).toBe(true);
  });

  it("flags a duplicate style id", () => {
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [] }, styles: { styles: [baseStyle, baseStyle] } });
    expect(issues.some((i) => i.includes("duplicate style id"))).toBe(true);
  });

  it("flags a style with an empty emoji", () => {
    const bad = { ...baseStyle, emoji: "" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [] }, styles: { styles: [bad] } });
    expect(issues.some((i) => i.includes('"emoji"'))).toBe(true);
  });

  it("flags a style with a non-hex swatch", () => {
    const bad = { ...baseStyle, swatch: "white" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [] }, styles: { styles: [bad] } });
    expect(issues.some((i) => i.includes('"swatch"'))).toBe(true);
  });

  it("accepts a null previewUrl and flags a non-https one", () => {
    expect(validateMarketingContent({ campaigns: { version: "v1", campaigns: [] }, styles: { styles: [baseStyle] } })).toEqual([]);
    const bad = { ...baseStyle, previewUrl: "http://insecure.example.com/a.jpg" };
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [] }, styles: { styles: [bad] } });
    expect(issues.some((i) => i.includes("previewUrl"))).toBe(true);
  });

  it("flags a style missing its server-only prompt", () => {
    const bad: Record<string, unknown> = { ...baseStyle };
    delete bad.prompt;
    const issues = validateMarketingContent({ campaigns: { version: "v1", campaigns: [] }, styles: { styles: [bad] } });
    expect(issues.some((i) => i.includes('"prompt"'))).toBe(true);
  });
});

describe("isValidDateString", () => {
  it("accepts a real calendar date", () => expect(isValidDateString("2026-09-26")).toBe(true));
  it("rejects Feb 30", () => expect(isValidDateString("2026-02-30")).toBe(false));
  it("rejects a malformed string", () => expect(isValidDateString("2026/09/26")).toBe(false));
  it("rejects a non-string", () => expect(isValidDateString(20260926)).toBe(false));
  it("accepts Feb 29 on a leap year", () => expect(isValidDateString("2028-02-29")).toBe(true));
  it("rejects Feb 29 on a non-leap year", () => expect(isValidDateString("2026-02-29")).toBe(false));
});

describe("filterCampaigns", () => {
  const teachers: Campaign = {
    id: "teachers", occasion: "teachers_day", name: { ar: "ع", en: "Teachers" }, emoji: "🍎", countries: ["BH", "SA"],
    startDate: "2026-10-05", endDate: "2026-10-05", promoteFrom: "2026-09-21", accent: "#E4572E",
    headline: { ar: "ع", en: "H" }, tips: { ar: [], en: [] }, productIdeas: { ar: [], en: [] },
    captions: { ar: [], en: [] }, hashtags: { ar: [], en: [] }, studioStyles: ["white"],
  };
  const national: Campaign = {
    ...teachers, id: "national", countries: ["BH"], startDate: "2026-12-16", endDate: "2026-12-17", promoteFrom: "2026-12-01",
  };

  it("keeps a campaign whose window includes today", () => {
    expect(filterCampaigns([teachers], { today: "2026-09-26" }).map((c) => c.id)).toEqual(["teachers"]);
  });

  it("drops a campaign whose endDate is before today", () => {
    expect(filterCampaigns([teachers], { today: "2026-10-06" })).toEqual([]);
  });

  it("drops a campaign whose promoteFrom is more than 120 days out", () => {
    // national's promoteFrom is 2026-12-01; from 2026-07-01 that's more than 120 days away.
    expect(filterCampaigns([national], { today: "2026-07-01" })).toEqual([]);
  });

  it("keeps a campaign right at the 120-day promotion horizon", () => {
    expect(filterCampaigns([national], { today: "2026-08-03" }).map((c) => c.id)).toEqual(["national"]);
  });

  it("filters by country when given", () => {
    expect(filterCampaigns([teachers, national], { today: "2026-09-26", country: "SA" }).map((c) => c.id)).toEqual(["teachers"]);
  });

  it("keeps every country's campaigns when none is given", () => {
    expect(filterCampaigns([teachers, national], { today: "2026-09-26" }).map((c) => c.id).sort()).toEqual(["national", "teachers"]);
  });

  it("sorts the result by startDate ascending", () => {
    expect(filterCampaigns([national, teachers], { today: "2026-09-26" }).map((c) => c.id)).toEqual(["teachers", "national"]);
  });
});

describe("findCampaignById / findStyleById", () => {
  it("finds an existing id and returns undefined for an unknown one", () => {
    const campaigns = campaignsFile.campaigns as Campaign[];
    expect(findCampaignById(campaigns, campaigns[0].id)?.id).toBe(campaigns[0].id);
    expect(findCampaignById(campaigns, "unknown-id")).toBeUndefined();

    const styles = studioStylesFile.styles as StudioStyle[];
    expect(findStyleById(styles, styles[0].id)?.id).toBe(styles[0].id);
    expect(findStyleById(styles, "unknown-id")).toBeUndefined();
  });
});

describe("todayInRiyadh", () => {
  it("formats as YYYY-MM-DD in UTC+3, rolling past midnight UTC", () => {
    // 2026-09-26T22:00:00Z is 2026-09-27 01:00 in Riyadh (UTC+3).
    expect(todayInRiyadh(new Date("2026-09-26T22:00:00Z"))).toBe("2026-09-27");
    expect(todayInRiyadh(new Date("2026-09-26T20:00:00Z"))).toBe("2026-09-26");
  });
});
