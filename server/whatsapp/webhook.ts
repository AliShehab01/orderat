// WhatsApp Cloud API webhook: GET = Meta's verification handshake, POST = incoming messages.
// Written against the standard Request/Response API so it can run in Node, Supabase Edge or Vercel.

import type { Product } from "../../src/lib/types.ts";
import type { OrderExtractor } from "../ai/gemini.ts";
import { createMessageProcessor, type SendText } from "../agent/processor.ts";
import type { OrderStore } from "../agent/store.ts";
import { acceptMetaWebhook, received, runAfterResponse } from "../meta/webhook-common.ts";
import { extractMessages, type IncomingMessage } from "./incoming.ts";
import type { ReadMedia } from "./media.ts";

export interface WebhookDeps {
  verifyToken: string;
  /** Meta app secret. When set, every POST must carry a valid X-Hub-Signature-256. */
  appSecret?: string;
  /** Local testing only: accept POSTs without a signature when no app secret is set. */
  allowUnsigned: boolean;
  send: SendText;
  store: OrderStore;
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

export function createWebhookHandler(deps: WebhookDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const process = createMessageProcessor({
    store: deps.store,
    products: deps.products,
    senders: { whatsapp: deps.send },
    extractor: deps.extractor,
    readMedia: deps.readMedia,
    now: deps.now,
    log,
  });

  return async (req) => {
    const accepted = await acceptMetaWebhook(req, deps);
    if ("response" in accepted) return accepted.response;
    // Mark messages as seen before any slow work, so a retried delivery is never handled twice.
    const fresh: IncomingMessage[] = [];
    for (const msg of extractMessages(accepted.payload)) if (await deps.store.markSeen(msg.id)) fresh.push(msg);
    await runAfterResponse(async () => { for (const msg of fresh) await process(msg); }, deps.defer, log);
    return received();
  };
}
