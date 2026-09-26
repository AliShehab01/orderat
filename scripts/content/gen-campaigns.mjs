// Generates content/campaigns.json (docs/marketing-tools.md, part A): GCC occasions from 2026-09
// to mid-2028. Hijri dates come from the Umm al-Qura calendar (run scripts/content/hijri-dates.mjs to
// list them); when a moon sighting moves a date, fix it in the calendar below, run
// `npm run content:build`, then `npm run hosting:deploy -- orderat-campaigns`.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ALL = ["BH", "SA", "AE", "KW", "QA", "OM"];

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- occasion templates ----------

const teachersDay = {
  occasion: "teachers_day", emoji: "🍎", accent: "#E4572E", lead: 14, countries: ALL, styles: ["teachers_day", "white"],
  name: { ar: "يوم المعلم", en: "Teachers' Day" },
  headline: { ar: "هدية حلوة لكل معلمة", en: "A sweet thank-you for every teacher" },
  tips: {
    ar: [
      "افتح الطلب المسبق قبل أسبوعين، الأمهات يطلبون بكمية للصف كله",
      "سوّ بوكس صغير بسعر مناسب يتوزع على أكثر من معلمة",
      "اعرض كتابة اسم المعلمة أو عبارة شكر على التغليف",
      "حدد آخر يوم للطلب عشان تلحق على التجهيز",
    ],
    en: [
      "Open pre-orders two weeks early; mums order for the whole class",
      "Make a small, affordable box that works for several teachers",
      "Offer the teacher's name or a thank-you note on the packaging",
      "Set a last day to order so you have time to prepare",
    ],
  },
  productIdeas: {
    ar: ["بوكس ميني كب كيك", "كوكيز مكتوب عليها شكراً معلمتي", "توزيعات صغيرة مع كرت شكر", "كيكة صغيرة للمعلمة"],
    en: ["Mini cupcake box", "Thank-you teacher cookies", "Small giveaways with a thank-you card", "A small cake for the teacher"],
  },
  captions: {
    ar: [
      "🍎 يوم المعلم قرّب!\nقولوا شكراً لمعلماتكم بـ{item} من {shop} 💛\nالسعر: {price}\nالطلب المسبق مفتوح والكمية محدودة 👇\n{link}",
      "أحلى هدية للمعلمة ✏️🍎\n{item} مغلّف مع كرت شكر باسم المعلمة\nاطلبوا بدري من {shop}\n{link}",
      "لأن المعلمة تستاهل 💐\nتوزيعات يوم المعلم من {shop}\n{item} بـ {price}\nللطلب راسلونا واتساب 👇\n{link}",
    ],
    en: [
      "🍎 Teachers' Day is coming!\nSay thank you with {item} from {shop} 💛\nPrice: {price}\nPre-orders are open, limited quantity 👇\n{link}",
      "The sweetest gift for teachers ✏️🍎\n{item}, wrapped with a thank-you card with the teacher's name\nOrder early from {shop}\n{link}",
      "Because teachers deserve it 💐\nTeachers' Day treats from {shop}\n{item} for {price}\nMessage us on WhatsApp to order 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#يوم_المعلم", "#شكرا_معلمتي", "#توزيعات", "#هدايا"], en: ["#TeachersDay", "#ThankYouTeacher", "#Giveaways", "#Homemade"] },
};

function nationalDay({ occasion, country, emoji, accent, style, lead = 14, nameAr, nameEn, countryAr, countryEn, colorsAr, colorsEn, tagsAr, tagsEn }) {
  return {
    occasion, emoji, accent, lead, countries: [country], styles: [style, "white"],
    name: { ar: nameAr, en: nameEn },
    headline: { ar: `كل عام و${countryAr} بخير`, en: `Celebrate ${countryEn} with your best treats` },
    tips: {
      ar: [
        `لوّن الحلويات والتغليف بألوان العلم (${colorsAr})`,
        "الشركات والمدارس تطلب توزيعات بكميات، جهّز عرض خاص للكميات",
        "افتح الطلب المسبق قبل أسبوعين وحدد آخر يوم للطلب",
        "صوّر منتجك بستايل المناسبة من استوديو الصور",
      ],
      en: [
        `Use the flag colors (${colorsEn}) on your treats and packaging`,
        "Companies and schools order giveaways in bulk; prepare a bulk offer",
        "Open pre-orders two weeks early and set a last day to order",
        "Shoot your product in the occasion style with the photo studio",
      ],
    },
    productIdeas: {
      ar: ["كب كيك بألوان العلم", "كوكيز بألوان العلم", "بوكس توزيعات للشركات", "كيكة احتفالية"],
      en: ["Cupcakes in the flag colors", "Flag-color cookies", "Giveaway boxes for companies", "A celebration cake"],
    },
    captions: {
      ar: [
        `${emoji} كل عام و${countryAr} بخير!\nاحتفلوا معنا بـ{item} بألوان العلم من {shop}\nالسعر: {price}\nالطلب المسبق مفتوح 👇\n{link}`,
        `توزيعات ${nameAr} جاهزة 🎉\n{item} بـ {price}\nعروض خاصة للشركات والمدارس\nاطلبوا بدري من {shop}\n{link}`,
        `فرحة الوطن أحلى مع {shop} ${emoji}\nجربوا {item}، نسخة خاصة بمناسبة ${nameAr}\nالكمية محدودة، احجزوا طلبكم الحين 👇\n{link}`,
      ],
      en: [
        `${emoji} Happy ${nameEn}, ${countryEn}!\nCelebrate with {item} in the flag colors from {shop}\nPrice: {price}\nPre-orders are open 👇\n{link}`,
        `${nameEn} treats are ready 🎉\n{item} for {price}\nSpecial offers for companies and schools\nOrder early from {shop}\n{link}`,
        `Celebrate with {shop} ${emoji}\nTry our special ${nameEn} {item}\nLimited quantity, book your order now 👇\n{link}`,
      ],
    },
    hashtags: { ar: tagsAr, en: tagsEn },
  };
}

