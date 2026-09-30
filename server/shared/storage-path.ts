// Supabase Storage object paths for content-addressed photos ("<shopId>/<photoId>.jpg"). The ids are
// validated upstream (server/sync/validate.ts, server/shop/photos.ts), but these requests are signed
// with the service-role key, so each segment is also percent-encoded here: even an id that somehow
// slipped past validation can never add a path segment ("/"), climb one (".."), or smuggle a query.

/** `<bucket>/<shopId>/<photoId>.jpg`, every segment passed through encodeURIComponent. */
export function photoObjectPath(bucket: string, shopId: string, photoId: string): string {
  return [bucket, shopId, `${photoId}.jpg`].map(encodeURIComponent).join("/");
}
