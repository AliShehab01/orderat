// Supabase Edge Function entry point for cloud sync (docs/sme-phase-2-cloud.md's "Shops and members"
// and "Sync"). Deployed as: npm run hosting:deploy -- orderat-sync
// (supabase functions deploy orderat-sync --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-sync
//
// Called directly by the iPhone/Android apps and by the browser web app at
// https://orderat-app.pages.dev/app/, authenticated by X-Orderat-Session either way — so the handler
// is wrapped with withAppCors (server/shared/cors.ts), which allows that site's origin (and localhost
// for development) and leaves the phones, which send no Origin header, exactly as they were. All the
// actual logic (push/pull, permissions, invites, members) is the same server/sync/handler.ts a test
// can exercise directly; this file only wires it to real dependencies.
//
// DOCUMENTED EXCEPTION to the orderat_app-only rule (README.md "Hosting" > "The isolation contract"),
// the same one supabase/functions/orderat-shop/index.ts already carries: product photos live in
// Supabase Storage, which orderat_app's plain Postgres connection has no access path to at all —
// Storage is reached only through Supabase's own REST API, authenticated with a project key, never
// the Postgres wire protocol. Unlike orderat-shop's public "orderat-shop" bucket, "orderat-photos"
// (db/migrations/0004_cloud.sql) is private, so reading a photo back also needs a signed URL rather
// than a public one — both the upload and the signing call use SUPABASE_SERVICE_ROLE_KEY, read
// directly here (the one other place besides orderat-shop that does). The database itself is still
// reached only as orderat_app, via server/sync/store.ts.

import { withAppCors } from "../../../server/shared/cors.ts";
import { createSyncHandler, type GetSignedPhotoUrl, type UploadPhoto } from "../../../server/sync/handler.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

const sql = getSqlClient(env("DATABASE_URL") ?? "");

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// db/migrations/0004_cloud.sql's private bucket; docs/sme-phase-2-cloud.md: "<shopId>/<sha256>.jpg".
const BUCKET = "orderat-photos";

const uploadPhoto: UploadPhoto = async ({ shopId, photoId, bytes, mimeType }) => {
  if (!supabaseUrl || !serviceRoleKey) return false;
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${shopId}/${photoId}.jpg`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": mimeType,
        "x-upsert": "true", // Content-addressed: re-uploading the same hash is a harmless overwrite.
      },
      body: bytes,
    });
    return res.ok;
  } catch {
    return false;
  }
};

const getSignedPhotoUrl: GetSignedPhotoUrl = async ({ shopId, photoId, expiresInSeconds }) => {
  if (!supabaseUrl || !serviceRoleKey) return undefined;
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${shopId}/${photoId}.jpg`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { signedURL?: string };
    return body.signedURL ? `${supabaseUrl}/storage/v1${body.signedURL}` : undefined;
  } catch {
    return undefined;
  }
};

const handler = withAppCors(createSyncHandler({ sql, uploadPhoto, getSignedPhotoUrl }));

Deno.serve((req) => handler(req));
