// Shared pieces of Meta webhooks (WhatsApp and Instagram): the GET handshake, the POST signature check,
// and running message work after the 200 response.

import { verifySignature, verifySubscription } from "./verify";

export interface AcceptOptions {
  verifyToken: string;
  /** App secret used for X-Hub-Signature-256. When set, every POST must be signed. */
  appSecret?: string;
  /** Local testing only: accept POSTs without a signature when no app secret is set. */
  allowUnsigned: boolean;
}

/** Returns either a finished Response (handshake, errors) or the parsed JSON payload of a valid POST. */
export async function acceptMetaWebhook(req: Request, opts: AcceptOptions): Promise<{ response: Response } | { payload: unknown }> {
  if (req.method === "GET") {
    const challenge = verifySubscription(new URL(req.url), opts.verifyToken);
    return {
      response: challenge
        ? new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } })
        : new Response("Forbidden", { status: 403 }),
    };
  }
  if (req.method !== "POST") return { response: new Response("Method Not Allowed", { status: 405 }) };

  const raw = await req.text();
  if (opts.appSecret) {
    const ok = await verifySignature(raw, req.headers.get("x-hub-signature-256"), opts.appSecret);
    if (!ok) return { response: new Response("Invalid signature", { status: 401 }) };
  } else if (!opts.allowUnsigned) {
    return { response: new Response("Signature required", { status: 401 }) };
  }

  try {
    return { payload: JSON.parse(raw) };
  } catch {
    return { response: new Response("Bad Request", { status: 400 }) };
  }
}

/** Response Meta expects once a payload is accepted. Always 200, so Meta does not retry handled messages. */
export const received = () => new Response("EVENT_RECEIVED", { status: 200 });

/**
 * Runs work after the response when a defer hook exists (Node: fire and forget; serverless: waitUntil).
 * Without one, the work finishes before the response, which keeps tests simple.
 */
export async function runAfterResponse(
  work: () => Promise<void>,
  defer: ((work: Promise<void>) => void) | undefined,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const running = work();
  if (defer) defer(running.catch((err) => log(`Webhook work failed: ${err instanceof Error ? err.message : String(err)}`)));
  else await running;
}