const bahrainNationalDay = nationalDay({
  occasion: "national_day", country: "BH", emoji: "🇧🇭", accent: "#CE1126", style: "national_day_bh", lead: 21,
  nameAr: "العيد الوطني", nameEn: "Bahrain National Day", countryAr: "البحرين", countryEn: "Bahrain",
  colorsAr: "الأحمر والأبيض", colorsEn: "red and white",
  tagsAr: ["#العيد_الوطني", "#البحرين", "#العيد_الوطني_البحريني", "#توزيعات"], tagsEn: ["#BahrainNationalDay", "#Bahrain", "#Giveaways", "#Homemade"],
});
const saudiNationalDay = nationalDay({
  occasion: "national_day", country: "SA", emoji: "🇸🇦", accent: "#006C35", style: "national_day_sa",
  nameAr: "اليوم الوطني السعودي", nameEn: "Saudi National Day", countryAr: "السعودية", countryEn: "Saudi Arabia",
  colorsAr: "الأخضر والأبيض", colorsEn: "green and white",
  tagsAr: ["#اليوم_الوطني_السعودي", "#السعودية", "#توزيعات", "#هدايا"], tagsEn: ["#SaudiNationalDay", "#KSA", "#Giveaways", "#Homemade"],
});
const saudiFoundingDay = {
  ...nationalDay({
    occasion: "founding_day", country: "SA", emoji: "🇸🇦", accent: "#6D4C2F", style: "national_day_sa",
    nameAr: "يوم التأسيس", nameEn: "Saudi Founding Day", countryAr: "السعودية", countryEn: "Saudi Arabia",
    colorsAr: "الأخضر والبني والذهبي", colorsEn: "green, brown and gold",
    tagsAr: ["#يوم_التأسيس", "#السعودية", "#توزيعات", "#تراث"], tagsEn: ["#FoundingDay", "#KSA", "#Heritage", "#Homemade"],
  }),
  headline: { ar: "احتفل بيوم التأسيس بلمسة تراثية", en: "Celebrate Founding Day with a heritage touch" },
  productIdeas: {
    ar: ["حلويات تراثية بتغليف سدو", "بوكس تمر وقهوة", "كوكيز بنقشة السدو", "توزيعات للشركات"],
    en: ["Traditional sweets in Sadu-pattern packaging", "Dates and coffee box", "Sadu-pattern cookies", "Giveaways for companies"],
  },
};
const uaeNationalDay = nationalDay({
  occasion: "national_day", country: "AE", emoji: "🇦🇪", accent: "#00732F", style: "national_day_ae",
  nameAr: "عيد الاتحاد", nameEn: "UAE National Day", countryAr: "الإمارات", countryEn: "the UAE",
  colorsAr: "الأحمر والأخضر والأبيض والأسود", colorsEn: "red, green, white and black",
  tagsAr: ["#عيد_الاتحاد", "#الإمارات", "#توزيعات", "#هدايا"], tagsEn: ["#UAENationalDay", "#EidAlEtihad", "#UAE", "#Homemade"],
});
const kuwaitNationalDay = nationalDay({
  occasion: "national_day", country: "KW", emoji: "🇰🇼", accent: "#007A3D", style: "national_day_kw",
  nameAr: "الأعياد الوطنية", nameEn: "Kuwait National Days", countryAr: "الكويت", countryEn: "Kuwait",
  colorsAr: "الأخضر والأبيض والأحمر والأسود", colorsEn: "green, white, red and black",
  tagsAr: ["#العيد_الوطني_الكويتي", "#عيد_التحرير", "#الكويت", "#توزيعات"], tagsEn: ["#KuwaitNationalDay", "#LiberationDay", "#Kuwait", "#Homemade"],
});
const qatarNationalDay = nationalDay({
  occasion: "national_day", country: "QA", emoji: "🇶🇦", accent: "#8A1538", style: "national_day_qa",
  nameAr: "اليوم الوطني القطري", nameEn: "Qatar National Day", countryAr: "قطر", countryEn: "Qatar",
  colorsAr: "العنابي والأبيض", colorsEn: "maroon and white",
  tagsAr: ["#اليوم_الوطني_القطري", "#قطر", "#توزيعات", "#هدايا"], tagsEn: ["#QatarNationalDay", "#Qatar", "#Giveaways", "#Homemade"],
});
const omanNationalDay = nationalDay({
  occasion: "national_day", country: "OM", emoji: "🇴🇲", accent: "#DB161B", style: "national_day_om",
  nameAr: "العيد الوطني العُماني", nameEn: "Oman National Day", countryAr: "عُمان", countryEn: "Oman",
  colorsAr: "الأحمر والأبيض والأخضر", colorsEn: "red, white and green",
  tagsAr: ["#العيد_الوطني_العماني", "#عمان", "#توزيعات", "#هدايا"], tagsEn: ["#OmanNationalDay", "#Oman", "#Giveaways", "#Homemade"],
});

