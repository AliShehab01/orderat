// HTTP handler for `GET /orderat-campaigns` (docs/marketing-tools.md). Plain Request -> Response, like
// server/ask/handler.ts, so it runs the same under Deno, Node or a test; supabase/functions/orderat-campaigns/index.ts
// only wires in the content bundle and calls Deno.serve.
//
// CORS is applied inside this factory (withPublicCors), not left to index.ts to layer on — unlike
// server/owner/handler.ts, which has no CORS of its own and relies entirely on its Edge Function's
// index.ts to wrap it, this keeps the wrapping directly covered by this feature's own handler.test.ts
// rather than only by server/shared/cors.test.ts's generic coverage. orderat-shop (server/shop/handler.ts)
// follows the same choice, for the same reason.

import { withPublicCors } from "../shared/cors.ts";
import { filterCampaigns, toPublicStyle, todayInRiyadh, type Campaign, type StudioStyle } from "./content.ts";
import { validateCampaignsQuery } from "./validate.ts";

export interface CampaignsHandlerDeps {
  campaigns: Campaign[];
  styles: StudioStyle[];
  /** content/campaigns.json's own "version" field, echoed verbatim in the response. */
  version: string;
  now?: () => Date;
  /** Structured, content-free log line per request (counts and status only). */
  log?: (entry: Record<string, unknown>) => void;
}

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders } });
}

const invalidBodyResponse = () => jsonResponse({ error: "invalid_body" }, 400);

export function createCampaignsHandler(deps: CampaignsHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? console.log;
  const now = deps.now ?? (() => new Date());

  return withPublicCors(async (req) => {
    if (req.method !== "GET") return invalidBodyResponse();

    const url = new URL(req.url);
    const validated = validateCampaignsQuery(url);
    if (!validated.ok) {
      log({ event: "campaigns", status: 400 });
      return invalidBodyResponse();
    }

    const today = validated.query.today ?? todayInRiyadh(now());
    const campaigns = filterCampaigns(deps.campaigns, { country: validated.query.country, today });
    // The full style catalog, not just campaign-referenced ones: the app's general Photo Studio grid
    // (not opened from a campaign) needs every style too (docs/marketing-tools.md's app behavior).
    const styles = deps.styles.map(toPublicStyle);

    log({ event: "campaigns", status: 200, country: validated.query.country ?? "all", count: campaigns.length });
    return jsonResponse({ version: deps.version, campaigns, studioStyles: styles }, 200, { "Cache-Control": "public, max-age=3600" });
  });
}
