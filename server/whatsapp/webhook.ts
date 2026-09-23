// WhatsApp Cloud API webhook: GET = Meta's verification handshake, POST = incoming messages.
// Written against the standard Request/Response API so it can run in Node, Supabase Edge or Vercel.

import type { Product } from "../../src/lib/types";
import type { OpenOrderContext, OrderExtractor } from "../ai/gemini";
import { handleCustomerMessage, type PreparedDraft } from "../agent/reply";
import type { MemoryStore } from "../agent/store";
import type { SendText } from "./client";
import { extractMessages, type IncomingMessage } from "./incoming";
import type { ReadMedia } from "./media";
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
  /** AI order reader (Gemini). Without it, text uses the built-in parser and media gets an acknowledgement. */
  extractor?: OrderExtractor;
  /** Downloads voice notes and images so the extractor can read them. */
  readMedia?: ReadMedia;
  /**
   * Runs message work after the response is sent, so Meta gets its 200 at once even when the AI is slow.
   * Node: fire and forget. Serverless: the platform's waitUntil. Without it, work finishes before the response.
   */
  defer?: (work: Promise<void>) => void;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}

const AI_MEDIA_TYPES = new Set(["audio", "image"]);

function openOrderContext(msg: IncomingMessage, deps: WebhookDeps, now: Date): OpenOrderContext | undefined {
  const open = deps.store.openOrdersFor(msg.from, now)[0]?.order;
  if (!open) return undefined;
  return {
    items: open.items.map((i) => ({ productId: i.productId, name: deps.products.find((p) => p.id === i.productId)?.name ?? i.rawText, quantity: i.quantity })),
    collectionAt: open.collectionAt,
  };
}

/** Reads the message with the AI extractor when possible. Returns undefined to use the built-in path. */
async function prepareWithAi(msg: IncomingMessage, deps: WebhookDeps, now: Date): Promise<PreparedDraft | undefined> {
  if (!deps.extractor) return undefined;
  const openOrder = openOrderContext(msg, deps, now);
  if (msg.type === "text" && msg.text?.trim()) {
    return deps.extractor({ text: msg.text, products: deps.products, now, openOrder });
  }
  if (AI_MEDIA_TYPES.has(msg.type) && msg.media && deps.readMedia) {
    const media = await deps.readMedia(msg.media.id);
    return deps.extractor({ text: msg.media.caption, media, products: deps.products, now, openOrder });
  }
  return undefined;
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

    // Mark messages as seen before any slow work, so a retried delivery is never handled twice.
    const fresh = extractMessages(payload).filter((msg) => deps.store.markSeen(msg.id));
    const work = (async () => {
      for (const msg of fresh) await processMessage(msg);
    })();
    if (deps.defer) deps.defer(work.catch((err) => log(`Webhook work failed: ${err instanceof Error ? err.message : String(err)}`)));
    else await work;
    // Always 200 once the payload is accepted, so Meta does not retry messages we already handled.
    return new Response("EVENT_RECEIVED", { status: 200 });
  };

  async function processMessage(msg: IncomingMessage): Promise<void> {
    const at = now();
    let prepared: PreparedDraft | undefined;
    try {
      prepared = await prepareWithAi(msg, deps, at);
    } catch (err) {
      log(`AI reading failed for ${msg.id}, using the built-in path: ${err instanceof Error ? err.message : String(err)}`);
    }
    const outcome = handleCustomerMessage(msg, deps.store, deps.products, at, prepared);
    const shown = msg.text ?? (prepared?.sourceText ? `<${msg.type}> ${prepared.sourceText}` : `<${msg.type}>`);
    log(`[${outcome.kind}${prepared ? ", ai" : ""}] ${msg.from}${msg.profileName ? ` (${msg.profileName})` : ""}: ${shown}`);
    try {
      await deps.send(msg.from, outcome.reply);
    } catch (err) {
      log(`Reply to ${msg.from} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
