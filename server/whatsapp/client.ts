// Sends WhatsApp text replies through the Cloud API.

import type { SendText } from "../agent/processor.ts";
import { metaSendError } from "../meta/send-error.ts";

export type { SendText } from "../agent/processor.ts";
export { MetaSendError as WhatsAppSendError } from "../meta/send-error.ts";

export interface SenderConfig {
  token: string;
  phoneNumberId: string;
  apiVersion?: string;
  /** Log replies instead of sending them. */
  dryRun?: boolean;
  log?: (...args: unknown[]) => void;
}

export function createWhatsAppSender(cfg: SenderConfig, fetchImpl: typeof fetch = fetch): SendText {
  const log = cfg.log ?? console.log;
  const url = `https://graph.facebook.com/${cfg.apiVersion ?? "v25.0"}/${cfg.phoneNumberId}/messages`;
  return async (to, text) => {
    if (cfg.dryRun) {
      log(`[dry-run] reply to ${to}:\n${text}`);
      return;
    }
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) throw await metaSendError(res, "WhatsApp send");
  };
}
