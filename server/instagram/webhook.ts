// Instagram messaging webhook (Instagram API with Instagram Login).
//
// Safety: the connected account may be a real business with real customers. The agent replies only to
// senders in `replyTo` (Instagram-scoped user IDs), or to everyone when replyTo is "all". Every other
// sender is only logged, never answered and never stored, so their ID can be added once known.

import type { Product } from "../../src/lib/types";
import type { MediaInput, OrderExtractor } from "../ai/gemini";
import { createMessageProcessor, type SendText } from "../agent/processor";
import type { MemoryStore } from "../agent/store";
import { acceptMetaWebhook, received, runAfterResponse } from "../meta/webhook-common";
import { extractInstagramMessages } from "./incoming";

export interface InstagramWebhookDeps {
  verifyToken: string;
  /** Instagram app secret (Instagram use case > API setup), used for X-Hub-Signature-256. */
  appSecret?: string;
  allowUnsigned: boolean;
  store: MemoryStore;
  products: Product[];
  /** Missing until an Instagram access token is set; messages are then read but not answered. */
  send?: SendText;
  /** Who the agent may answer: "all", or a list of Instagram-scoped user IDs. Empty list = observe only. */
  replyTo: "all" | string[];
  extractor?: OrderExtractor;
  readUrl?: (url: string) => Promise<MediaInput>;
  defer?: (work: Promise<void>) => void;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}

export function createInstagramWebhookHandler(deps: InstagramWebhookDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const allowed = (id: string) => deps.replyTo === "all" || deps.replyTo.includes(id);
  const process = createMessageProcessor({
    store: deps.store,
    products: deps.products,
    senders: deps.send ? { instagram: deps.send } : {},
    extractor: deps.extractor,
    readUrl: deps.readUrl,
    now: deps.now,
    log,
  });

  return async (req) => {
    const accepted = await acceptMetaWebhook(req, deps);
    if ("response" in accepted) return accepted.response;
    const fresh = extractInstagramMessages(accepted.payload).filter((msg) => deps.store.markSeen(msg.id));
    await runAfterResponse(async () => {
      for (const msg of fresh) {
        if (!allowed(msg.from)) {
          log(`[instagram observe] sender ${msg.from} is not in INSTAGRAM_REPLY_TO, not answered: ${msg.text ?? `<${msg.type}>`}`);
          continue;
        }
        await process(msg);
      }
    }, deps.defer, log);
    return received();
  };
}
