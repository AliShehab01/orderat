// Types, validation and query helpers for the marketing content bundle (docs/marketing-tools.md):
// content/campaigns.json + content/studio-styles.json. Both files are loaded by two thin,
// runtime-specific loaders — supabase/functions/orderat-campaigns/index.ts and
// supabase/functions/orderat-studio/index.ts import the JSON directly with Deno's
// `with { type: "json" }` attribute (required for a static JSON import under Deno; the Supabase
// `--use-api` bundler resolves it at deploy time, so the file never needs to exist on a real
// filesystem at runtime), while every test imports the same files with a plain relative import
// (Node/vitest's esbuild-based loader handles that natively, no attribute needed) — so this module
// itself takes the parsed data as plain arguments and never imports the JSON, and needs no
// Deno-vs-Node branch at all.
//
// `prompt` on a StudioStyle is server-only (docs/marketing-tools.md: "Style prompts ... are
// server-only and never returned by any API") — toPublicStyle is the one place that's enforced.

export interface Bilingual {
  ar: string;
  en: string;
}

export interface BilingualList {
  ar: string[];
  en: string[];
}

export interface Campaign {
  id: string;
  occasion: string;
  name: Bilingual;
  emoji: string;
  countries: string[];
  startDate: string;
  endDate: string;
  promoteFrom: string;
  accent: string;
  headline: Bilingual;
  tips: BilingualList;
  productIdeas: BilingualList;
  captions: BilingualList;
  hashtags: BilingualList;
  studioStyles: string[];
}

export interface StudioStyle {
  id: string;
  name: Bilingual;
  emoji: string;
  swatch: string;
  previewUrl: string | null;
  occasion: string | null;
  /** Server-only — never returned by any API. Stripped by toPublicStyle. */
  prompt: string;
}

export type PublicStudioStyle = Omit<StudioStyle, "prompt">;

export interface CampaignsFile {
  version: string;
  campaigns: Campaign[];
}

export interface StudioStylesFile {
  styles: StudioStyle[];
}

/** The six GCC country codes campaigns.json's `countries` and the app's currency→country mapping
 * both use (docs/marketing-tools.md). */
export const GCC_COUNTRIES = new Set(["BH", "SA", "AE", "KW", "QA", "OM"]);

/** Only these five placeholders may appear in a campaign's caption text — the app fills them in
 * (docs/marketing-tools.md), so anything else would render literally in a seller's post. */
const ALLOWED_PLACEHOLDERS = new Set(["shop", "item", "price", "link", "date"]);

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** True calendar validity, not just the YYYY-MM-DD shape — rejects e.g. "2026-02-30" (which
 * `new Date(...)` would otherwise silently roll over into March). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function bilingualStringOk(value: unknown): value is Bilingual {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return isNonEmptyString(o.ar) && isNonEmptyString(o.en);
}

function bilingualListOk(value: unknown): value is BilingualList {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return isStringArray(o.ar) && isStringArray(o.en);
}

function placeholderIssues(strings: string[]): string[] {
  const issues: string[] = [];
  for (const s of strings) {
    for (const m of s.matchAll(/\{([a-zA-Z]+)\}/g)) {
      if (!ALLOWED_PLACEHOLDERS.has(m[1])) issues.push(`unknown placeholder "{${m[1]}}" in "${s}"`);
    }
  }
  return issues;
}

/**
 * Validates the whole content bundle against docs/marketing-tools.md's rules and returns every
 * problem found as a human-readable string (empty array = valid). Never throws — a malformed entry
 * is reported, not a crash, so this doubles as both the CI-time check (server/campaigns/content.test.ts)
 * and, if a caller ever wants it, a startup sanity check. Deliberately collects every issue instead of
 * stopping at the first, so one content-editing pass can fix everything at once.
 */
