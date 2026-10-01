// "Start in 3 steps" on the home page: what a seller does to start, a rough time for each step, and
// the short facts under the steps. Keep both true; the trial length comes from config.mjs PRICING.

import { PRICING } from "../config.mjs";

export const STEPS = [
  {
    time: { ar: "دقيقة", en: "1 minute" },
    // The store badges (or "coming soon") from config.mjs STORE_LINKS sit under this step.
    showStoreBadges: true,
    ar: {
      title: "حمّل التطبيق",
      body: "نزّل اوردرات على جوالك واختر نوع نشاطك: مشروع منزلي، متجر، خدمات، مطعم، أو عربة طعام.",
    },
    en: {
      title: "Download the app",
      body: "Get Orderat on your phone and pick your business type: home business, shop, services, restaurant or food truck.",
    },
  },
  {
    time: { ar: "دقيقتين", en: "2 minutes" },
    ar: {
      title: "أضف منتجاتك",
      body: "أضف منتجاتك بأسعارها وصورها. ابدأ بمنتج واحد، وكمّل الباقي على راحتك.",
    },
    en: {
      title: "Add your products",
      body: "Add your products with their prices and photos. Start with one, and add the rest when it suits you.",
    },
  },
  {
    time: { ar: "فوراً", en: "Right away" },
    ar: {
      title: "شارك رابط متجرك",
      body: `حطّه في بايو إنستغرام أو حالة واتساب، وابدأ تستقبل الطلبات مرتبة في اوردرات. رابط المتجر من مزايا الاشتراك، وأول ${PRICING.trialAr} مجاناً.`,
    },
    en: {
      title: "Share your shop link",
      body: `Put it in your Instagram bio or WhatsApp status, and start receiving orders, organized in Orderat. The shop link is part of the subscription, free for the first ${PRICING.trialDays} days.`,
    },
  },
];

/** The facts row under the steps: a big value and a short label. */
export const START_STATS = [
  { value: { ar: "0%", en: "0%" }, label: { ar: "عمولة على الطلبات", en: "commission on orders" } },
  { value: { ar: "مجاني", en: "Free" }, label: { ar: "للبدء: الطلبات والعملاء والفواتير", en: "to start: orders, customers and receipts" } },
  { value: { ar: PRICING.trialAr, en: `${PRICING.trialDays} days` }, label: { ar: "تجربة مجانية للاشتراك", en: "free trial of the subscription" } },
  { value: { ar: "عربي وإنجليزي", en: "Arabic & English" }, label: { ar: "في التطبيق ورابط المتجر", en: "in the app and on your shop link" } },
];