function womensDay({ country, nameAr, nameEn, womenAr, womenEn, tagsAr, tagsEn }) {
  return {
    occasion: "womens_day", emoji: "💐", accent: "#C2185B", lead: 10, countries: [country], styles: ["flatlay_flowers", "pastel"],
    name: { ar: nameAr, en: nameEn },
    headline: { ar: `هدية حلوة لكل ${womenAr} ملهمة`, en: `A sweet gift for every inspiring ${womenEn} woman` },
    tips: {
      ar: [
        "الشركات والمكاتب تحتفل بموظفاتها، جهّز عرض كميات",
        "تغليف وردي أو بنفسجي مع كرت صغير يفرق كثير",
        "حدد آخر يوم للطلب قبلها بثلاث أيام",
      ],
      en: [
        "Companies celebrate their women staff; prepare a bulk offer",
        "Pink or purple packaging with a small card makes a big difference",
        "Set the last order day three days before",
      ],
    },
    productIdeas: {
      ar: ["بوكس هدايا للموظفات", "كب كيك بالورد", "كوكيز مع كرت تهنئة", "بوكس حلا صغير"],
      en: ["Gift boxes for women staff", "Floral cupcakes", "Cookies with a greeting card", "Small dessert box"],
    },
    captions: {
      ar: [
        `💐 ${nameAr}\nهدية تليق بكل امرأة ملهمة: {item} من {shop}\nالسعر: {price}\nعروض خاصة للشركات والمكاتب 👇\n{link}`,
        `احتفلوا بزميلاتكم في ${nameAr} 🌸\n{item} بتغليف خاص\nاطلبوا بدري من {shop}\n{link}`,
        `لكل ${womenAr} تصنع الفرق 💜\n{item} بـ {price} من {shop}\nللطلب راسلونا 👇\n{link}`,
      ],
      en: [
        `💐 ${nameEn}\nA gift worthy of every inspiring woman: {item} from {shop}\nPrice: {price}\nSpecial offers for companies and offices 👇\n{link}`,
        `Celebrate your colleagues on ${nameEn} 🌸\n{item} in special packaging\nOrder early from {shop}\n{link}`,
        `For every woman who makes a difference 💜\n{item} for {price} from {shop}\nMessage us to order 👇\n{link}`,
      ],
    },
    hashtags: { ar: tagsAr, en: tagsEn },
  };
}
const bahrainWomensDay = womensDay({
  country: "BH", nameAr: "يوم المرأة البحرينية", nameEn: "Bahraini Women's Day", womenAr: "بحرينية", womenEn: "Bahraini",
  tagsAr: ["#يوم_المرأة_البحرينية", "#البحرين", "#هدايا"], tagsEn: ["#BahrainiWomensDay", "#Bahrain", "#Gifts"],
});
const emiratiWomensDay = womensDay({
  country: "AE", nameAr: "يوم المرأة الإماراتية", nameEn: "Emirati Women's Day", womenAr: "إماراتية", womenEn: "Emirati",
  tagsAr: ["#يوم_المرأة_الإماراتية", "#الإمارات", "#هدايا"], tagsEn: ["#EmiratiWomensDay", "#UAE", "#Gifts"],
});

const whiteFriday = {
  occasion: "white_friday", emoji: "🏷️", accent: "#37474F", lead: 10, countries: ALL, styles: ["dark_luxury", "white"],
  name: { ar: "الجمعة البيضاء", en: "White Friday" },
  headline: { ar: "أقوى عرض بالسنة", en: "The biggest offer of the year" },
  tips: {
    ar: [
      "اختر عرض واضح: خصم بسيط أو هدية مع الطلب",
      "خل العرض يوم أو يومين بس عشان يحمّس الناس",
      "انشر عد تنازلي في الستوري قبلها بكم يوم",
      "حط حد يومي للطلبات عشان ما يضغط عليك التجهيز",
    ],
    en: [
      "Pick one clear offer: a small discount or a gift with every order",
      "Keep it to one or two days so people act fast",
      "Post a countdown in your stories a few days before",
      "Set a daily order limit so preparation stays manageable",
    ],
  },
  productIdeas: {
    ar: ["بوكس بسعر خاص", "اطلب 2 وخذ الثالث هدية", "هدية صغيرة مع كل طلب", "توصيل مجاني ليوم واحد"],
    en: ["A box at a special price", "Buy 2, get the third free", "A small gift with every order", "Free delivery for one day"],
  },
  captions: {
    ar: [
      "🏷️ عرض الجمعة البيضاء!\n{item} بسعر خاص: {price}\nالعرض ليوم واحد بس ⏳\nاطلبوا من {shop} 👇\n{link}",
      "استعدوا للجمعة البيضاء 🤍\nعرض {shop} الأقوى بالسنة على {item}\nالكمية محدودة، احجزوا من الحين\n{link}",
      "آخر فرصة ⏳ عرض الجمعة البيضاء ينتهي الليلة\n{item} بـ {price} بس\n{link}",
    ],
    en: [
      "🏷️ White Friday offer!\n{item} at a special price: {price}\nOne day only ⏳\nOrder from {shop} 👇\n{link}",
      "Get ready for White Friday 🤍\n{shop}'s biggest offer of the year on {item}\nLimited quantity, book now\n{link}",
      "Last chance ⏳ The White Friday offer ends tonight\n{item} for only {price}\n{link}",
    ],
  },
  hashtags: { ar: ["#الجمعة_البيضاء", "#عروض", "#خصومات"], en: ["#WhiteFriday", "#Offers", "#Deals"] },
};

