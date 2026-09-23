// Whether to accept unsigned Instagram webhook calls (testing only). This must be governed only by
// Instagram's own INSTAGRAM_ALLOW_UNSIGNED flag: it must never fall back to WHATSAPP_ALLOW_UNSIGNED,
// which is a different webhook's setting and would let anyone skip Instagram's signature check just
// because unsigned WhatsApp testing was turned on.
export function instagramAllowUnsigned(env: (name: string) => string | undefined): boolean {
  return env("INSTAGRAM_ALLOW_UNSIGNED") === "1";
}
