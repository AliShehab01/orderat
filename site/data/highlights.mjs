// The moving strip under the home page hero: short facts about Orderat, then the kinds of business it
// is made for. Every chip must stay true: no customer names, no counts, no third-party logos (payment
// names as plain text are fine). `icon` is a name from lib/icons.mjs.

export const HIGHLIGHTS = [
  { icon: "flagBH", ar: "صُنع في البحرين", en: "Made in Bahrain" },
  { icon: "globe", ar: "عربي أولاً", en: "Arabic first" },
  { icon: "chat", ar: "لطلبات واتساب وإنستغرام", en: "For WhatsApp and Instagram orders" },
  // The shop link's payment options; the customer pays the seller directly.
  { icon: "wallet", ar: "بنفت باي · STC Pay · تحويل بنكي", en: "BenefitPay · STC Pay · bank transfer" },
  // Data stays on the device unless the seller turns on cloud sync (see the privacy policy).
  { icon: "phone", ar: "بياناتك على جوالك", en: "Your data stays on your phone" },
  { icon: "percent", ar: "بدون عمولة على الطلبات", en: "No commission on orders" },
  // VAT rates for Bahrain, Saudi Arabia, the UAE and Oman (config.mjs VAT_RATES).
  { icon: "vat", ar: "فواتير ضريبية للخليج العربي", en: "VAT invoices for the Arabian Gulf" },
  { icon: "ask", ar: "اسأل اوردرات بالذكاء الاصطناعي", en: "Ask Orderat, with AI" },
];

export const HIGHLIGHT_BUSINESS_TYPES = [
  { icon: "cake", ar: "حلويات", en: "Sweets" },
  { icon: "home", ar: "مشروع منزلي", en: "Home business" },
  { icon: "shop", ar: "بوتيك", en: "Boutique" },
  { icon: "restaurant", ar: "مطعم وكافيه", en: "Restaurant and café" },
  { icon: "truck", ar: "عربة طعام", en: "Food truck" },
  { icon: "scissors", ar: "خدمات", en: "Services" },
];