export function validateMarketingContent(input: { campaigns: unknown; styles: unknown }): string[] {
  const issues: string[] = [];

  const campaignsRoot = input.campaigns as { version?: unknown; campaigns?: unknown } | null | undefined;
  if (typeof campaignsRoot !== "object" || campaignsRoot === null) {
    return [...issues, "campaigns.json: must be an object"];
  }
  if (!isNonEmptyString(campaignsRoot.version)) issues.push('campaigns.json: missing or empty top-level "version"');
  const campaignList = Array.isArray(campaignsRoot.campaigns) ? (campaignsRoot.campaigns as unknown[]) : undefined;
  if (!campaignList) issues.push('campaigns.json: "campaigns" must be an array');

  const stylesRoot = input.styles as { styles?: unknown } | null | undefined;
  if (typeof stylesRoot !== "object" || stylesRoot === null) {
    return [...issues, "studio-styles.json: must be an object"];
  }
  const styleList = Array.isArray(stylesRoot.styles) ? (stylesRoot.styles as unknown[]) : undefined;
  if (!styleList) issues.push('studio-styles.json: "styles" must be an array');

  const styleIds = new Set<string>();
  if (styleList) {
    styleList.forEach((raw, i) => {
      const style = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<StudioStyle>;
      const where = `studio-styles.json[${i}]${isNonEmptyString(style.id) ? ` (${style.id})` : ""}`;
      if (!isNonEmptyString(style.id)) issues.push(`${where}: missing "id"`);
      else if (styleIds.has(style.id)) issues.push(`${where}: duplicate style id "${style.id}"`);
      else styleIds.add(style.id);
      if (!bilingualStringOk(style.name)) issues.push(`${where}: "name" needs non-empty "ar" and "en" strings`);
      if (!isNonEmptyString(style.emoji)) issues.push(`${where}: "emoji" must be a non-empty string`);
      if (!(typeof style.swatch === "string" && HEX_COLOR_RE.test(style.swatch))) issues.push(`${where}: "swatch" must be #RRGGBB`);
      if (style.previewUrl !== null && !(typeof style.previewUrl === "string" && style.previewUrl.startsWith("https://"))) {
        issues.push(`${where}: "previewUrl" must be null or an https:// URL`);
      }
      if (!("occasion" in style) || (style.occasion !== null && !isNonEmptyString(style.occasion))) {
        issues.push(`${where}: "occasion" must be null or a non-empty string`);
      }
      if (!isNonEmptyString(style.prompt)) issues.push(`${where}: "prompt" must be a non-empty string`);
    });
  }

  if (campaignList) {
    const campaignIds = new Set<string>();
    campaignList.forEach((raw, i) => {
      const c = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Campaign>;
      const where = `campaigns.json[${i}]${isNonEmptyString(c.id) ? ` (${c.id})` : ""}`;

      if (!isNonEmptyString(c.id)) issues.push(`${where}: missing "id"`);
      else if (campaignIds.has(c.id)) issues.push(`${where}: duplicate campaign id "${c.id}"`);
      else campaignIds.add(c.id);

      if (!isNonEmptyString(c.occasion)) issues.push(`${where}: missing "occasion"`);
      if (!bilingualStringOk(c.name)) issues.push(`${where}: "name" needs non-empty "ar" and "en" strings`);
      if (!isNonEmptyString(c.emoji)) issues.push(`${where}: "emoji" must be a non-empty string`);

      if (!Array.isArray(c.countries) || c.countries.length === 0 || !c.countries.every((code) => typeof code === "string" && GCC_COUNTRIES.has(code))) {
        issues.push(`${where}: "countries" must be a non-empty array of GCC codes (BH SA AE KW QA OM)`);
      }
      if (!(typeof c.accent === "string" && HEX_COLOR_RE.test(c.accent))) issues.push(`${where}: "accent" must be #RRGGBB`);
      if (!bilingualStringOk(c.headline)) issues.push(`${where}: "headline" needs non-empty "ar" and "en" strings`);
      if (!bilingualListOk(c.tips)) issues.push(`${where}: "tips" needs "ar" and "en" string arrays`);
      if (!bilingualListOk(c.productIdeas)) issues.push(`${where}: "productIdeas" needs "ar" and "en" string arrays`);

      if (!bilingualListOk(c.captions)) {
        issues.push(`${where}: "captions" needs "ar" and "en" string arrays`);
      } else {
        for (const problem of placeholderIssues([...c.captions.ar, ...c.captions.en])) issues.push(`${where}: ${problem}`);
      }
      if (!bilingualListOk(c.hashtags)) issues.push(`${where}: "hashtags" needs "ar" and "en" string arrays`);

      const datesShapeOk = isValidDateString(c.startDate) && isValidDateString(c.endDate) && isValidDateString(c.promoteFrom);
      if (!datesShapeOk) {
        issues.push(`${where}: "startDate"/"endDate"/"promoteFrom" must all be valid YYYY-MM-DD dates`);
      } else if (!(c.promoteFrom! <= c.startDate! && c.startDate! <= c.endDate!)) {
        issues.push(`${where}: dates must satisfy promoteFrom <= startDate <= endDate`);
      }

      if (!Array.isArray(c.studioStyles) || c.studioStyles.length === 0) {
        issues.push(`${where}: "studioStyles" must be a non-empty array`);
      } else {
        for (const styleId of c.studioStyles) {
          if (!(typeof styleId === "string" && styleIds.has(styleId))) issues.push(`${where}: references unknown studio style "${String(styleId)}"`);
        }
      }
    });
  }

  return issues;
}

/** Strips `prompt` — the one field docs/marketing-tools.md says must never appear in an API response. */
export function toPublicStyle(style: StudioStyle): PublicStudioStyle {
  return {
    id: style.id,
    name: style.name,
    emoji: style.emoji,
    swatch: style.swatch,
    previewUrl: style.previewUrl,
    occasion: style.occasion,
  };
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface FilterCampaignsOptions {
  /** GCC code; when omitted, campaigns for every country are kept. */
  country?: string;
  /** YYYY-MM-DD "today", per docs/marketing-tools.md already resolved to Asia/Riyadh by the caller. */
  today: string;
}

/**
 * `GET /orderat-campaigns`'s filter: keeps campaigns whose `endDate >= today` and
 * `promoteFrom <= today + 120 days`, optionally narrowed to one country, sorted by `startDate`. Plain
 * string comparisons are correct here because every date is a validated "YYYY-MM-DD" (lexicographic
 * order matches chronological order for that format).
 */
export function filterCampaigns(campaigns: Campaign[], opts: FilterCampaignsOptions): Campaign[] {
  const horizon = addDays(opts.today, 120);
  return campaigns
    .filter((c) => c.endDate >= opts.today)
    .filter((c) => c.promoteFrom <= horizon)
    .filter((c) => !opts.country || c.countries.includes(opts.country))
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function findCampaignById(campaigns: Campaign[], id: string): Campaign | undefined {
  return campaigns.find((c) => c.id === id);
}

export function findStyleById(styles: StudioStyle[], id: string): StudioStyle | undefined {
  return styles.find((s) => s.id === id);
}

/** "Today" in Asia/Riyadh (UTC+3, no DST), as YYYY-MM-DD — docs/marketing-tools.md's default for
 * both the `today` query param and the AI captions/photo prompts' occasion-date context. The en-CA
 * locale is a well-known trick for getting Intl.DateTimeFormat to emit ISO-ordered (year-month-day)
 * output directly, with no manual field reassembly. */
export function todayInRiyadh(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
