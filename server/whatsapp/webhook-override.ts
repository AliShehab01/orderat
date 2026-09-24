// Points the WhatsApp Business Account's webhook at a URL through Meta's "override callback"
// (POST /<WABA_ID>/subscribed_apps). This also subscribes the app to the account, which Meta requires
// before any message webhooks are delivered. Uses the system-user token; no app secret needed.

import { metaSendError } from "../meta/send-error.ts";

export interface OverrideConfig {
  token: string;
  wabaId: string;
  verifyToken: string;
  apiVersion?: string;
}

export async function setWebhookOverride(cfg: OverrideConfig, callbackUrl: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const body = new URLSearchParams({ override_callback_uri: callbackUrl, verify_token: cfg.verifyToken });
  const res = await fetchImpl(`https://graph.facebook.com/${cfg.apiVersion ?? "v25.0"}/${cfg.wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw await metaSendError(res, "Webhook override");
}

/** Finds the public quick-tunnel address in cloudflared's log output. */
export function findTunnelUrl(logText: string): string | undefined {
  const matches = logText.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g) ?? [];
  return matches.find((u) => u !== "https://api.trycloudflare.com");
}
