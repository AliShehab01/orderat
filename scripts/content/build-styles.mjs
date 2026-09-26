// Writes content/studio-styles.json from scripts/content/studio-styles.mjs (docs/marketing-tools.md,
// part B). The `prompt` field stays server-only: orderat-campaigns strips it from every response.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { styles } from "./studio-styles.mjs";

const out = process.argv[2] ?? fileURLToPath(new URL("../../content/studio-styles.json", import.meta.url));
const list = styles.map((s) => ({
  id: s.id,
  name: s.name,
  emoji: s.emoji,
  swatch: s.swatch,
  previewUrl: null,
  occasion: s.occasion,
  prompt: s.prompt,
}));
writeFileSync(out, JSON.stringify({ styles: list }, null, 2) + "\n");
console.log(`${list.length} styles -> ${out}`);