const newYear = {
  occasion: "new_year", emoji: "🎉", accent: "#B8860B", lead: 10, countries: ALL, styles: ["new_year", "dark_luxury"],
  name: { ar: "رأس السنة", en: "New Year" },
  headline: { ar: "بداية حلوة لسنة جديدة", en: "A sweet start to the new year" },
  tips: {
    ar: [
      "العوائل والشلات يطلبون للتجمعات، جهّز أحجام كبيرة",
      "ألوان الذهبي والأسود تعطي إحساس الاحتفال",
      "حدد آخر موعد استلام قبل الليلة بيوم",
    ],
    en: [
      "Families and friends order for gatherings; offer bigger sizes",
      "Gold and black colors give a celebration feel",
      "Set the last pickup time one day before the night",
    ],
  },
  productIdeas: {
    ar: ["كيكة احتفالية", "صينية حلا للتجمعات", "بوكس كب كيك ذهبي", "بوكس سناك للسهرة"],
    en: ["A celebration cake", "Dessert platter for gatherings", "Gold cupcake box", "Snack box for the night"],
  },
  captions: {
    ar: [
      "🎉 سنة جديدة، بداية حلوة!\nاحتفلوا مع {shop} بـ{item}\nالسعر: {price}\nاطلبوا قبل ليلة رأس السنة 👇\n{link}",
      "سهرتكم ناقصها {item} ✨\nمن {shop} بـ {price}\nالمواعيد محدودة، احجزوا الحين\n{link}",
      "ودّعوا السنة بطعم حلو 🥳\n{item} من {shop}\nللطلب 👇\n{link}",
    ],
    en: [
      "🎉 New year, sweet start!\nCelebrate with {item} from {shop}\nPrice: {price}\nOrder before New Year's Eve 👇\n{link}",
      "Your night needs {item} ✨\nFrom {shop} for {price}\nLimited slots, book now\n{link}",
      "End the year on a sweet note 🥳\n{item} from {shop}\nOrder here 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#رأس_السنة", "#سنة_جديدة", "#احتفال"], en: ["#NewYear", "#NewYearsEve", "#Celebration"] },
};

function candyNight({ id, countries, nameAr, nameEn, tagsAr, tagsEn }) {
  return {
    idSuffix: id, occasion: "gergaoun", emoji: "🍬", accent: "#F2A900", lead: 14, countries, styles: ["gergaoun", "pastel"],
    name: { ar: nameAr, en: nameEn },
    headline: { ar: `جهّز أكياس ${nameAr} من بدري`, en: `Get your ${nameEn} bags ready early` },
    tips: {
      ar: [
        "الأمهات يطلبون بالعشرات، جهّز أسعار للكميات (10، 25، 50 كيس)",
        "خيارات تغليف بأسماء الأطفال تزيد الطلب",
        "افتح الطلب قبلها بأسبوعين وحدد آخر يوم للطلب",
        "صوّر الأكياس بستايل المناسبة من استوديو الصور",
      ],
      en: [
        "Mums order dozens; price bundles of 10, 25 and 50 bags",
        "Packaging with the children's names boosts orders",
        "Open orders two weeks early and set the last order day",
        "Shoot the bags in the occasion style with the photo studio",
      ],
    },
    productIdeas: {
      ar: ["أكياس حلاوة ومكسرات", "سلال خوص صغيرة", "بوكس توزيعات للأطفال", "أكياس بأسماء الأطفال"],
      en: ["Candy and nut bags", "Small woven baskets", "Giveaway boxes for children", "Bags with children's names"],
    },
    captions: {
      ar: [
        `🍬 ${nameAr} قرّب!\nأكياس {shop} جاهزة: {item}\nالسعر: {price}\nاحجزوا كميتكم الحين 👇\n{link}`,
        `فرحة العيال بـ${nameAr} تبدأ من هني 🎒🍭\n{item} بتغليف بأسماء الأطفال\nاطلبوا بدري من {shop}\n{link}`,
        `أسعار خاصة للكميات 🍬\n{item} من {shop}\nآخر يوم للطلب قبلها بثلاث أيام 👇\n{link}`,
      ],
      en: [
        `🍬 ${nameEn} is coming!\n{shop}'s bags are ready: {item}\nPrice: {price}\nBook your quantity now 👇\n{link}`,
        `The kids' ${nameEn} joy starts here 🎒🍭\n{item} with the children's names on the packaging\nOrder early from {shop}\n{link}`,
        `Special prices for bulk orders 🍬\n{item} from {shop}\nLast order day is three days before 👇\n{link}`,
      ],
    },
    hashtags: { ar: tagsAr, en: tagsEn },
  };
}
const gergaounBH = candyNight({ id: "bh", countries: ["BH"], nameAr: "القرقاعون", nameEn: "Gergaoun", tagsAr: ["#القرقاعون", "#البحرين", "#رمضان", "#توزيعات"], tagsEn: ["#Gergaoun", "#Bahrain", "#Ramadan", "#Giveaways"] });
const girgianKW = candyNight({ id: "kw", countries: ["KW", "SA"], nameAr: "القرقيعان", nameEn: "Girgian", tagsAr: ["#القرقيعان", "#رمضان", "#توزيعات"], tagsEn: ["#Girgian", "#Ramadan", "#Giveaways"] });
const garangaoQA = candyNight({ id: "qa", countries: ["QA"], nameAr: "القرنقعوه", nameEn: "Garangao", tagsAr: ["#القرنقعوه", "#قطر", "#رمضان", "#توزيعات"], tagsEn: ["#Garangao", "#Qatar", "#Ramadan", "#Giveaways"] });
const qaranqashoOM = candyNight({ id: "om", countries: ["OM"], nameAr: "القرنقشوه", nameEn: "Qaranqasho", tagsAr: ["#القرنقشوه", "#عمان", "#رمضان", "#توزيعات"], tagsEn: ["#Qaranqasho", "#Oman", "#Ramadan", "#Giveaways"] });
const haqAlLaila = { ...candyNight({ id: "ae", countries: ["AE"], nameAr: "حق الليلة", nameEn: "Haq Al Laila", tagsAr: ["#حق_الليلة", "#الإمارات", "#توزيعات"], tagsEn: ["#HaqAlLaila", "#UAE", "#Giveaways"] }), occasion: "haq_al_laila" };

