// Sends Instagram DM replies (Instagram API with Instagram Login) and downloads attachments.

import type { SendText } from "../agent/processor.ts";
import type { MediaInput } from "../ai/gemini.ts";
import { metaSendError } from "../meta/send-error.ts";

export interface InstagramConfig {
  /** Instagram user access token for the connected professional account. */
  token: string;
  apiVersion?: string;
}

const MAX_BYTES = 1000; // Instagram rejects message text over 1000 bytes (UTF-8).
const encoder = new TextEncoder();

/** Shortens text to Instagram's byte limit, cutting at the last whole line that fits. */
export function fitInstagramText(text: string): string {
  if (encoder.encode(text).length <= MAX_BYTES) return text;
  const lines = text.split("\n");
  let out = "";
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (encoder.encode(`${next}\n…`).length > MAX_BYTES) break;
    out = next;
  }
  return `${out}\n…`;
}

export function createInstagramSender(cfg: InstagramConfig, fetchImpl: typeof fetch = fetch): SendText {
  const url = `https://graph.instagram.com/${cfg.apiVersion ?? "v25.0"}/me/messages`;
  return async (to, text) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message: { text: fitInstagramText(text) } }),
    });
    if (!res.ok) throw await metaSendError(res, "Instagram send");
  };
}

/** Downloads an attachment URL from an Instagram message, for the AI reader. */
export function createUrlReader(fetchImpl: typeof fetch = fetch): (url: string) => Promise<MediaInput> {
  return async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Attachment download failed (${res.status})`);
    const mimeType = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType };
  };
}
