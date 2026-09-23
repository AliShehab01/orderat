import { describe, expect, it } from "vitest";
import { parseOrderText } from "./parser";
import { demoProducts } from "./plan";

// server/test-setup.ts forces process.env.TZ to Asia/Bahrain for the whole suite, matching how
// npm run whatsapp:dev runs locally. A Supabase Edge Function runs in UTC instead, so these tests
// flip TZ per call and prove the parser's Bahrain date math (src/lib/bahrain-time.ts) gives the
// same result either way, instead of quietly depending on the host process's zone.
function parseWithTz(tz: string, text: string, now: Date) {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return parseOrderText(text, demoProducts(), now);
  } finally {
    process.env.TZ = original;
  }
}

describe("parser date math does not depend on the process time zone", () => {
  // Monday 2026-09-21, 09:00 Bahrain time.
  const NOW = new Date("2026-09-21T06:00:00Z");
  // Same Monday, 23:00 Bahrain time (20:00 UTC) — UTC and Bahrain disagree on the calendar day here,
  // the case most likely to break if "today"/"tomorrow" math ever used the process's own zone again.
  const LATE_EVENING = new Date("2026-09-21T20:00:00Z");

  const cases: [string, Date][] = [
    ["بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح", NOW],
    ["hi i want 15 red velvet cups for thursday at 12 pm", NOW],
    ["الخميس الساعة 5 العصر", NOW],
    ["ابي 5 معمول بوكس اليوم الساعة 8 مساء", NOW],
    ["ابي 3 كب كيك فانيلا الساعة 10 الصبح", NOW],
    ["ابي 4 براونيز بوكس اليوم الساعة 11 مساء", LATE_EVENING],
  ];

  for (const [text, now] of cases) {
    it(`gives the same collection time under UTC as under Asia/Bahrain: "${text}"`, () => {
      const inBahrainTz = parseWithTz("Asia/Bahrain", text, now);
      const inUtc = parseWithTz("UTC", text, now);
      expect(inUtc.collectionAt).toBe(inBahrainTz.collectionAt);
      expect(inUtc.collectionConfidence).toBe(inBahrainTz.collectionConfidence);
    });
  }

  it("resolves a concrete case to the correct instant under UTC, not just consistently", () => {
    const draft = parseWithTz("UTC", "بغيت 20 تشيز كيك كب للسبت الساعة 10 الصبح", NOW);
    expect(draft.collectionAt).toBe("2026-09-26T07:00:00.000Z"); // Saturday 10:00 Bahrain = 07:00 UTC
  });

  it("keeps 'today' on the Bahrain calendar day even when the UTC day has not rolled over yet", () => {
    // At 23:00 Bahrain (20:00 UTC) it is still Monday in Bahrain and still Monday in UTC, so this
    // mainly guards the 11pm-Bahrain slot resolving to the same Monday, not Tuesday.
    const draft = parseWithTz("UTC", "ابي 4 براونيز بوكس اليوم الساعة 11 مساء", LATE_EVENING);
    expect(draft.collectionAt).toBe("2026-09-21T20:00:00.000Z"); // Monday 23:00 Bahrain = 20:00 UTC
  });
});
