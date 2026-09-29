// Central site configuration. Change these two spots and every generated page follows.
//
// 1. Custom domain at launch: change SITE_URL below (one line).
// 2. Store links at launch: fill in STORE_LINKS below (one object, one line each).
//    While a link is null, pages show a "coming soon" badge instead of a store button.

export const SITE_URL = process.env.SITE_URL || "https://orderatweb.com";

/** @type {{ ios: string | null, android: string | null }} */
export const STORE_LINKS = {
  ios: null,
  android: null,
};

export const BRAND = {
  nameAr: "اوردرات",
  nameEn: "Orderat",
  tagline: {
    ar: "طلبات واتساب وإنستغرام في مكان واحد",
    en: "WhatsApp and Instagram orders, in one place",
  },
  email: "orderat.world@gmail.com",
  instagramHandle: "orderat.app",
  instagramUrl: "https://instagram.com/orderat.app",
  tiktokHandle: "orderat.app",
  tiktokUrl: "https://tiktok.com/@orderat.app",
  demoShopUrl: `${SITE_URL}/s/?demo`,
  themeColor: "#2f3fb0",
};

export const PRICING = {
  trialDays: 7,
  // Arabic counts 3-10 take the plural "أيام"; keep this in step with trialDays.
  trialAr: "7 أيام",
  monthly: { amountUSD: "9.99" },
  yearly: { amountUSD: "79.99" },
  note: {
    ar: "المتاجر تعرض السعر بعملتك المحلية.",
    en: "App stores show local pricing for your country.",
  },
};

// GCC VAT rates mentioned in marketing copy — keep in sync with docs/sme-phase-1.md.
export const VAT_RATES = {
  BH: { label: { ar: "البحرين", en: "Bahrain" }, rate: "10%" },
  SA: { label: { ar: "السعودية", en: "Saudi Arabia" }, rate: "15%" },
  AE: { label: { ar: "الإمارات", en: "UAE" }, rate: "5%" },
  OM: { label: { ar: "عُمان", en: "Oman" }, rate: "5%" },
};

export const LOCALES = {
  ar: { code: "ar", dir: "rtl", base: "" },
  en: { code: "en", dir: "ltr", base: "/en" },
};
