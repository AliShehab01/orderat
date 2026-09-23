// Downloads a voice note or image a customer sent, using the WhatsApp Cloud API media endpoints.

import type { MediaInput } from "../ai/gemini";

export interface MediaReaderConfig {
  token: string;
  apiVersion?: string;
}

export type ReadMedia = (mediaId: string) => Promise<MediaInput>;

export function createMediaReader(cfg: MediaReaderConfig, fetchImpl: typeof fetch = fetch): ReadMedia {
  const auth = { Authorization: `Bearer ${cfg.token}` };
  return async (mediaId) => {
    const meta = await fetchImpl(`https://graph.facebook.com/${cfg.apiVersion ?? "v25.0"}/${encodeURIComponent(mediaId)}`, { headers: auth });
    if (!meta.ok) throw new Error(`WhatsApp media lookup failed (${meta.status})`);
    const info = (await meta.json()) as { url?: string; mime_type?: string };
    if (!info.url) throw new Error("WhatsApp media lookup returned no URL");

    const file = await fetchImpl(info.url, { headers: auth });
    if (!file.ok) throw new Error(`WhatsApp media download failed (${file.status})`);
    const mimeType = (info.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    return { data: new Uint8Array(await file.arrayBuffer()), mimeType };
  };
}