const ramadan = {
  occasion: "ramadan", emoji: "🌙", accent: "#1B4F72", lead: 21, countries: ALL, styles: ["ramadan", "dark_luxury"],
  name: { ar: "رمضان", en: "Ramadan" },
  headline: { ar: "جهّز حملة رمضان من بدري", en: "Plan your Ramadan campaign early" },
  tips: {
    ar: [
      "افتح طلبات الغبقة والعزايم قبل رمضان بأسبوعين",
      "سوّ أحجام للعزايم الكبيرة، الطلب عليها يزيد",
      "خل الاستلام قبل الفطور بساعة أو ساعتين",
      "خفف الحد اليومي بالعشر الأواخر إذا تبي راحة",
    ],
    en: [
      "Open ghabga and gathering orders two weeks before Ramadan",
      "Offer large sizes for gatherings; demand grows",
      "Set pickups one to two hours before iftar",
      "Lower your daily limit in the last ten nights if you need rest",
    ],
  },
  productIdeas: {
    ar: ["بوكس لقيمات", "حلا رمضاني بالكاسات", "صينية غبقة", "تمر محشي"],
    en: ["Luqaimat box", "Ramadan dessert cups", "Ghabga platter", "Stuffed dates"],
  },
  captions: {
    ar: [
      "🌙 رمضان كريم\nعزايمكم علينا! {item} من {shop}\nالسعر: {price}\nاطلبوا قبلها بيوم، والاستلام قبل الفطور 👇\n{link}",
      "طلبات الغبقة مفتوحة 🌙✨\n{item} يكفي العزيمة كلها\nاحجزوا من الحين من {shop}\n{link}",
      "أجواء رمضان أحلى مع {shop} 🌙\nجربوا {item} بـ {price}\nالكمية كل يوم محدودة 👇\n{link}",
    ],
    en: [
      "🌙 Ramadan Kareem\nWe've got your gatherings covered! {item} from {shop}\nPrice: {price}\nOrder a day ahead, pick up before iftar 👇\n{link}",
      "Ghabga orders are open 🌙✨\n{item}, enough for the whole gathering\nBook now from {shop}\n{link}",
      "Ramadan feels sweeter with {shop} 🌙\nTry {item} for {price}\nLimited quantity every day 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#رمضان", "#رمضان_كريم", "#غبقة", "#عزايم"], en: ["#Ramadan", "#RamadanKareem", "#Ghabga", "#Iftar"] },
};

function eid({ occasion, emoji, accent, lead, nameAr, nameEn, extraIdeaAr, extraIdeaEn, tagsAr, tagsEn }) {
  return {
    occasion, emoji, accent, lead, countries: ALL, styles: ["eid", "dark_luxury"],
    name: { ar: nameAr, en: nameEn },
    headline: { ar: `ضيافة ${nameAr} علينا`, en: `Your ${nameEn} treats, sorted` },
    tips: {
      ar: [
        "افتح طلبات العيد بدري، الناس تحجز قبلها بأسابيع",
        "بوكسات الضيافة والتوزيعات عليها طلب كبير",
        "آخر يومين قبل العيد أكثر ضغط، حط حد يومي",
        "حدد آخر يوم استلام قبل إجازة العيد",
      ],
      en: [
        "Open Eid orders early; people book weeks ahead",
        "Hosting boxes and giveaways are in high demand",
        "The last two days before Eid are the busiest; set a daily limit",
        "Set the last pickup day before the Eid holiday",
      ],
    },
    productIdeas: {
      ar: ["بوكس ضيافة العيد", "معمول وكعك العيد", "توزيعات عيدية للأطفال", extraIdeaAr],
      en: ["Eid hosting box", "Eid maamoul and cookies", "Eidiya giveaways for kids", extraIdeaEn],
    },
    captions: {
      ar: [
        `${emoji} ${nameAr} قرّب!\nضيافتكم علينا: {item} من {shop}\nالسعر: {price}\nاحجزوا بدري، المواعيد تخلص بسرعة 👇\n{link}`,
        `عيدكم مبارك 🤍\nتوزيعات العيد من {shop}\n{item} بـ {price}\nآخر يوم للطلب قبل العيد بيومين\n{link}`,
        `فرحة العيد تكمل مع {item} ${emoji}\nمن {shop} بتغليف العيد\nللطلب راسلونا 👇\n{link}`,
      ],
      en: [
        `${emoji} ${nameEn} is almost here!\nYour hosting, sorted: {item} from {shop}\nPrice: {price}\nBook early, slots go fast 👇\n{link}`,
        `Eid Mubarak 🤍\nEid giveaways from {shop}\n{item} for {price}\nLast order day is two days before Eid\n{link}`,
        `Eid joy is complete with {item} ${emoji}\nFrom {shop} in Eid packaging\nMessage us to order 👇\n{link}`,
      ],
    },
    hashtags: { ar: tagsAr, en: tagsEn },
  };
}
const eidAlFitr = eid({
  occasion: "eid_al_fitr", emoji: "🎁", accent: "#7B2CBF", lead: 21, nameAr: "عيد الفطر", nameEn: "Eid al-Fitr",
  extraIdeaAr: "كيكة العيد", extraIdeaEn: "Eid cake",
  tagsAr: ["#عيد_الفطر", "#عيدكم_مبارك", "#توزيعات_العيد", "#ضيافة"], tagsEn: ["#EidAlFitr", "#EidMubarak", "#EidGifts", "#Homemade"],
});
const eidAlAdha = eid({
  occasion: "eid_al_adha", emoji: "🌟", accent: "#2E7D32", lead: 18, nameAr: "عيد الأضحى", nameEn: "Eid al-Adha",
  extraIdeaAr: "توزيعات استقبال الحجاج", extraIdeaEn: "Giveaways to welcome pilgrims home",
  tagsAr: ["#عيد_الأضحى", "#عيدكم_مبارك", "#توزيعات_الحجاج", "#ضيافة"], tagsEn: ["#EidAlAdha", "#EidMubarak", "#EidGifts", "#Homemade"],
});

