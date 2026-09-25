// Local runner for the WhatsApp and Instagram webhooks: npm run whatsapp:dev
// Meta cannot reach localhost, so expose this port through an HTTPS tunnel while testing.

import { createServer, type IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { MemoryStore, type OrderStore } from "./agent/store.ts";
import { PostgresStore } from "./agent/postgres-store.ts";
import { createPostgresSqlClient } from "./agent/postgres-client.ts";
import { createWhatsAppSender } from "./whatsapp/client.ts";
import { createWebhookHandler } from "./whatsapp/webhook.ts";
import { createOwnerHandler } from "./owner/handler.ts";
import { withOwnerAuth } from "./owner/auth.ts";
import { isLocalRequest, resolveOwnerKey } from "./owner/local-guard.ts";
import { createGeminiExtractor, DEFAULT_MODEL } from "./ai/gemini.ts";
import { createMediaReader } from "./whatsapp/media.ts";
import { createInstagramSender, createUrlReader } from "./instagram/client.ts";
import { createInstagramWebhookHandler } from "./instagram/webhook.ts";
import { instagramAllowUnsigned } from "./instagram/config.ts";
import { demoProducts } from "../src/lib/plan.ts";

// Orders are parsed and shown in Bahrain time, whatever the machine's time zone.
process.env.TZ = "Asia/Bahrain";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const env = (name: string) => process.env[name]?.trim() || undefined;
const port = Number(env("PORT") ?? 8787);
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

// ORDERAT_DATABASE_URL points at Hayati's pooler as the least-privilege "orderat_app" role (see
// README.md "Hosting"); without it, orders live only in this process's memory, same as always.
const databaseUrl = env("ORDERAT_DATABASE_URL");
const store: OrderStore = databaseUrl ? new PostgresStore(createPostgresSqlClient(databaseUrl)) : new MemoryStore();
console.log(databaseUrl ? "Orders: Postgres (ORDERAT_DATABASE_URL set)." : "Orders: in-memory only (no ORDERAT_DATABASE_URL) — lost on restart.");
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
// Instagram: replies only to INSTAGRAM_REPLY_TO ("all" or a comma-separated list of Instagram-scoped user IDs).
// With nothing set, messages are only logged, so a real business account never answers its real customers by accident.
const igToken = env("INSTAGRAM_ACCESS_TOKEN");
const igSend = igToken ? createInstagramSender({ token: igToken, apiVersion: env("INSTAGRAM_API_VERSION") }) : undefined;
const igReplyRaw = env("INSTAGRAM_REPLY_TO") ?? "";
const igReplyTo: "all" | string[] = igReplyRaw === "all" ? "all" : igReplyRaw.split(",").map((x) => x.trim()).filter(Boolean);
const igAppSecret = env("INSTAGRAM_APP_SECRET");
const igHandler = createInstagramWebhookHandler({
  verifyToken: env("INSTAGRAM_VERIFY_TOKEN") ?? verifyToken,
  appSecret: igAppSecret,
  allowUnsigned: instagramAllowUnsigned(env),
  store, products, send: igSend, replyTo: igReplyTo, extractor, readUrl: createUrlReader(), defer,
});
console.log(`Instagram: ${igSend ? "sending on" : "no INSTAGRAM_ACCESS_TOKEN, replies off"}; replying to ${igReplyTo === "all" ? "everyone" : igReplyTo.length ? igReplyTo.join(", ") : "nobody (observe only)"}.`);
const rawOwnerHandler = createOwnerHandler({ store, products, senders: { whatsapp: send, instagram: igSend } });
// Owner routes require OWNER_KEY auth, the same as the hosted Supabase owner function (server/owner/auth.ts).
// isLocalRequest below is an extra layer on top, not a substitute for it: relying on "no Cloudflare
// headers" alone fails open behind any tunnel that isn't Cloudflare.
const { key: ownerKey, generated: ownerKeyGenerated } = resolveOwnerKey(env("OWNER_KEY"));
if (ownerKeyGenerated) {
  console.log("No OWNER_KEY set in .env.local: generated one for this run only.");
  console.log(`Owner sign-in (one time): http://localhost:${port}/owner?key=${ownerKey}`);
}
const ownerHandler = withOwnerAuth(ownerKey, rawOwnerHandler);

async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", base), { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

createServer(async (req, res) => {
  try {
    const isOwner = req.url?.startsWith("/owner") && isLocalRequest(req);
    const isInstagram = req.url?.startsWith("/instagram/webhook");
    if (!isOwner && !isInstagram && !req.url?.startsWith("/whatsapp/webhook")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const request = await toRequest(req, `http://localhost:${port}`);
    const response = await (isOwner ? ownerHandler : isInstagram ? igHandler : handler)(request);
    // Read the body before writing headers, so a failure here can still become a clean 500.
    const body = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(body);
  } catch (err) {
    console.error(err);
    // Never let an error path crash the whole server (writing headers twice throws).
    if (!res.headersSent) res.writeHead(500);
    if (!res.writableEnded) res.end("Server error");
  }
}).listen(port, () => {
  console.log(`WhatsApp webhook listening on http://localhost:${port}/whatsapp/webhook${dryRun ? " (dry run: replies are printed, not sent)" : ""}`);
  console.log(`Instagram webhook: http://localhost:${port}/instagram/webhook`);
  console.log(`Owner page (this computer only, OWNER_KEY required): http://localhost:${port}/owner`);
});
