// Sends a customer message into the running local agent, as if Meta delivered it.
// Use while the Meta app is unpublished and real messages are not delivered yet.
//
//   npm run whatsapp:simulate -- "ابي 10 براونيز بوكس الخميس الساعة 5 العصر"
//   npm run whatsapp:simulate -- --from 97333333333 --name "Sara" "بغيت 20 تشيز كيك كب"
//
// The agent then replies to that number for real. WhatsApp only delivers the reply if the number
// messaged the business number in the last 24 hours, and a test number can only message its allowed list.

import { existsSync } from "node:fs";
import { signBody } from "./whatsapp/verify";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const env = (name: string) => process.env[name]?.trim() || undefined;

const args = process.argv.slice(2);
function takeFlag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

const from = takeFlag("--from") ?? env("DEMO_CUSTOMER_NUMBER");
const name = takeFlag("--name") ?? "Demo customer";
const text = args.join(" ").trim();

if (!from || !text) {
  console.error('Usage: npm run whatsapp:simulate -- [--from 973XXXXXXXX] [--name "Name"] "message text"');
  console.error("Set DEMO_CUSTOMER_NUMBER in .env.local to skip --from.");
  process.exit(1);
}

const now = Date.now();
const payload = {
  object: "whatsapp_business_account",
  entry: [{
    id: env("WHATSAPP_BUSINESS_ACCOUNT_ID") ?? "0",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "", phone_number_id: env("WHATSAPP_PHONE_NUMBER_ID") ?? "" },
        contacts: [{ profile: { name }, wa_id: from }],
        messages: [{ from, id: `wamid.simulated.${now}`, timestamp: String(Math.floor(now / 1000)), type: "text", text: { body: text } }],
      },
    }],
  }],
};

async function main() {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = env("WHATSAPP_APP_SECRET");
  if (secret) headers["x-hub-signature-256"] = await signBody(body, secret);

  const url = `http://localhost:${env("PORT") ?? 8787}/whatsapp/webhook`;
  try {
    const res = await fetch(url, { method: "POST", headers, body });
    console.log(`Agent answered ${res.status} ${await res.text()}. Check the agent log and your WhatsApp for the reply.`);
  } catch {
    console.error(`Could not reach the agent at ${url}. Start it first with: npm run whatsapp:dev`);
    process.exit(1);
  }
}

void main();
