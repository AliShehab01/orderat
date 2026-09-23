// Local runner for the WhatsApp webhook: npm run whatsapp:dev
// Meta cannot reach localhost, so expose this port through an HTTPS tunnel while testing.

import { createServer, type IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { MemoryStore } from "./agent/store";
import { createWhatsAppSender } from "./whatsapp/client";
import { createWebhookHandler } from "./whatsapp/webhook";
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
const handler = createWebhookHandler({
  verifyToken,
  appSecret,
  allowUnsigned,
  store,
  products: demoProducts(),
  send: createWhatsAppSender({ token: token ?? "", phoneNumberId: phoneNumberId ?? "", apiVersion: env("WHATSAPP_API_VERSION"), dryRun }),
});

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
    if (!req.url?.startsWith("/whatsapp/webhook")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const response = await handler(await toRequest(req, `http://localhost:${port}`));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (err) {
    console.error(err);
    res.writeHead(500).end("Server error");
  }
}).listen(port, () => {
  console.log(`WhatsApp webhook listening on http://localhost:${port}/whatsapp/webhook${dryRun ? " (dry run: replies are printed, not sent)" : ""}`);
});
