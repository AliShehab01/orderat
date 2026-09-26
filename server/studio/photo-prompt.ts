// Fixed guardrails appended to every photo studio style prompt (docs/marketing-tools.md: "Prompt =
// the style's server-side prompt + fixed guardrails: keep the product identical ..., change only the
// background, surface and light, photorealistic, no added text, logos, watermarks or people"). Kept
// separate from the per-style prompt text in content/studio-styles.json so every style automatically
// gets the same product-fidelity and safety rules without repeating them in each entry.

const GUARDRAILS = [
  "Keep the product itself completely unchanged: the same shape, colors, decorations, any text or",
  "writing on the product, and size. Change only the background, surface and lighting around it.",
  "Photorealistic. Do not add any text, logos, watermarks, or people to the image.",
].join(" ");

/** Builds the full prompt text sent to Gemini for one photo request: the style's own server-side
 * prompt (never returned by any API — see server/campaigns/content.ts's toPublicStyle) followed by
 * the fixed guardrails above. */
export function buildPhotoPrompt(stylePrompt: string): string {
  return `${stylePrompt}\n\n${GUARDRAILS}`;
}
