// Local runner for the WhatsApp webhook: npm run whatsapp:dev
// Meta cannot reach localhost, so expose this port through an HTTPS tunnel while testing.

import { createServer, type IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { MemoryStore } from "./agent/store";
import { createWhatsAppSender } from "./whatsapp/client";
import { createWebhookHandler } from "./whatsapp/webhook";
import { createOwnerHandler } from "./owner/handler";
import { createGeminiExtractor, DEFAULT_MODEL } from "./ai/gemini";
import { createMediaReader } from "./whatsapp/media";
import { demoProducts } from "../src/lib/plan";

// Orders are parsed and shown in Bahrain time, whatever the machine's time zone.
process.env.TZ = "Asia/Bahrain";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const env = (name: string) => process.env[name]?.trim() || undefined;
const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
const token = env("WHATSAPP_TOKEN");
const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
const dryRun = env("WHATSAPP_DRY_RUN") === "1";

if (!verifyToken || (!dryRun && (!token || !phoneNumberId))) {
  console.error("Missing settings in .env.local: WHATSAPP_VERIFY_TOKEN, and WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID unless WHATSAPP_DRY_RUN=1.");
  process.exit(1);
}

const appSecret = env("WHATSAPP_APP_SECRET");
const allowUnsigned = env("WHATSAPP_ALLOW_UNSIGNED") === "1";
if (!appSecret) console.warn(allowUnsigned ? "Warning: no WHATSAPP_APP_SECRET, accepting unsigned webhook calls (testing only)." : "No WHATSAPP_APP_SECRET: unsigned webhook calls will be rejected.");

const store = new MemoryStore();
const products = demoProducts();
const send = createWhatsAppSender({ token: token ?? "", phoneNumberId: phoneNumberId ?? "", apiVersion: env("WHATSAPP_API_VERSION"), dryRun });
const geminiKey = env("GEMINI_API_KEY");
const fallbackModels = env("GEMINI_FALLBACK_MODELS")?.split(",").map((m) => m.trim()).filter(Boolean);
const extractor = geminiKey ? createGeminiExtractor({ apiKey: geminiKey, model: env("GEMINI_MODEL"), fallbackModels }) : undefined;
const readMedia = token ? createMediaReader({ token, apiVersion: env("WHATSAPP_API_VERSION") }) : undefined;
console.log(extractor
  ? `AI reading: Gemini (${env("GEMINI_MODEL") ?? DEFAULT_MODEL}, with fallbacks) for text, voice notes and images.`
  : "AI reading off (no GEMINI_API_KEY): text uses the built-in parser; voice notes and images get an acknowledgement.");
// Answer Meta at once; the agent reads and replies in the background.
const defer = (work: Promise<void>) => { void work; };
const handler = createWebhookHandler({ verifyToken, appSecret, allowUnsigned, store, products, send, extractor, readMedia, defer });
const ownerHandler = createOwnerHandler({ store, products, send });

/** Owner routes are for this computer only. Tunnel traffic also arrives from loopback but carries Cloudflare headers. */
function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  return loopback && !req.headers["cf-connecting-ip"] && !req.headers["cf-ray"];
}

async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", base), { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

const port = Number(env("PORT") ?? 8787);
createServer(async (req, res) => {
  try {
    const isOwner = req.url?.startsWith("/owner") && isLocalRequest(req);
    if (!isOwner && !req.url?.startsWith("/whatsapp/webhook")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const request = await toRequest(req, `http://localhost:${port}`);
    const response = await (isOwner ? ownerHandler : handler)(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Server error");
  }
}).listen(port, () => {
  console.log(`WhatsApp webhook listening on http://localhost:${port}/whatsapp/webhook${dryRun ? " (dry run: replies are printed, not sent)" : ""}`);
  console.log(`Owner page (this computer only): http://localhost:${port}/owner`);
});
