// Turns a WhatsApp Cloud API webhook payload into a flat list of customer messages.
// Delivery status updates (sent, delivered, read) are ignored.

export interface IncomingMessage {
  id: string;
  from: string;
  profileName?: string;
  type: string;
  text?: string;
  timestamp?: string;
}

interface WebhookValue {
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: { id?: string; from?: string; type?: string; timestamp?: string; text?: { body?: string } }[];
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
        out.push({
          id: m.id,
          from: m.from,
          profileName: contact?.profile?.name,
          type: m.type,
          text: m.type === "text" ? m.text?.body : undefined,
          timestamp: m.timestamp,
        });
      }
    }
  }
  return out;
}
