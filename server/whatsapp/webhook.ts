// WhatsApp Cloud API webhook: GET = Meta's verification handshake, POST = incoming messages.
// Written against the standard Request/Response API so it can run in Node, Supabase Edge or Vercel.

import type { Product } from "../../src/lib/types";
import { handleCustomerMessage } from "../agent/reply";
import type { MemoryStore } from "../agent/store";
import type { SendText } from "./client";
import { extractMessages } from "./incoming";
import { verifySignature, verifySubscription } from "./verify";

export interface WebhookDeps {
  verifyToken: string;
  /** Meta app secret. When set, every POST must carry a valid X-Hub-Signature-256. */
  appSecret?: string;
  /** Local testing only: accept POSTs without a signature when no app secret is set. */
  allowUnsigned: boolean;
  send: SendText;
  store: MemoryStore;
  products: Product[];
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}

export function createWebhookHandler(deps: WebhookDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  return async (req) => {
    if (req.method === "GET") {
      const challenge = verifySubscription(new URL(req.url), deps.verifyToken);
      return challenge
        ? new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } })
        : new Response("Forbidden", { status: 403 });
    }
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const raw = await req.text();
    if (deps.appSecret) {
      const ok = await verifySignature(raw, req.headers.get("x-hub-signature-256"), deps.appSecret);
      if (!ok) return new Response("Invalid signature", { status: 401 });
    } else if (!deps.allowUnsigned) {
      return new Response("Signature required", { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    for (const msg of extractMessages(payload)) {
      if (!deps.store.markSeen(msg.id)) continue;
      const outcome = handleCustomerMessage(msg, deps.store, deps.products, now());
      log(`[${outcome.kind}] ${msg.from}${msg.profileName ? ` (${msg.profileName})` : ""}: ${msg.text ?? `<${msg.type}>`}`);
      try {
        await deps.send(msg.from, outcome.reply);
      } catch (err) {
        log(`Reply to ${msg.from} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Always 200 once the payload is accepted, so Meta does not retry messages we already handled.
    return new Response("EVENT_RECEIVED", { status: 200 });
  };
}
