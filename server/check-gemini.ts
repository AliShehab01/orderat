// Manual check of the Gemini extractor against the real API. Not part of the test suite.
import { existsSync } from "node:fs";
import { createGeminiExtractor } from "./ai/gemini";
import { demoProducts } from "../src/lib/plan";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing in .env.local");
  const extract = createGeminiExtractor({ apiKey: key, model: process.env.GEMINI_MODEL });
  const samples = process.argv.slice(2).length ? process.argv.slice(2) : [
    "هلا حبيبتي، أنا منى. بغيت 20 cup cheesecake و 10 brownies box للسبت الساعة 10 الصبح، بدون مكسرات",
    "salam ukhti momkin 2 brownie box w 3 cheesecake cups for Friday 5pm?",
    "ياليت تخليها 35 كب مو 20",
  ];
  for (const text of samples) {
    const started = Date.now();
    const r = await extract({ text, products: demoProducts(), now: new Date() });
    console.log(`\n>> ${text}\n(${Date.now() - started} ms) lang=${r.lang}`);
    console.log(JSON.stringify(r.draft, null, 1));
  }
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
