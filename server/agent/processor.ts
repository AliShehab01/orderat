// Handles one customer message from any channel: optional AI reading, the order agent, and the reply.

import type { Product } from "../../src/lib/types";
import type { MediaInput, OpenOrderContext, OrderExtractor } from "../ai/gemini";
import type { IncomingMessage } from "../whatsapp/incoming";
import { handleCustomerMessage, type PreparedDraft } from "./reply";
import type { Channel, MemoryStore } from "./store";

export type SendText = (to: string, text: string) => Promise<void>;

export interface ProcessorDeps {
  store: MemoryStore;
  products: Product[];
  /** How to reply on each channel. A channel without a sender is read but not answered. */
  senders: Partial<Record<Channel, SendText>>;
  /** AI order reader (Gemini). Without it, text uses the built-in parser and media gets an acknowledgement. */
  extractor?: OrderExtractor;
  /** Downloads WhatsApp media by ID. */
  readMedia?: (mediaId: string) => Promise<MediaInput>;
  /** Downloads a media file by URL (Instagram attachments). */
  readUrl?: (url: string) => Promise<MediaInput>;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}

const AI_MEDIA_TYPES = new Set(["audio", "image"]);

export function createMessageProcessor(deps: ProcessorDeps): (msg: IncomingMessage) => Promise<void> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  function openOrderContext(msg: IncomingMessage, at: Date): OpenOrderContext | undefined {
    const open = deps.store.openOrdersFor(msg.channel, msg.from, at)[0]?.order;
    if (!open) return undefined;
    return {
      items: open.items.map((i) => ({ productId: i.productId, name: deps.products.find((p) => p.id === i.productId)?.name ?? i.rawText, quantity: i.quantity })),
      collectionAt: open.collectionAt,
    };
  }

  async function readMediaOf(msg: IncomingMessage): Promise<MediaInput | undefined> {
    if (!msg.media) return undefined;
    if (msg.media.id && deps.readMedia) return deps.readMedia(msg.media.id);
    if (msg.media.url && deps.readUrl) return deps.readUrl(msg.media.url);
    return undefined;
  }

  /** Reads the message with the AI extractor when possible. Returns undefined to use the built-in path. */
  async function prepareWithAi(msg: IncomingMessage, at: Date): Promise<PreparedDraft | undefined> {
    if (!deps.extractor) return undefined;
    const openOrder = openOrderContext(msg, at);
    if (msg.type === "text" && msg.text?.trim()) {
      return deps.extractor({ text: msg.text, products: deps.products, now: at, openOrder });
    }
    if (AI_MEDIA_TYPES.has(msg.type)) {
      const media = await readMediaOf(msg);
      if (media) return deps.extractor({ text: msg.media?.caption, media, products: deps.products, now: at, openOrder });
    }
    return undefined;
  }

  return async (msg) => {
    const at = now();
    let prepared: PreparedDraft | undefined;
    try {
      prepared = await prepareWithAi(msg, at);
    } catch (err) {
      log(`AI reading failed for ${msg.id}, using the built-in path: ${err instanceof Error ? err.message : String(err)}`);
    }
    const outcome = handleCustomerMessage(msg, deps.store, deps.products, at, prepared);
    const shown = msg.text ?? (prepared?.sourceText ? `<${msg.type}> ${prepared.sourceText}` : `<${msg.type}>`);
    log(`[${msg.channel} ${outcome.kind}${prepared ? ", ai" : ""}] ${msg.from}${msg.profileName ? ` (${msg.profileName})` : ""}: ${shown}`);

    const send = deps.senders[msg.channel];
    if (!send) {
      log(`No ${msg.channel} sender configured, reply not sent.`);
      return;
    }
    try {
      await send(msg.from, outcome.reply);
    } catch (err) {
      log(`Reply to ${msg.from} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
