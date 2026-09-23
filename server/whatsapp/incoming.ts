// Turns a WhatsApp Cloud API webhook payload into a flat list of customer messages.
// Delivery status updates (sent, delivered, read) are ignored.

import type { Channel } from "../agent/store.ts";

export interface IncomingMedia {
  /** WhatsApp media ID, downloaded through the Cloud API. */
  id?: string;
  /** Direct file URL (Instagram attachments). */
  url?: string;
  mimeType?: string;
  caption?: string;
}

export interface IncomingMessage {
  channel: Channel;
  id: string;
  /** WhatsApp number or Instagram-scoped user ID of the customer. */
  from: string;
  profileName?: string;
  type: string;
  text?: string;
  /** Set for audio (voice notes), image, video, document and sticker messages. */
  media?: IncomingMedia;
  timestamp?: string;
}

const MEDIA_TYPES = new Set(["audio", "image", "video", "document", "sticker"]);

type RawMedia = { id?: string; mime_type?: string; caption?: string };
type RawMessage = { id?: string; from?: string; type?: string; timestamp?: string; text?: { body?: string } } & Record<string, unknown>;

interface WebhookValue {
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: RawMessage[];
}

interface WebhookPayload {
  object?: string;
  entry?: { changes?: { field?: string; value?: WebhookValue }[] }[];
}

export function extractMessages(payload: unknown): IncomingMessage[] {
  const p = payload as WebhookPayload;
  if (!p || p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return [];
  const out: IncomingMessage[] = [];
  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value?.messages) continue;
      const contacts = change.value.contacts ?? [];
      for (const m of change.value.messages) {
        if (!m.id || !m.from || !m.type) continue;
        const contact = contacts.find((c) => c.wa_id === m.from) ?? contacts[0];
        const rawMedia = MEDIA_TYPES.has(m.type) ? (m[m.type] as RawMedia | undefined) : undefined;
        out.push({
          channel: "whatsapp",
          id: m.id,
          from: m.from,
          profileName: contact?.profile?.name,
          type: m.type,
          text: m.type === "text" ? m.text?.body : undefined,
          media: rawMedia?.id ? { id: rawMedia.id, mimeType: rawMedia.mime_type, caption: rawMedia.caption } : undefined,
          timestamp: m.timestamp,
        });
      }
    }
  }
  return out;
}
