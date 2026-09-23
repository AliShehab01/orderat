// The order agent: reads one customer message and decides what to store and what to reply.
// The agent only acknowledges and summarises. The owner still confirms every order in Orderat.

import type { Order, OrderItem, Product } from "../../src/lib/types";
import { parseOrderText } from "../../src/lib/parser";
import { findChangeCandidate, keyOf } from "../../src/lib/plan";
import type { IncomingMessage } from "../whatsapp/incoming";
import type { Lang, MemoryStore } from "./store";

export type { Lang } from "./store";
export type OutcomeKind = "new" | "change" | "time" | "ask_quantity" | "noted" | "help" | "media";
export interface AgentOutcome { kind: OutcomeKind; reply: string; order?: Order }

const TIME_ZONE = "Asia/Bahrain";

export const detectLang = (text: string): Lang => (/[؀-ۿ]/.test(text) ? "ar" : "en");

export function formatCollection(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-BH-u-nu-latn" : "en-GB", {
    // hourCycle h12, not hour12: en-GB with hour12 prints noon as "0:00 pm".
    weekday: "long", hour: "numeric", minute: "2-digit", hourCycle: "h12", timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

const COPY = {
  ar: {
    hello: (name?: string) => (name ? `هلا ${name} 👋` : "هلا 👋"),
    got: "استلمنا طلبك:",
    collection: "الاستلام",
    askTime: "متى تحب تستلم الطلب؟ اكتب اليوم والساعة.",
    checkTime: "صح الوقت؟",
    notes: "ملاحظات",
    checking: "بنتأكد منه",
    confirmSoon: "بنأكد لك الطلب قريباً ✅",
    updated: "تم تحديث طلبك ✅",
    from: (a: string, b: string) => `من ${a} إلى ${b}`,
    added: "مضاف",
    timeLabel: "وقت الاستلام",
    changeSoon: "بنأكد لك التعديل قريباً.",
    askQuantity: (names: string) => `كم العدد من ${names}؟ اكتب العدد مع المنتج، مثال: 10 ${names}`,
    noted: "وصلت رسالتك 👍 بنرد عليك قريباً.",
    help: (menu: string) => `هلا والله 👋 أنا مساعد الطلبات.\nاكتب طلبك مع العدد ووقت الاستلام، مثال:\n10 براونيز بوكس الخميس الساعة 5 العصر\nالمنتجات: ${menu}`,
  },
  en: {
    hello: (name?: string) => (name ? `Hi ${name} 👋` : "Hi 👋"),
    got: "We got your order:",
    collection: "Collection",
    askTime: "When would you like to collect it? Send the day and time.",
    checkTime: "is that right?",
    notes: "Notes",
    checking: "we'll check this one",
    confirmSoon: "We'll confirm your order shortly ✅",
    updated: "Your order is updated ✅",
    from: (a: string, b: string) => `${a} → ${b}`,
    added: "added",
    timeLabel: "Collection time",
    changeSoon: "We'll confirm the change shortly.",
    askQuantity: (names: string) => `How many ${names} would you like? Send the number with the item, for example: 10 ${names}`,
    noted: "Got your message 👍 We'll reply shortly.",
    help: (menu: string) => `Hi 👋 I'm the order assistant.\nSend your order with quantities and collection time, for example:\n10 brownie box Thursday at 5 pm\nMenu: ${menu}`,
  },
} as const;

const MEDIA_ACK = "استلمنا رسالتك 👍 بنراجعها ونرد عليك قريباً.\nGot your message 👍 We'll get back to you shortly.";

function nameOf(products: Product[], id: string | undefined, lang: Lang): string | undefined {
  const p = products.find((x) => x.id === id);
  return p ? (lang === "ar" ? p.nameAr : p.name) : undefined;
}

function itemLines(items: OrderItem[], products: Product[], lang: Lang): string[] {
  return items.map((i) => {
    const name = nameOf(products, i.productId, lang);
    return name ? `• ${name} × ${i.quantity}` : `• ${i.rawText} (${COPY[lang].checking})`;
  });
}

function collectionLine(iso: string | undefined, confident: boolean, lang: Lang): string {
  const c = COPY[lang];
  if (!iso) return c.askTime;
  return `${c.collection}: ${formatCollection(iso, lang)}${confident ? "" : ` — ${c.checkTime}`}`;
}

const CONFIRMED = {
  ar: { title: "تم تأكيد طلبك ✅", thanks: "شكراً لك 🌸" },
  en: { title: "Your order is confirmed ✅", thanks: "Thank you!" },
} as const;

/** Message sent to the customer after the owner confirms the order in Orderat. */
export function confirmationMessage(order: Order, products: Product[], lang: Lang): string {
  const c = COPY[lang];
  return [
    CONFIRMED[lang].title,
    ...itemLines(order.items, products, lang),
    ...(order.collectionAt ? [`${c.collection}: ${formatCollection(order.collectionAt, lang)}`] : []),
    CONFIRMED[lang].thanks,
  ].join("\n");
}

export function handleCustomerMessage(msg: IncomingMessage, store: MemoryStore, products: Product[], now: Date): AgentOutcome {
  if (msg.type !== "text" || !msg.text?.trim()) return { kind: "media", reply: MEDIA_ACK };

  const lang = detectLang(msg.text);
  const c = COPY[lang];
  const draft = parseOrderText(msg.text, products, now);
  const withQty = draft.items.filter((i) => (i.quantity ?? 0) > 0);
  const open = store.openOrdersFor(msg.from, now)[0]?.order;

  if (open) {
    // A reply with only a time fills the missing time of the open order.
    if (!open.collectionAt && draft.collectionAt && withQty.length === 0) {
      open.collectionAt = draft.collectionAt;
      open.changes.push(`time: - → ${draft.collectionAt}`);
      return { kind: "time", order: open, reply: `${c.updated}\n${collectionLine(open.collectionAt, draft.collectionConfidence === "high", lang)}\n${c.changeSoon}` };
    }
    // Items for a different day are a new order, not a change.
    const differentDay = withQty.length > 0 && !!draft.collectionAt && !!open.collectionAt && keyOf(draft.collectionAt) !== keyOf(open.collectionAt);
    if (!differentDay) {
      const cand = findChangeCandidate({ ...draft, customerName: open.customerName }, [open], products, now);
      if (cand) {
        open.items = cand.items;
        open.collectionAt = cand.collectionAt;
        if (draft.notes) open.notes = [open.notes, draft.notes].filter(Boolean).join("; ");
        open.changes.push(cand.diffs.map((d) => `${d.label}: ${d.oldValue} → ${d.newValue}`).join("; "));
        const lines = cand.diffs.map((d) => {
          if (d.label === "time") {
            const next = formatCollection(d.newValue, lang);
            return d.oldValue === "-" ? `• ${c.timeLabel}: ${next}` : `• ${c.timeLabel}: ${c.from(formatCollection(d.oldValue, lang), next)}`;
          }
          const p = products.find((x) => x.name === d.label);
          const name = p ? (lang === "ar" ? p.nameAr : p.name) : d.label;
          return d.oldValue === "0" ? `• ${name} × ${d.newValue} (${c.added})` : `• ${name}: ${c.from(d.oldValue, d.newValue)}`;
        });
        return { kind: "change", order: open, reply: [c.updated, ...lines, c.changeSoon].join("\n") };
      }
    }
  }

  if (withQty.length > 0) {
    const order: Order = {
      id: crypto.randomUUID(),
      customerName: msg.profileName ?? draft.customerName ?? msg.from,
      items: withQty.map((i) => ({ productId: i.productId, rawText: i.rawText, quantity: i.quantity! })),
      collectionAt: draft.collectionAt,
      notes: draft.notes,
      status: "pending",
      changes: [],
      createdAt: now.toISOString(),
    };
    store.add({ order, customerPhone: msg.from, lang });
    const lines = [
      c.hello(msg.profileName),
      c.got,
      ...itemLines(order.items, products, lang),
      collectionLine(order.collectionAt, draft.collectionConfidence === "high", lang),
      ...(order.notes ? [`${c.notes}: ${order.notes}`] : []),
      c.confirmSoon,
    ];
    return { kind: "new", order, reply: lines.join("\n") };
  }

  if (draft.items.length > 0) {
    const names = draft.items.map((i) => nameOf(products, i.productId, lang) ?? i.rawText).join("، ");
    return { kind: "ask_quantity", reply: c.askQuantity(names) };
  }

  if (open) return { kind: "noted", reply: c.noted };

  const menu = products.map((p) => (lang === "ar" ? p.nameAr : p.name)).join(lang === "ar" ? "، " : ", ");
  return { kind: "help", reply: c.help(menu) };
}
