// Turns an Instagram messaging webhook payload (Instagram API with Instagram Login) into customer messages.
// Skips echoes of the business's own messages, read receipts, reactions and other non-message events.

import type { IncomingMessage } from "../whatsapp/incoming";

interface RawAttachment { type?: string; payload?: { url?: string } }
interface RawEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: RawAttachment[] };
}
interface InstagramPayload { object?: string; entry?: { id?: string; messaging?: RawEvent[] }[] }

export function extractInstagramMessages(payload: unknown): IncomingMessage[] {
  const p = payload as InstagramPayload;
  if (!p || p.object !== "instagram" || !Array.isArray(p.entry)) return [];
  const out: IncomingMessage[] = [];
  for (const entry of p.entry) {
    for (const event of entry.messaging ?? []) {
      const m = event.message;
      const from = event.sender?.id;
      // Echoes are messages the business sent; answering them would loop.
      if (!m?.mid || !from || m.is_echo || m.is_deleted) continue;
      const attachment = m.attachments?.[0];
      if (m.text) {
        out.push({ channel: "instagram", id: m.mid, from, type: "text", text: m.text, timestamp: event.timestamp ? String(event.timestamp) : undefined });
      } else if (attachment?.type) {
        out.push({
          channel: "instagram",
          id: m.mid,
          from,
          type: attachment.type,
          text: undefined,
          media: attachment.payload?.url ? { url: attachment.payload.url } : undefined,
          timestamp: event.timestamp ? String(event.timestamp) : undefined,
        });
      }
    }
  }
  return out;
}
