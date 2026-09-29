// Supabase Edge Function entry point for the public shop link (docs/marketing-tools.md's
// "C. Shop link"). Deployed as: npm run hosting:deploy -- orderat-shop (supabase functions deploy
// orderat-shop --use-api). URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-shop
//
// Called by the seller's app (publish/unpublish/stats/inbox/ack) and directly by the public shop
// page's browser JS (the public GET, slug_check, order) — hence this function's own CORS
// (server/shared/cors.ts), applied inside server/shop/handler.ts itself rather than layered on here.
// All the actual logic is that same handler, a test can exercise directly; this file only wires it to
// real dependencies. See supabase/functions/orderat-whatsapp/index.ts for notes on the import layout,
// --use-api and the orderat- / ORDERAT_ prefixing this shares with the other functions.
//
// DOCUMENTED EXCEPTION to the orderat_app-only rule (README.md "Hosting" > "The isolation contract"):
// uploading a shop's photos needs Supabase Storage, which orderat_app's plain Postgres connection
// (server/agent/postgres-store.ts) has no access path to at all — Storage is reached only through
// Supabase's own REST API, authenticated with a project key, never the Postgres wire protocol. This
// file is therefore the one place in the whole codebase that reads Supabase's own auto-injected
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY directly (every other secret goes through
// supabase/functions/_shared/env.ts's ORDERAT_ prefix) — and the service role key is used for exactly
// one thing: POSTing bytes to the public "orderat-shop" bucket, at a path this function builds itself
// (`<shopId>/<photoId>.jpg`, already validated by server/shop/photos.ts before this ever runs). The
// database is still reached only as orderat_app, via server/shop/store.ts / orders.ts, same as every
// other function.

import { createShopHandler, type UploadPhoto } from "../../../server/shop/handler.ts";
import { sha256HexOfString } from "../../../server/shared/crypto.ts";
import { orderatEnv as env } from "../_shared/env.ts";
import { getSqlClient } from "../_shared/db.ts";

const sql = getSqlClient(env("DATABASE_URL") ?? "");

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const uploadPhoto: UploadPhoto = async ({ shopId, photoId, bytes, mimeType }) => {
  if (!supabaseUrl || !serviceRoleKey) return false;
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/orderat-shop/${shopId}/${photoId}.jpg`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": mimeType,
        "x-upsert": "true",
      },
      body: bytes,
    });
    return res.ok;
  } catch {
    return false;
  }
};

// docs/marketing-tools.md's default, used whenever ORDERAT_SHOP_BASE_URL isn't set.
const shopBaseUrl = env("SHOP_BASE_URL") || "https://orderatweb.com/s/?";

// docs/marketing-tools.md: "fallback: derive from another secret or a constant with a comment; never
// crash if missing." Prefers a dedicated ORDERAT_SHOP_IP_SALT; failing that, derives one from the
// service role key (a one-way hash of it, not the key itself, so this never puts that secret's actual
// value at risk elsewhere) so the salt still differs project-to-project without a secret of its own;
// failing even that (SUPABASE_SERVICE_ROLE_KEY missing, which should never happen on a real deploy),
// a fixed string — rate limiting still works, just with a salt anyone reading this file also knows.
const ipSalt = env("SHOP_IP_SALT") || (serviceRoleKey ? await sha256HexOfString(`orderat-shop-ip-salt:${serviceRoleKey}`) : "orderat-shop-static-fallback-salt");

const handler = createShopHandler({
  sql,
  shopBaseUrl,
  publicPhotoBaseUrl: `${supabaseUrl}/storage/v1/object/public/orderat-shop/`,
  uploadPhoto,
  ipSalt,
});

Deno.serve((req) => handler(req));
