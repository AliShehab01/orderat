// Supabase Edge Function entry point for occasion campaigns (docs/marketing-tools.md).
// Deployed as: npm run hosting:deploy -- orderat-campaigns (supabase functions deploy orderat-campaigns --use-api)
// URL: https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-campaigns
//
// A public GET, called directly by the iPhone/Android apps (and, per docs/marketing-tools.md,
// potentially a future web page — hence the same CORS as orderat-shop). All the actual logic
// (query validation, filtering, CORS, the "never return a style's prompt" rule) is the same
// server/campaigns/handler.ts a test can exercise directly; this file only wires it to the real
// content bundle. See supabase/functions/orderat-whatsapp/index.ts for notes on the import layout,
// --use-api and the orderat- prefixing this shares with the other functions.
//
// content/campaigns.json and content/studio-styles.json are imported here with Deno's
// `with { type: "json" }` import attribute — required for a static JSON import under Deno; the
// `--use-api` bundler resolves this at deploy time, so the file never needs to exist on a real
// filesystem at runtime. server/campaigns/content.ts's header explains why the Node/test side uses a
// plain import instead of this same syntax.

import campaignsFile from "../../../content/campaigns.json" with { type: "json" };
import studioStylesFile from "../../../content/studio-styles.json" with { type: "json" };
import type { Campaign, StudioStyle } from "../../../server/campaigns/content.ts";
import { createCampaignsHandler } from "../../../server/campaigns/handler.ts";

const handler = createCampaignsHandler({
  campaigns: campaignsFile.campaigns as Campaign[],
  styles: studioStylesFile.styles as StudioStyle[],
  version: campaignsFile.version,
});

Deno.serve((req) => handler(req));
