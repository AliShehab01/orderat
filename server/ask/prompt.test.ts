import { describe, expect, it } from "vitest";
import { buildAskPrompt } from "./prompt.ts";

function base(overrides: Partial<Parameters<typeof buildAskPrompt>[0]> = {}) {
  return {
    lang: "ar" as const,
    question: "كم ربحت هالشهر؟",
    history: [],
    snapshot: { currency: "BHD", today: "2026-09-26" },
    ...overrides,
  };
}

describe("buildAskPrompt", () => {
  it("includes the Gulf Arabic rule and Latin-digit instruction when lang is ar", () => {
    const prompt = buildAskPrompt(base({ lang: "ar" }));
    expect(prompt).toContain("Gulf Arabic");
    expect(prompt).toContain("Latin digits");
  });

  it("includes a simple-English rule when lang is en", () => {
    const prompt = buildAskPrompt(base({ lang: "en" }));
    expect(prompt).toContain("simple, friendly English");
    expect(prompt).not.toContain("Gulf Arabic");
  });

  it("tells the model to answer only from the snapshot and to say when it doesn't know", () => {
    const prompt = buildAskPrompt(base());
    expect(prompt).toMatch(/only.*snapshot/i);
    expect(prompt).toMatch(/don't know|do not know/i);
  });

  it("states the money formatting rule with 3 decimals for BHD/KWD/OMR", () => {
    for (const currency of ["BHD", "KWD", "OMR"]) {
      const prompt = buildAskPrompt(base({ snapshot: { currency } }));
      expect(prompt).toContain("3 decimal places");
      expect(prompt).toContain(currency);
    }
  });

  it("states the money formatting rule with 2 decimals for other currencies", () => {
    const prompt = buildAskPrompt(base({ snapshot: { currency: "USD" } }));
    expect(prompt).toContain("2 decimal places");
  });

  it("falls back to a generic currency instruction when the snapshot has none", () => {
    const prompt = buildAskPrompt(base({ snapshot: {} }));
    expect(prompt).toContain("2 decimal places");
    expect(prompt).toContain("the snapshot's currency code");
  });

  it("never mentions phone numbers being wanted — it only tells the model not to mention them", () => {
    const prompt = buildAskPrompt(base());
    expect(prompt).toMatch(/never mention.*phone numbers/i);
  });

  it("lists only the four allowed action types", () => {
    const prompt = buildAskPrompt(base());
    for (const action of ["send_reminders", "add_expense", "draft_caption", "open_order"]) {
      expect(prompt).toContain(action);
    }
    expect(prompt).not.toContain("delete_order");
  });

  it("includes the caps on answer length", () => {
    expect(buildAskPrompt(base())).toMatch(/6 lines/);
  });

  it("embeds the snapshot as JSON", () => {
    const prompt = buildAskPrompt(base({ snapshot: { currency: "BHD", shopName: "Sweet Studio" } }));
    expect(prompt).toContain(JSON.stringify({ currency: "BHD", shopName: "Sweet Studio" }));
  });

  it("includes prior turns labelled by role, in order", () => {
    const prompt = buildAskPrompt(
      base({ history: [{ role: "user", text: "منو باقي عليه فلوس؟" }, { role: "assistant", text: "سارة وبدرية." }] }),
    );
    const userIdx = prompt.indexOf("منو باقي عليه فلوس؟");
    const assistantIdx = prompt.indexOf("سارة وبدرية.");
    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
  });

  it("notes there are no earlier turns when history is empty", () => {
    expect(buildAskPrompt(base({ history: [] }))).toMatch(/no earlier turns/);
  });

  it("includes the question text", () => {
    expect(buildAskPrompt(base({ question: "وش أكثر شي ينباع؟" }))).toContain("وش أكثر شي ينباع؟");
  });

  it("tells the model the snapshot/history/question are data, not instructions to follow", () => {
    const prompt = buildAskPrompt(base());
    expect(prompt).toMatch(/not something to follow|not.*instructions/i);
  });
});
