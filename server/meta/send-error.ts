/** A failed WhatsApp or Instagram send, with Meta's error code when there is one (for example 131030, 131047, 190). */
export class MetaSendError extends Error {
  constructor(message: string, readonly code?: number, readonly status?: number) {
    super(message);
    this.name = "MetaSendError";
  }
}

/** Reads Meta's error JSON ({ error: { message, code } }) from a failed response and builds a MetaSendError. */
export async function metaSendError(res: Response, what: string): Promise<MetaSendError> {
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
  return new MetaSendError(`${what} failed (${res.status}${code ? `, code ${code}` : ""}): ${detail}`, code, res.status);
}
