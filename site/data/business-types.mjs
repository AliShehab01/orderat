// The 5 pages under /business/ and /en/business/. One per business type from
// docs/sme-phase-1.md's business-type table.

export const BUSINESS_TYPES = [
  {
    slug: "home-business",
    icon: "home",
    relatedFeatureSlugs: ["whatsapp-orders", "profit-expenses", "shop-link"],
    ar: {
      name: "مشروع منزلي",
      blurb: "حلويات، صواني، وأعمال يدوية — نظّم طلباتك من غرفتك أو مطبخك.",
      metaTitle: "تطبيق تنظيم الطلبات للمشاريع المنزلية | اوردرات",
      metaDescription:
        "اوردرات لأصحاب المشاريع المنزلية: حلويات وصواني وأعمال يدوية. طلبات واتساب منظمة، سقف يومي، وربح حقيقي منفصل عن فلوسك الشخصية.",
      h1: "اوردرات لمشروعك المنزلي",
      lead: "بدأت مشروعك من مطبخك أو غرفتك، وطلباتك تجيك على واتساب وإنستغرام. اوردرات يرتبها لك بدون ما يغيّر طريقتك في البيع.",
      painPoints: [
        "طلبات تتوه بين محادثاتك الشخصية والتجارية على نفس الواتساب",
        "ما تدري كم قطعة قدرت تجهّز اليوم قبل ما توافق على طلب جديد",
        "تحسب ربحك من راسك، وما تفصل مصروف المشروع عن مصروف البيت",
        "عميلة تسألك عن المنتجات والأسعار من جديد كل مرة",
      ],
      howItHelps: [
        {
          heading: "سقف يومي لكل منتج",
          body: "حدد كم صينية أو كم قطعة تقدر تجهّز في اليوم لكل منتج أو مناسبة، واوردرات يوقفك قبل ما توافق على أكثر من طاقتك.",
        },
        {
          heading: "ربح منفصل عن فلوسك الشخصية",
          body: "سجّل مصاريف المواد والتغليف والتوصيل، واعرف ربحك الحقيقي من المشروع، بمعزل تام عن حساباتك الشخصية.",
        },
        {
          heading: "رابط متجر بدل الرد المتكرر",
          body: "شارك رابط متجرك في بايو إنستغرام، ووفّر على نفسك تكرار الأسعار والمنتجات لكل عميلة جديدة.",
        },
      ],
      examplesLabel: "أمثلة",
      examples: ["حلويات ومعجنات", "صواني وضيافة", "أعمال يدوية وهدايا", "عطور ومستحضرات منزلية"],
    },
    en: {
      name: "Home business",
      blurb: "Sweets, trays and handmade goods — organize orders from your kitchen or spare room.",
      metaTitle: "Order management app for home businesses | Orderat",
      metaDescription:
        "Orderat for home business owners: sweets, trays and handmade goods. Organized WhatsApp orders, a daily capacity, and real profit kept separate from your own money.",
      h1: "Orderat for your home business",
      lead: "You started your business from your kitchen or a spare room, and orders come in over WhatsApp and Instagram. Orderat organizes them without changing how you sell.",
      painPoints: [
        "Orders get lost between your personal and business chats on the same WhatsApp",
        "You don't know how much you can still prepare today before agreeing to a new order",
        "You estimate profit in your head, without separating business costs from household ones",
        "Customers ask about your products and prices again, every single time",
      ],
      howItHelps: [
        {
          heading: "A daily capacity per product",
          body: "Set how many trays or pieces you can prepare per day for each product or occasion, and Orderat stops you before you agree to more than you can handle.",
        },
        {
          heading: "Profit kept separate from your own money",
          body: "Log ingredient, packaging and delivery costs, and see your business's real profit, completely apart from your personal accounts.",
        },
        {
          heading: "A shop link instead of repeating yourself",
          body: "Share your shop link in your Instagram bio, and stop retyping your prices and products for every new customer.",
        },
      ],
      examplesLabel: "Examples",
      examples: ["Sweets and baked goods", "Catering trays", "Handmade crafts and gifts", "Perfumes and home goods"],
    },
  },
  {
    slug: "shops",
    icon: "shop",
    relatedFeatureSlugs: ["stock", "tax-invoice", "staff-sync"],
    ar: {
      name: "متجر أو محل",
      blurb: "عطور، عبايات، هدايا وإكسسوارات — تابع مخزونك وفواتيرك بسهولة.",
      metaTitle: "تطبيق طلبات ومخزون للمتاجر والمحلات | اوردرات",
      metaDescription:
        "اوردرات لأصحاب المتاجر والمحلات: عطور وعبايات وهدايا. تتبّع مخزون، فاتورة ضريبية عند الحاجة، وصلاحيات لموظفيك.",
      h1: "اوردرات لمتجرك أو محلك",
      lead: "متجرك يبيع أونلاين وعلى أرض الواقع، وعندك منتجات محدودة الكمية وربما موظف يساعدك. اوردرات يجمع كل هذا في مكان واحد.",
      painPoints: [
        "منتج يخلص من المخزون وتكتشف بعد ما يوافق العميل على الطلب",
        "عميل يطلب فاتورة ضريبية رسمية وما عندك طريقة سريعة تجهّزها",
        "موظفك يحتاج يشوف الطلبات بس، بدون ما يشوف أرباحك",
        "منتجات كثيرة، وتفاصيلها تتوه بين رسائل واتساب وإنستغرام",
      ],
      howItHelps: [
        {
          heading: "مخزون يتحدث تلقائياً",
          body: "فعّل تتبع المخزون لمنتجاتك المحدودة، وخله يُخصم تلقائياً عند تأكيد كل طلب، ويرجع تلقائياً لو انلغى.",
        },
        {
          heading: "فاتورة ضريبية عند الحاجة",
          body: "فعّل ضريبة القيمة المضافة من الإعدادات، واوردرات يجهّز لك فاتورة ضريبية مبسطة برقم متسلسل، تلقائياً.",
        },
        {
          heading: "صلاحيات لكل موظف",
          body: "أعط موظفك صلاحية الطلبات أو المنتجات فقط، وخل الأموال والأرباح تحت نظرك فقط.",
        },
      ],
      examplesLabel: "أمثلة",
      examples: ["عطور ومستحضرات", "عبايات وأزياء", "هدايا ومناسبات", "إكسسوارات"],
    },
    en: {
      name: "Shop or boutique",
      blurb: "Perfumes, abayas, gifts and accessories — keep stock and invoices under control.",
      metaTitle: "Orders and stock app for shops and boutiques | Orderat",
      metaDescription:
        "Orderat for shop and boutique owners: perfumes, abayas and gifts. Stock tracking, tax invoices when you need them, and permissions for your staff.",
      h1: "Orderat for your shop or boutique",
      lead: "Your shop sells online and in person, with limited-quantity products and maybe a member of staff helping out. Orderat brings all of it into one place.",
      painPoints: [
        "A product runs out of stock and you only find out after a customer's order is confirmed",
        "A customer asks for a proper tax invoice, and you have no quick way to produce one",
        "Your staff member needs to see orders, but not your profit",
        "With many products, details get lost between WhatsApp and Instagram messages",
      ],
      howItHelps: [
        {
          heading: "Stock that updates itself",
          body: "Turn on stock tracking for your limited-quantity products, and let it deduct automatically when an order is confirmed, and return automatically if it's cancelled.",
        },
        {
          heading: "A tax invoice when you need one",
          body: "Turn on VAT from Settings, and Orderat automatically prepares a simplified tax invoice with a sequential number for you.",
        },
        {
          heading: "Permissions for every staff member",
          body: "Give a staff member access to orders or products only, and keep money and profit visible to you alone.",
        },
      ],
      examplesLabel: "Examples",
      examples: ["Perfumes and cosmetics", "Abayas and fashion", "Gifts and occasions", "Accessories"],
    },
  },
  {
    slug: "services",
    icon: "scissors",
    relatedFeatureSlugs: ["whatsapp-orders", "staff-sync", "ai-order-entry"],
    ar: {
      name: "خدمات",
      blurb: "صالون، خياطة، تصليح وتنظيف — واعرف موعد كل عميل وملاحظاته.",
      metaTitle: "تطبيق حجز ومواعيد لمقدمي الخدمات | اوردرات",
      metaDescription:
        "اوردرات لصاحب الصالون أو الخياطة أو التصليح: مواعيد بدل تسليم، ملاحظات كل عميل، وتذكير جاهزية بلمسة واحدة.",
      h1: "اوردرات لأعمال الخدمات",
      lead: "شغلك مواعيد لا طلبات تسليم — صالون، خياطة، تصليح، أو تنظيف. اوردرات يرتب موعد كل عميل وملاحظاته الخاصة.",
      painPoints: [
        "تنسى مقاسات أو ملاحظات عميلة قالتها لك من زيارة سابقة",
        "موعدان في نفس الوقت لأنك اعتمدت على ذاكرتك",
        "تنسى ترسل رسالة \"جاهز\" للعميل، فيتأخر يجي يستلم",
        "ما تعرف كم موعد قدرت تاخذ اليوم قبل ما توافق على موعد جديد",
      ],
      howItHelps: [
        {
          heading: "موعد وملاحظات لكل عميل",
          body: "سجّل موعد كل عميل بتاريخه ووقته، مع ملاحظات دائمة (مقاس، تفضيل، تفصيل سابق) ترجع لها في أي وقت.",
        },
        {
          heading: "سقف يومي للمواعيد",
          body: "حدد كم موعد أو كم قطعة تقدر تستقبل في اليوم، واوردرات يمنع التعارض قبل ما يصير.",
        },
        {
          heading: "رسالة جاهزية بلمسة",
          body: "أرسل \"طلبك جاهز\" على واتساب بضغطة واحدة، بدل ما تكتبها من الصفر لكل عميل.",
        },
      ],
      examplesLabel: "أمثلة",
      examples: ["صالونات نسائية ورجالية", "خياطة وتفصيل", "تصليح أجهزة وسيارات", "تنظيف منزلي"],
    },
    en: {
      name: "Services",
      blurb: "Salons, tailoring, repairs and cleaning — track every customer's appointment and notes.",
      metaTitle: "Appointment and order tracking app for service businesses | Orderat",
      metaDescription:
        "Orderat for salons, tailors and repair shops: appointments instead of deliveries, notes per customer, and one-tap ready reminders.",
      h1: "Orderat for service businesses",
      lead: "Your work is appointments, not deliveries — a salon, tailoring, repairs, or cleaning. Orderat keeps each customer's time slot and notes straight.",
      painPoints: [
        "You forget a measurement or note a customer gave you last visit",
        "Two appointments end up at the same time because you relied on memory",
        "You forget to send the \"it's ready\" message, so pickup gets delayed",
        "You don't know how many slots you have left today before booking another one",
      ],
      howItHelps: [
        {
          heading: "A time slot and notes for every customer",
          body: "Log each customer's appointment with date and time, plus notes that stay with them (a measurement, a preference, a past job) you can return to anytime.",
        },
        {
          heading: "A daily cap on appointments",
          body: "Set how many appointments or pieces you can take per day, and Orderat prevents double-booking before it happens.",
        },
        {
          heading: "A ready message, one tap away",
          body: "Send \"your order is ready\" on WhatsApp with one tap, instead of typing it out for every customer.",
        },
      ],
      examplesLabel: "Examples",
      examples: ["Hair and beauty salons", "Tailoring and alterations", "Device and car repair", "Home cleaning"],
    },
  },
  {
    slug: "restaurants-cafes",
    icon: "restaurant",
    relatedFeatureSlugs: ["whatsapp-orders", "ai-order-entry", "staff-sync"],
    ar: {
      name: "مطعم أو كافيه",
      blurb: "تجهيزات، قهوة وصواني — نظّم موعد كل طلب وسقف طاقتك اليومي.",
      metaTitle: "تطبيق طلبات وتجهيزات للمطاعم والكافيهات | اوردرات",
      metaDescription:
        "اوردرات للمطاعم والكافيهات: طلبات تجهيزات وصواني، سقف يومي، رسوم توصيل، وصلاحية تحضير فقط لفريق المطبخ.",
      h1: "اوردرات لمطعمك أو كافيهك",
      lead: "طلبات التجهيزات والصواني تحتاج وقتاً كافياً، وطاقتك اليومية محدودة. اوردرات يرتب كل طلب بموعده ويحمي طاقة مطبخك.",
      painPoints: [
        "طلب تجهيزات كبير يجيك بإشعار قصير، وتضطر تعتذر أو تسهر تجهّزه",
        "تفاصيل الطلب (الكمية، الملاحظات، الحجم) تضيع بين رسائل واتساب",
        "فريق المطبخ يحتاج يشوف الطلبات فقط، بدون صلاحية على الأموال",
        "رسوم التوصيل تختلط بسعر الطلب فتصعب المحاسبة",
      ],
      howItHelps: [
        {
          heading: "آخر موعد وسقف يومي",
          body: "حدد آخر وقت لاستقبال طلبات اليوم، وسقف طاقتك لكل منتج أو مناسبة، فما توافق على أكثر من قدرة مطبخك.",
        },
        {
          heading: "رسوم توصيل منفصلة",
          body: "سجّل رسوم التوصيل بشكل منفصل عن سعر الطلب، فتصير المحاسبة والتقارير أوضح.",
        },
        {
          heading: "صلاحية \"تحضير\" لفريق المطبخ",
          body: "أعط فريق المطبخ صلاحية تغيير حالة الطلب فقط (قيد التحضير، جاهز)، بدون ما يشوفوا الأموال أو الأرباح.",
        },
      ],
      examplesLabel: "أمثلة",
      examples: ["تجهيزات وكيترينج", "قهوة مختصة", "صواني ضيافة", "حلويات المطاعم"],
    },
    en: {
      name: "Restaurant or café",
      blurb: "Catering, coffee and trays — plan every order's time and protect your daily capacity.",
      metaTitle: "Orders and prep planning app for restaurants and cafés | Orderat",
      metaDescription:
        "Orderat for restaurants and cafés: catering and tray orders, a daily capacity, delivery fees, and a prep-only permission for the kitchen team.",
      h1: "Orderat for your restaurant or café",
      lead: "Catering and tray orders need real lead time, and your kitchen's capacity is limited. Orderat schedules every order and protects your kitchen's capacity.",
      painPoints: [
        "A big catering order arrives with short notice, and you either turn it down or stay up late preparing it",
        "Order details — quantity, notes, size — get lost between WhatsApp messages",
        "The kitchen team needs to see orders only, without access to money",
        "Delivery fees get mixed into the order price, making accounting harder",
      ],
      howItHelps: [
        {
          heading: "A cutoff time and a daily capacity",
          body: "Set the last time you accept orders for the day, and a capacity limit per product or occasion, so you never agree to more than your kitchen can handle.",
        },
        {
          heading: "Delivery fees kept separate",
          body: "Record delivery fees separately from the order price, so your accounting and reports stay clear.",
        },
        {
          heading: "A \"prepare\" permission for the kitchen",
          body: "Give the kitchen team permission to change an order's status only (preparing, ready), without access to money or profit.",
        },
      ],
      examplesLabel: "Examples",
      examples: ["Catering", "Specialty coffee", "Hospitality trays", "Restaurant desserts"],
    },
  },
  {
    slug: "food-trucks",
    icon: "truck",
    relatedFeatureSlugs: ["staff-sync", "shop-link", "whatsapp-orders"],
    ar: {
      name: "عربة طعام (فود ترك)",
      blurb: "كرك، برجر، فرايز وشاورما — لخّص طلبات اليوم ووزّع الصلاحيات بين فريقك.",
      metaTitle: "تطبيق طلبات لعربات وشاحنات الطعام (فود ترك) | اوردرات",
      metaDescription:
        "اوردرات لعربات الطعام: طلبات مسبقة وطلبات مباشرة في مكان واحد، صلاحيات لفريق العربة، وربح حقيقي بدون تعقيد.",
      h1: "اوردرات لعربة طعامك",
      lead: "عربة الطعام تتحرك وموقعها يتغيّر، وطلباتك تجيك مسبقة على واتساب أو مباشرة عند العربة. اوردرات يجمعها في شاشة يوم واحدة.",
      painPoints: [
        "طلبات مسبقة على واتساب تختلط مع الطلبات المباشرة عند العربة",
        "من يشتغل عندك في العربة يحتاج يشوف الطلبات فقط، وأنت تتابع الأموال من بعيد",
        "ما عندك وقت تحسب ربحك وسط ضغط الشغل اليومي",
        "عملاء يسألون عن موقعك أو قائمتك بشكل متكرر",
      ],
      howItHelps: [
        {
          heading: "شاشة يوم واحدة لكل الطلبات",
          body: "الطلبات المسبقة والمباشرة تجتمع في شاشة اليوم: وش جاهز، وش قيد التحضير، ومنو باقي عليه فلوس.",
        },
        {
          heading: "صلاحيات لفريق العربة",
          body: "أعط من يشتغل معك في العربة صلاحية \"تحضير\" فقط، وتابع الأموال والأرباح من جوالك أنت.",
        },
        {
          heading: "رابط متجر لطلبات مسبقة",
          body: "شارك رابط متجرك لعملاء يحبون يطلبون مسبقاً بدل الوقوف بالدور، ويصلك طلبهم جاهزاً في اوردرات.",
        },
      ],
      examplesLabel: "أمثلة",
      examples: ["كرك ومشروبات", "برجر وفرايز", "شاورما وسناكات", "قهوة متنقلة"],
    },
    en: {
      name: "Food truck",
      blurb: "Karak, burgers, fries and shawarma — see today's orders and split permissions across your team.",
      metaTitle: "Order management app for food trucks | Orderat",
      metaDescription:
        "Orderat for food trucks: pre-orders and walk-up orders in one screen, permissions for your truck team, and real profit without the hassle.",
      h1: "Orderat for your food truck",
      lead: "Your truck moves, your location changes, and orders come in as WhatsApp pre-orders or straight at the window. Orderat brings them into a single Today screen.",
      painPoints: [
        "Pre-orders from WhatsApp get mixed up with walk-up orders at the truck",
        "Whoever's working the truck needs to see orders only, while you track money remotely",
        "There's no time to work out your profit in the middle of a busy shift",
        "Customers keep asking where you are or what's on the menu",
      ],
      howItHelps: [
        {
          heading: "One Today screen for every order",
          body: "Pre-orders and walk-up orders come together on the Today screen: what's ready, what's preparing, and who still owes money.",
        },
        {
          heading: "Permissions for your truck team",
          body: "Give whoever's working the truck a \"prepare\" permission only, and keep an eye on money and profit from your own phone.",
        },
        {
          heading: "A shop link for pre-orders",
          body: "Share your shop link with customers who'd rather pre-order than wait in line, and their order lands ready in Orderat.",
        },
      ],
      examplesLabel: "Examples",
      examples: ["Karak and drinks", "Burgers and fries", "Shawarma and snacks", "Mobile coffee"],
    },
  },
];

export function getBusinessType(slug) {
  return BUSINESS_TYPES.find((b) => b.slug === slug);
}
