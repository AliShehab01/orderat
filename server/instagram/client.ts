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
const SUFFIX = "\n…";
const encoder = new TextEncoder();

/** Truncates `s` to at most `maxBytes` UTF-8 bytes, keeping only whole characters (never splitting one). */
function truncateToBytes(s: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of s) { // iterates by code point, so a surrogate pair is never split either
    const chBytes = encoder.encode(ch).length;
    if (bytes + chBytes > maxBytes) break;
    bytes += chBytes;
    end += ch.length;
  }
  return s.slice(0, end);
}

/**
 * Shortens text to Instagram's byte limit, cutting at the last whole line that fits. When even the
 * first line that doesn't fit is itself over the limit on its own, hard-truncates that line by
 * bytes instead of dropping it entirely (never splitting a character).
 */
export function fitInstagramText(text: string): string {
  if (encoder.encode(text).length <= MAX_BYTES) return text;
  const suffixBytes = encoder.encode(SUFFIX).length;
  const lines = text.split("\n");
  let out = "";
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (encoder.encode(next).length + suffixBytes <= MAX_BYTES) { out = next; continue; }
    const prefix = out ? `${out}\n` : "";
    const budget = MAX_BYTES - suffixBytes - encoder.encode(prefix).length;
    out = `${prefix}${truncateToBytes(line, Math.max(0, budget))}`;
    break;
  }
  return `${out}${SUFFIX}`;
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
