// Query validation for `GET /orderat-campaigns` (docs/marketing-tools.md). Both params are optional;
// an invalid value for either is this request's only way to fail here — everything else about the
// response comes from content the build already validated (server/campaigns/content.test.ts).

import { GCC_COUNTRIES, isValidDateString } from "./content.ts";

export interface CampaignsQuery {
  country?: string;
  today?: string;
}

export type CampaignsQueryResult = { ok: true; query: CampaignsQuery } | { ok: false; error: "invalid_body" };

/** `country` must be one of the six GCC codes when given; `today` must be a real YYYY-MM-DD date
 * when given. Either left out entirely is valid (the handler defaults them). */
export function validateCampaignsQuery(url: URL): CampaignsQueryResult {
  const country = url.searchParams.get("country");
  if (country !== null && !GCC_COUNTRIES.has(country)) return { ok: false, error: "invalid_body" };

  const today = url.searchParams.get("today");
  if (today !== null && !isValidDateString(today)) return { ok: false, error: "invalid_body" };

  return { ok: true, query: { country: country ?? undefined, today: today ?? undefined } };
}