const valentines = {
  occasion: "valentines", emoji: "❤️", accent: "#D7263D", lead: 12, countries: ALL, styles: ["valentines", "white"],
  name: { ar: "يوم الحب", en: "Valentine's Day" },
  headline: { ar: "هدايا تسعد اللي تحبونه", en: "Gifts that make loved ones smile" },
  tips: {
    ar: [
      "الأحمر والوردي مع ورد طبيعي يعطي إحساس الهدية",
      "اعرض كتابة اسم أو عبارة قصيرة على التغليف",
      "الطلب يتركز آخر ثلاث أيام، حط حد يومي",
    ],
    en: [
      "Red and pink with fresh flowers feels like a gift",
      "Offer a name or a short message on the packaging",
      "Orders peak in the last three days; set a daily limit",
    ],
  },
  productIdeas: {
    ar: ["بوكس فراولة بالشوكولاتة", "كيكة قلب", "كب كيك أحمر ووردي", "بوكس هدية مع ورد"],
    en: ["Chocolate-dipped strawberry box", "Heart cake", "Red and pink cupcakes", "Gift box with flowers"],
  },
  captions: {
    ar: [
      "❤️ هدية تسعد اللي تحبونه\n{item} من {shop}\nالسعر: {price}\nالطلب المسبق مفتوح والكمية محدودة 👇\n{link}",
      "عبّروا بطريقتكم 💌\n{item} مع كرت باسم اللي تحبونه\nاطلبوا بدري من {shop}\n{link}",
      "أحلى مفاجأة 🌹\n{item} بـ {price} من {shop}\nللطلب راسلونا 👇\n{link}",
    ],
    en: [
      "❤️ A gift your loved ones will love\n{item} from {shop}\nPrice: {price}\nPre-orders are open, limited quantity 👇\n{link}",
      "Say it your way 💌\n{item} with a card for your loved one\nOrder early from {shop}\n{link}",
      "The sweetest surprise 🌹\n{item} for {price} from {shop}\nMessage us to order 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#يوم_الحب", "#هدايا", "#ورد"], en: ["#ValentinesDay", "#Gifts", "#Love"] },
};

const mothersDay = {
  occasion: "mothers_day", emoji: "💐", accent: "#E91E63", lead: 14, countries: ALL, styles: ["mothers_day", "flatlay_flowers"],
  name: { ar: "عيد الأم", en: "Mother's Day" },
  headline: { ar: "أحلى هدية لست الحبايب", en: "The sweetest gift for mum" },
  tips: {
    ar: [
      "الأبناء يدورون هدية جاهزة، جهّز بوكس هدية كامل",
      "اعرض كرت بعبارة للأم مع كل طلب",
      "خل خيار توصيل للبيت مباشرة إذا تقدر",
    ],
    en: [
      "Children look for a ready gift; prepare a complete gift box",
      "Offer a card with a message for mum with every order",
      "Offer delivery straight to mum's home if you can",
    ],
  },
  productIdeas: {
    ar: ["بوكس هدية مع ورد", "كيكة صغيرة للأم", "بوكس حلا مشكل", "كوكيز مكتوب عليها أحبك يمه"],
    en: ["Gift box with flowers", "A small cake for mum", "Assorted dessert box", "Love-you-mum cookies"],
  },
  captions: {
    ar: [
      "💐 عيد الأم\nأحلى هدية لست الحبايب: {item} من {shop}\nالسعر: {price}\nالطلب المسبق مفتوح 👇\n{link}",
      "أمك تستاهل الأحلى 🤍\n{item} مع كرت بعبارة منك\nاطلبوا بدري من {shop}\n{link}",
      "فرّحوا أمهاتكم 🌷\n{item} بـ {price}\nللطلب راسلونا 👇\n{link}",
    ],
    en: [
      "💐 Mother's Day\nThe sweetest gift for mum: {item} from {shop}\nPrice: {price}\nPre-orders are open 👇\n{link}",
      "Mum deserves the best 🤍\n{item} with a card from you\nOrder early from {shop}\n{link}",
      "Make mum smile 🌷\n{item} for {price}\nMessage us to order 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#عيد_الأم", "#هدايا", "#ست_الحبايب"], en: ["#MothersDay", "#Gifts", "#Mum"] },
};

