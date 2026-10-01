// Delivery details in AI order entry (tester feedback, 1 Oct 2026, section 1): whether the customer wants
// delivery or pickup, the delivery address, and any directions for the driver. Asked of the model only by
// orderat-parse (server/ai/gemini.ts's `withDelivery`; the WhatsApp agent's extraction is unchanged), and
// returned to the apps as the response's `fulfillment`, `address` and `deliveryNote` keys
// (server/parse/handler.ts), which older apps simply ignore.
//
// The model's answer is checked here before it goes anywhere: only known fulfillment values, only
// non-empty strings in the address, Western digits in the numbered Bahrain parts, and a length cap — and
// the address and directions never stay in the order's notes (stripDeliveryFromNotes), which keep only
// real notes.

export type Fulfillment = "pickup" | "delivery";

/** A Bahrain address is area / block / road / building (/ flat); elsewhere (Saudi, UAE...) the address
 * is a free-text line in `text`, with its `city`. `text` is the whole address as the customer wrote it. */
export interface DeliveryAddress {
  area?: string;
  block?: string;
  road?: string;
  building?: string;
  flat?: string;
  city?: string;
  text?: string;
}

export interface DeliveryInfo {
  fulfillment: Fulfillment | null;
  address: DeliveryAddress | null;
  deliveryNote: string | null;
}

/** The response-schema properties the model fills (Gemini's OpenAPI subset, like gemini.ts's own). */
export const DELIVERY_SCHEMA_PROPERTIES = {
  fulfillment: {
    type: "STRING",
    enum: ["pickup", "delivery"],
    nullable: true,
    description: "delivery when the customer asks for delivery or gives an address or a location; pickup when they will collect it themselves; otherwise null.",
  },
  address: {
    type: "OBJECT",
    nullable: true,
    description: "The delivery address, only when the customer gives one.",
    properties: {
      area: { type: "STRING", nullable: true, description: "Area or neighbourhood, e.g. Riffa, Juffair, السنابس." },
      block: { type: "STRING", nullable: true, description: "Block number (مجمع), Western digits." },
      road: { type: "STRING", nullable: true, description: "Road or street number or name (طريق / شارع)." },
      building: { type: "STRING", nullable: true, description: "Building, house or villa number (مبنى / منزل / بيت / فيلا)." },
      flat: { type: "STRING", nullable: true, description: "Flat or apartment number (شقة)." },
      city: { type: "STRING", nullable: true, description: "City, when stated (e.g. Riyadh, Dubai, المحرق)." },
      text: { type: "STRING", nullable: true, description: "The whole address exactly as the customer wrote it." },
    },
  },
  deliveryNote: {
    type: "STRING",
    nullable: true,
    description: "Directions for the driver only: landmarks, gate or door, 'call when outside'.",
  },
} as const;

/** How the model must describe `notes` once delivery details have their own place. */
export const NOTES_WITH_DELIVERY_DESCRIPTION =
  "Special requests such as allergies or writing on a cake. Never the delivery address, a location or directions for the driver: those go in address and deliveryNote.";

/** The prompt lines for the delivery fields. */
export const DELIVERY_PROMPT_RULES = [
  "- Delivery: an address, a location pin or map link, or words like توصيل, وصلوه, وصلها, ارسلوه, delivery, deliver, send to => fulfillment delivery. Words like استلام, بستلم, باخذه, بمر عليكم, pickup, pick up, collect => fulfillment pickup. Otherwise null.",
  "- Address: for a Bahrain address fill area, block (مجمع), road (طريق), building (مبنى/منزل/بيت) and flat (شقة) as far as the customer gives them, with Western digits. For any other address (Saudi Arabia, UAE and others) put the free-text line in text and the city in city. Always put the whole address exactly as written in text.",
  "- Put directions for the driver (landmarks, gate colour, call when outside) in deliveryNote.",
  "- Never put the address, a location or directions in notes.",
];

const MAX_PART_CHARS = 300;
const ADDRESS_KEYS = ["area", "block", "road", "building", "flat", "city", "text"] as const;
/** The numbered parts of a Bahrain address, whose digits the apps' fields want Western. */
const NUMBERED_KEYS = new Set(["block", "road", "building", "flat"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits as 0-9. */
function westernDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, MAX_PART_CHARS) : undefined;
}

/** The model's raw delivery answer, checked and tidied. An address without a stated fulfillment means
 * delivery. */
export function toDelivery(raw: { fulfillment?: unknown; address?: unknown; deliveryNote?: unknown }): DeliveryInfo {
  let address: DeliveryAddress | null = null;
  if (isPlainObject(raw.address)) {
    const out: DeliveryAddress = {};
    for (const key of ADDRESS_KEYS) {
      const value = cleanText(raw.address[key]);
      if (value !== undefined) out[key] = NUMBERED_KEYS.has(key) ? westernDigits(value) : value;
    }
    if (Object.keys(out).length > 0) address = out;
  }
  const stated = raw.fulfillment === "pickup" || raw.fulfillment === "delivery" ? raw.fulfillment : null;
  return {
    fulfillment: stated ?? (address ? "delivery" : null),
    address,
    deliveryNote: cleanText(raw.deliveryNote) ?? null,
  };
}

/** Labels a line may be left with once its address is gone ("Address:", "العنوان:"). */
const DANGLING_LABELS = new Set(["address", "the address", "location", "delivery", "deliver to", "send to", "العنوان", "عنوان", "الموقع", "موقع", "التوصيل", "توصيل", "توصيل الى", "توصيل إلى"]);
const EDGE_SEPARATORS = /^[\s,،;؛:\-–—]+|[\s,،;؛:\-–—]+$/g;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tidy(value: string): string {
  const out = collapse(value).replace(EDGE_SEPARATORS, "");
  return DANGLING_LABELS.has(out.toLowerCase()) ? "" : out;
}

/**
 * `notes` without the delivery address and the driver's directions, once those were extracted into
 * their own fields: every sentence (per line) that carries them is dropped, and any copy left inside
 * the rest is cut out, with the label and separators it leaves behind. Undefined when nothing is left.
 */
export function stripDeliveryFromNotes(notes: string | undefined, delivery: DeliveryInfo): string | undefined {
  if (notes === undefined) return undefined;
  const needles = [delivery.address?.text, delivery.deliveryNote].filter((n): n is string => typeof n === "string" && n.length >= 4).map(collapse);
  if (needles.length === 0) return notes;

  const lines: string[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const sentences = line.split(/(?<=[.!?؟])\s+/);
    let rest = sentences.filter((s) => !needles.some((n) => collapse(s).includes(n))).join(" ");
    rest = collapse(rest);
    for (const n of needles) rest = rest.split(n).join(" ");
    rest = tidy(rest);
    if (rest && /[\p{L}\p{N}]/u.test(rest)) lines.push(rest);
  }
  const out = lines.join("\n").trim();
  return out || undefined;
}
