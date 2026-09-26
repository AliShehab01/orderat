import { describe, expect, it } from "vitest";
import { buildPhotoPrompt } from "./photo-prompt";

describe("buildPhotoPrompt", () => {
  it("puts the style's own prompt first, verbatim", () => {
    const prompt = buildPhotoPrompt("Place the product on a white studio background.");
    expect(prompt.startsWith("Place the product on a white studio background.")).toBe(true);
  });

  it("appends the product-fidelity guardrail", () => {
    const prompt = buildPhotoPrompt("style prompt");
    expect(prompt).toContain("unchanged");
    expect(prompt).toContain("shape, colors, decorations");
  });

  it("appends the no-added-content guardrail", () => {
    const prompt = buildPhotoPrompt("style prompt");
    expect(prompt).toContain("Do not add any text, logos, watermarks, or people");
  });

  it("asks for a photorealistic result", () => {
    expect(buildPhotoPrompt("style prompt")).toContain("Photorealistic");
  });
});