const graduation = {
  occasion: "graduation", emoji: "🎓", accent: "#1A237E", lead: 21, countries: ALL, styles: ["graduation", "white"],
  name: { ar: "موسم التخرج", en: "Graduation season" },
  headline: { ar: "حفلات التخرج تحتاج حلاك", en: "Graduation parties need your treats" },
  tips: {
    ar: [
      "حفلات التخرج تنحجز بدري، افتح المواعيد من الحين",
      "اعرض كتابة اسم الخريج وسنة التخرج",
      "جهّز أحجام للحفلات الكبيرة والصغيرة",
    ],
    en: [
      "Graduation parties book early; open your slots now",
      "Offer the graduate's name and year on the design",
      "Offer sizes for both big and small parties",
    ],
  },
  productIdeas: {
    ar: ["كيكة تخرج باسم الخريج", "كب كيك بقبعة التخرج", "توزيعات تخرج", "صينية حلا للحفلة"],
    en: ["Graduation cake with the graduate's name", "Graduation-cap cupcakes", "Graduation giveaways", "Party dessert platter"],
  },
  captions: {
    ar: [
      "🎓 مبروك التخرج!\n{item} بتصميم خاص للخريجين من {shop}\nالسعر: {price}\nاحجزوا بدري، المواعيد تخلص بسرعة 👇\n{link}",
      "فرحة التخرج تستاهل كيكة تليق فيها 🎉\n{item} باسم الخريج\nاطلبوا من {shop}\n{link}",
      "توزيعات حفلة التخرج جاهزة 🎓\n{item} بـ {price}\nللطلب 👇\n{link}",
    ],
    en: [
      "🎓 Congratulations, graduates!\n{item} with a special graduation design from {shop}\nPrice: {price}\nBook early, slots go fast 👇\n{link}",
      "A graduation deserves a cake to match 🎉\n{item} with the graduate's name\nOrder from {shop}\n{link}",
      "Graduation party giveaways are ready 🎓\n{item} for {price}\nOrder here 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#تخرج", "#حفلة_تخرج", "#مبروك_التخرج"], en: ["#Graduation", "#ClassOf", "#Congrats"] },
};

const mawlid = {
  occasion: "mawlid", emoji: "🌙", accent: "#00695C", lead: 10, countries: ["BH", "KW", "OM", "AE"], styles: ["pastel", "white"],
  name: { ar: "ذكرى المولد النبوي", en: "Mawlid" },
  headline: { ar: "توزيعات ذكرى المولد النبوي الشريف", en: "Sweets for the Prophet's birthday" },
  tips: {
    ar: [
      "توزيعات الحلويات والمكسرات عليها طلب بهالمناسبة",
      "تغليف بسيط بألوان هادئة يناسب المناسبة",
      "افتح الطلب قبلها بأسبوع",
    ],
    en: [
      "Sweet and nut giveaways are popular for this occasion",
      "Simple packaging in calm colors fits the occasion",
      "Open orders a week before",
    ],
  },
  productIdeas: {
    ar: ["أكياس حلاوة ومكسرات", "بوكس حلويات عربية", "توزيعات للمجالس"],
    en: ["Sweet and nut bags", "Arabic sweets box", "Giveaways for gatherings"],
  },
  captions: {
    ar: [
      "🌙 بمناسبة ذكرى المولد النبوي الشريف\nتوزيعات {shop}: {item}\nالسعر: {price}\nللطلب 👇\n{link}",
      "توزيعات المولد جاهزة 🤍\n{item} من {shop}\nاحجزوا كميتكم بدري\n{link}",
    ],
    en: [
      "🌙 For the Prophet's birthday\nGiveaways from {shop}: {item}\nPrice: {price}\nOrder here 👇\n{link}",
      "Mawlid giveaways are ready 🤍\n{item} from {shop}\nBook your quantity early\n{link}",
    ],
  },
  hashtags: { ar: ["#المولد_النبوي", "#توزيعات"], en: ["#Mawlid", "#Giveaways"] },
};

const backToSchool = {
  occasion: "back_to_school", emoji: "🎒", accent: "#F57C00", lead: 10, countries: ALL, styles: ["back_to_school", "white"],
  name: { ar: "العودة للمدارس", en: "Back to school" },
  headline: { ar: "سناك الفسحة من عندك", en: "Be the lunchbox favorite" },
  tips: {
    ar: [
      "الأمهات يدورون سناك صحي للفسحة، سوّ اشتراك أسبوعي",
      "عبوات فردية صغيرة أسهل للمدرسة",
      "هدايا أول يوم دراسي للمعلمات والطلاب عليها طلب",
    ],
    en: [
      "Mums want healthy lunchbox snacks; offer a weekly plan",
      "Small single portions are easier for school",
      "First-day gifts for teachers and students are popular",
    ],
  },
  productIdeas: {
    ar: ["اشتراك سناك أسبوعي", "ميني مافن للفسحة", "كوكيز صحية", "توزيعات أول يوم دراسي"],
    en: ["Weekly snack plan", "Mini muffins for lunchboxes", "Healthy cookies", "First-day-of-school giveaways"],
  },
  captions: {
    ar: [
      "🎒 رجعة المدارس!\nسناك الفسحة من {shop}: {item}\nالسعر: {price}\nاشتراكات أسبوعية متوفرة 👇\n{link}",
      "خلّوا فسحة عيالكم أحلى 🍎\n{item} بعبوات صغيرة للمدرسة\nاطلبوا من {shop}\n{link}",
      "هدايا أول يوم دراسي ✏️\n{item} بـ {price}\nللطلب 👇\n{link}",
    ],
    en: [
      "🎒 Back to school!\nLunchbox snacks from {shop}: {item}\nPrice: {price}\nWeekly plans available 👇\n{link}",
      "Make their break time sweeter 🍎\n{item} in small school-size packs\nOrder from {shop}\n{link}",
      "First-day-of-school gifts ✏️\n{item} for {price}\nOrder here 👇\n{link}",
    ],
  },
  hashtags: { ar: ["#العودة_للمدارس", "#سناك", "#فسحة"], en: ["#BackToSchool", "#Lunchbox", "#Snacks"] },
};

