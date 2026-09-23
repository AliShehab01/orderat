// Sends WhatsApp text replies through the Cloud API.

export interface SenderConfig {
  token: string;
  phoneNumberId: string;
  apiVersion?: string;
  /** Log replies instead of sending them. */
  dryRun?: boolean;
  log?: (...args: unknown[]) => void;
}

export type SendText = (to: string, text: string) => Promise<void>;

/** A failed send, with Meta's error code when there is one (for example 131030, 131047, 190). */
export class WhatsAppSendError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) {
    super(message);
    this.name = "WhatsAppSendError";
  }
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
    if (!res.ok) {
      const raw = await res.text();
      let code: number | undefined;
      let detail = raw;
      try {
        const err = JSON.parse(raw)?.error;
        if (typeof err?.code === "number") code = err.code;
        if (typeof err?.message === "string") detail = err.message;
      } catch {
        // Body was not JSON; keep the raw text.
      }
      throw new WhatsAppSendError(`WhatsApp send failed (${res.status}${code ? `, code ${code}` : ""}): ${detail}`, code, res.status);
    }
  };
}