// ---------- calendar ----------

const entries = [
  // 2026
  [teachersDay, "2026-10-05", "2026-10-05"],
  [omanNationalDay, "2026-11-20", "2026-11-21"],
  [whiteFriday, "2026-11-27", "2026-11-28"],
  [bahrainWomensDay, "2026-12-01", "2026-12-01"],
  [uaeNationalDay, "2026-12-02", "2026-12-03"],
  [bahrainNationalDay, "2026-12-16", "2026-12-17"],
  [qatarNationalDay, "2026-12-18", "2026-12-18"],
  [newYear, "2026-12-31", "2027-01-01"],
  // 2027
  [haqAlLaila, "2027-01-22", "2027-01-22"],
  [ramadan, "2027-02-08", "2027-03-08"],
  [valentines, "2027-02-14", "2027-02-14"],
  [gergaounBH, "2027-02-21", "2027-02-21"],
  [girgianKW, "2027-02-21", "2027-02-21"],
  [garangaoQA, "2027-02-21", "2027-02-21"],
  [qaranqashoOM, "2027-02-21", "2027-02-21"],
  [saudiFoundingDay, "2027-02-22", "2027-02-22"],
  [kuwaitNationalDay, "2027-02-25", "2027-02-26"],
  [eidAlFitr, "2027-03-09", "2027-03-11"],
  [mothersDay, "2027-03-21", "2027-03-21"],
  [eidAlAdha, "2027-05-16", "2027-05-18"],
  [graduation, "2027-06-01", "2027-06-30"],
  [mawlid, "2027-08-14", "2027-08-14"],
  [backToSchool, "2027-08-22", "2027-09-12"],
  [emiratiWomensDay, "2027-08-28", "2027-08-28"],
  [saudiNationalDay, "2027-09-23", "2027-09-23"],
  [teachersDay, "2027-10-05", "2027-10-05"],
  [omanNationalDay, "2027-11-20", "2027-11-21"],
  [whiteFriday, "2027-11-26", "2027-11-27"],
  [bahrainWomensDay, "2027-12-01", "2027-12-01"],
  [uaeNationalDay, "2027-12-02", "2027-12-03"],
  [bahrainNationalDay, "2027-12-16", "2027-12-17"],
  [qatarNationalDay, "2027-12-18", "2027-12-18"],
  [newYear, "2027-12-31", "2028-01-01"],
  // 2028
  [haqAlLaila, "2028-01-11", "2028-01-11"],
  [ramadan, "2028-01-28", "2028-02-25"],
  [gergaounBH, "2028-02-10", "2028-02-10"],
  [girgianKW, "2028-02-10", "2028-02-10"],
  [garangaoQA, "2028-02-10", "2028-02-10"],
  [qaranqashoOM, "2028-02-10", "2028-02-10"],
  [valentines, "2028-02-14", "2028-02-14"],
  [saudiFoundingDay, "2028-02-22", "2028-02-22"],
  [kuwaitNationalDay, "2028-02-25", "2028-02-26"],
  [eidAlFitr, "2028-02-26", "2028-02-28"],
  [mothersDay, "2028-03-21", "2028-03-21"],
  [eidAlAdha, "2028-05-05", "2028-05-07"],
  [graduation, "2028-06-01", "2028-06-30"],
];

const slug = (s) => s.replace(/_/g, "-");
const campaigns = entries.map(([t, startDate, endDate]) => {
  const year = startDate.slice(0, 4);
  const country = t.countries.length === 1 ? `-${t.countries[0].toLowerCase()}` : "";
  const suffix = t.idSuffix ? `-${t.idSuffix}` : country;
  return {
    id: `${slug(t.occasion)}-${year}${suffix}`,
    occasion: t.occasion,
    name: t.name,
    emoji: t.emoji,
    countries: t.countries,
    startDate,
    endDate,
    promoteFrom: addDays(startDate, -t.lead),
    accent: t.accent,
    headline: t.headline,
    tips: t.tips,
    productIdeas: t.productIdeas,
    captions: t.captions,
    hashtags: t.hashtags,
    studioStyles: t.styles,
  };
});

const ids = new Set();
for (const c of campaigns) {
  if (ids.has(c.id)) throw new Error(`duplicate id ${c.id}`);
  ids.add(c.id);
}
campaigns.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
const out = process.argv[2] ?? fileURLToPath(new URL("../../content/campaigns.json", import.meta.url));
writeFileSync(out, JSON.stringify({ version: "2026-09-26.1", campaigns }, null, 2) + "\n");
console.log(`${campaigns.length} campaigns -> ${out}`);
