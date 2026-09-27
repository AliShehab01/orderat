// The 8 SEO landing pages under /features/ and /en/features/.
// Facts sourced from docs/sme-phase-1.md, docs/sme-phase-2-cloud.md, docs/marketing-tools.md,
// docs/ask-orderat.md. Do not add numbers, testimonials or claims not backed by those docs.

export const FEATURES = [
  {
    slug: "whatsapp-orders",
    icon: "chat",
    relatedSlugs: ["ai-order-entry", "profit-expenses"],
    ar: {
      cardTitle: "طلبات واتساب وإنستغرام",
      cardBody: "كل طلب من واتساب أو إنستغرام في مكان واحد، بموعده وحالته.",
      metaTitle: "تنظيم طلبات واتساب وإنستغرام في مكان واحد | اوردرات",
      metaDescription:
        "حوّل رسائل واتساب وإنستغرام إلى طلبات منظمة بموعد التسليم، التوصيل أو الاستلام، الحالة والدفعات. اوردرات لكل مشروع صغير.",
      h1: "نظّم طلبات واتساب وإنستغرام في مكان واحد",
      lead: "تفتح واتساب تلقى عشر محادثات، كل واحدة فيها طلب أو سؤال أو تعديل. اوردرات يجمعها في دفتر طلبات واحد واضح، بدل ما تدوّر على تفاصيل الطلب بين الرسائل القديمة.",
      highlights: [
        "موعد التسليم أو الاستلام لكل طلب، بالتاريخ والوقت",
        "التوصيل أو الاستلام، مع عنوان بطريقة البحرين (مجمع / طريق / مبنى)",
        "رسوم توصيل منفصلة عن سعر المنتج",
        "حالة الطلب: جديد، مؤكد، قيد التحضير، جاهز، تم التسليم",
        "الدفعات كاملة أو جزئية، مع سجل لكل تعديل على الطلب",
        "سقف يومي لكل منتج أو مناسبة، حتى لا تتعهد بأكثر من طاقتك",
      ],
      sections: [
        {
          heading: "شاشة اليوم",
          body: "افتح شاشة اليوم وشوف كل الطلبات المستحقة اليوم: منو المفروض يستلم، وش تحضّر، ومنو باقي عليه فلوس. لا حاجة تراجع كل المحادثات من جديد كل صباح.",
        },
        {
          heading: "رسائل واتساب بلمسة واحدة",
          body: "أرسل تأكيد الطلب، إشعار الجاهزية، تذكير الدفع، أو صورة الإيصال على واتساب بضغطة واحدة، بدون كتابة نفس الرسالة من جديد كل مرة.",
        },
        {
          heading: "سجل تعديل كامل",
          body: "أي تغيير على الطلب — الموعد، الكمية، السعر — يُسجَّل في سجل التعديلات، فما تنسى وش تغيّر ومتى تغيّر.",
        },
      ],
    },
    en: {
      cardTitle: "WhatsApp & Instagram orders",
      cardBody: "Every WhatsApp and Instagram order in one place, with its date and status.",
      metaTitle: "Organize WhatsApp & Instagram orders in one place | Orderat",
      metaDescription:
        "Turn WhatsApp and Instagram messages into organized orders with due dates, pickup or delivery, status and payments. Orderat for every small business.",
      h1: "Organize your WhatsApp and Instagram orders in one place",
      lead: "You open WhatsApp and find ten chats, each with an order, a question, or a change. Orderat brings them into one clear order book, instead of you scrolling back through old messages for details.",
      highlights: [
        "A due date and time for every order",
        "Pickup or delivery, with a Bahrain-style address (block / road / building)",
        "Delivery fees kept separate from the product price",
        "Order status: new, confirmed, preparing, ready, delivered",
        "Full or partial payments, with a change history on every order",
        "A daily capacity per product or occasion, so you never overpromise",
      ],
      sections: [
        {
          heading: "The Today screen",
          body: "Open Today and see everything due today: who's picking up, what to prepare, and who still owes money. No need to scroll back through every chat each morning.",
        },
        {
          heading: "One-tap WhatsApp messages",
          body: "Send an order confirmation, a ready notice, a payment reminder, or a receipt image on WhatsApp with one tap, instead of typing the same message every time.",
        },
        {
          heading: "A full change history",
          body: "Every change to an order — the date, the quantity, the price — is logged, so you never lose track of what changed and when.",
        },
      ],
    },
  },
  {
    slug: "tax-invoice",
    icon: "vat",
    relatedSlugs: ["profit-expenses", "staff-sync"],
    ar: {
      cardTitle: "الفاتورة الضريبية (VAT)",
      cardBody: "ضريبة القيمة المضافة اختيارية، برقم فاتورة متسلسل ورمز ZATCA للسعودية.",
      metaTitle: "فاتورة ضريبية مبسطة وضريبة القيمة المضافة (VAT) | اوردرات",
      metaDescription:
        "فعّل ضريبة القيمة المضافة عند الحاجة فقط: معدل حسب دولتك، فاتورة ضريبية مبسطة برقم متسلسل، ورمز ZATCA لمتاجر السعودية.",
      h1: "فاتورة ضريبية مبسطة بضريبة القيمة المضافة، عند الحاجة فقط",
      lead: "ما كل بائع مسجّل في الضريبة، فخليناها اختيارية بالكامل. فعّلها يوم تحتاجها، من غير ما تتغيّر طريقة عملك اليوم.",
      highlights: [
        "مطفية من البداية؛ فعّلها من الإعدادات براحتك",
        "معدل الضريبة يتحدد من عملة متجرك: البحرين 10%، السعودية 15%، الإمارات وعُمان 5%",
        "اختر: أسعارك شاملة الضريبة أو غير شاملة",
        "رقم فاتورة متسلسل لا يتكرر (مثل INV-000123)",
        "رمز ZATCA على الفاتورة تلقائياً لمتاجر السعودية",
        "تغيير المعدل لاحقاً لا يغيّر فواتير سابقة",
      ],
      sections: [
        {
          heading: "فاتورة ضريبية مبسطة",
          body: "كل فاتورة تُظهر اسمك التجاري، الرقم الضريبي، رقم الفاتورة، التاريخ والوقت، تفاصيل الطلب، الإجمالي قبل الضريبة، قيمة الضريبة، والإجمالي النهائي.",
        },
        {
          heading: "حساب دقيق للفلس",
          body: "تُحسب الضريبة بوحدات صحيحة (فلس أو هللة) بدل الكسور العشرية، فما تظهر فروقات بسيطة بين الفاتورة والحساب الفعلي.",
        },
        {
          heading: "رمز ZATCA للسعودية",
          body: "لمتاجر بعملة الريال السعودي، تُضاف الفاتورة برمز استجابة سريعة (QR) وفق مرحلة هيئة الزكاة والضريبة والجمارك الأولى.",
        },
        {
          heading: "الضريبة المحصّلة في شاشة الأموال",
          body: "شاشة الأموال تُظهر إجمالي الضريبة المحصّلة في أي فترة تختارها، منفصلة عن الإيراد والمصاريف.",
        },
      ],
    },
    en: {
      cardTitle: "Tax invoice (VAT)",
      cardBody: "Optional VAT, with sequential invoice numbers and a ZATCA QR code for Saudi Arabia.",
      metaTitle: "Simplified tax invoice & VAT for small businesses | Orderat",
      metaDescription:
        "Turn on VAT only when you need it: a rate based on your country, a simplified tax invoice with sequential numbers, and a ZATCA QR code for Saudi shops.",
      h1: "A simplified tax invoice with VAT, only when you need it",
      lead: "Not every seller is VAT-registered, so it's entirely optional. Turn it on the day you need it, without changing how you already work.",
      highlights: [
        "Off by default; turn it on from Settings whenever you're ready",
        "The rate is set from your shop's currency: Bahrain 10%, Saudi Arabia 15%, UAE and Oman 5%",
        "Choose whether your prices already include VAT or not",
        "A sequential invoice number that's never reused (like INV-000123)",
        "A ZATCA QR code added automatically for Saudi shops",
        "Changing the rate later never rewrites past invoices",
      ],
      sections: [
        {
          heading: "A simplified tax invoice",
          body: "Every invoice shows your business name, tax number, invoice number, date and time, order lines, the subtotal before VAT, the VAT amount, and the total.",
        },
        {
          heading: "Exact minor-unit math",
          body: "VAT is computed in integer minor units (fils or halalas) instead of decimals, so there's never a small mismatch between the invoice and the real total.",
        },
        {
          heading: "A ZATCA QR code for Saudi Arabia",
          body: "For shops priced in Saudi riyal, invoices include the phase-1 QR code required by Saudi Arabia's Zakat, Tax and Customs Authority.",
        },
        {
          heading: "VAT collected, in the Money screen",
          body: "The Money screen shows total VAT collected for any period you pick, kept separate from revenue and expenses.",
        },
      ],
    },
  },
  {
    slug: "stock",
    icon: "box",
    relatedSlugs: ["shop-link", "whatsapp-orders"],
    ar: {
      cardTitle: "المخزون (اختياري)",
      cardBody: "تتبّع الكمية المتوفرة، خصم تلقائي عند التأكيد، وتنبيه عند القرب من النفاد.",
      metaTitle: "تتبّع المخزون للمنتجات المحدودة | اوردرات",
      metaDescription:
        "تتبّع مخزون منتجاتك المحدودة، خصم تلقائي عند تأكيد الطلب، وتنبيه مخزون منخفض. مطفّى من البداية ويعمل لكل منتج على حدة.",
      h1: "تتبّع مخزونك، بلا تعقيد",
      lead: "لو منتجك محدود الكمية، شغّل تتبع المخزون. لو تبيع أول ما يجهز، سيبه مقفولاً ولن يتغيّر شي في تجربتك.",
      highlights: [
        "مطفي من البداية، ويُفعَّل لكل منتج على حدة",
        "خصم تلقائي من المخزون عند تأكيد الطلب",
        "رجوع الكمية تلقائياً عند إلغاء طلب مؤكد",
        "تنبيه \"مخزون منخفض\" عند حد تحدده لكل منتج (3 افتراضياً)",
        "تعديل يدوي بسبب: استلام، تلف، أو تصحيح",
        "المخزون قد ينزل تحت الصفر، ويظهر بالأحمر كتنبيه بدل ما يمنعك من تسجيل الطلب",
      ],
      sections: [
        {
          heading: "خصم وإرجاع تلقائي",
          body: "أول ما تؤكد الطلب، تُخصم الكمية من المخزون. لو الطلب انلغى بعد التأكيد، ترجع الكمية تلقائياً. وإذا عدّلت كمية طلب مؤكد، يتعدّل الفرق فقط.",
        },
        {
          heading: "بطاقات تنبيه",
          body: "شاشة اليوم تُظهر بطاقة \"مخزون منخفض\" لأي منتج وصل لحده الأدنى، ولائحة المنتجات تُظهر شارة الكمية المتبقية على كل منتج.",
        },
        {
          heading: "يتوقف تلقائياً في رابط متجرك",
          body: "أي منتج يتتبّع مخزونه وتصل كميته للصفر يظهر \"غير متوفر\" في رابط متجرك العام تلقائياً، بدون أن تحدّثه بنفسك.",
        },
      ],
    },
    en: {
      cardTitle: "Stock (optional)",
      cardBody: "Track quantity on hand, auto-deduct on confirm, and get low-stock alerts.",
      metaTitle: "Optional stock tracking for limited-quantity products | Orderat",
      metaDescription:
        "Track stock for your limited-quantity products, with auto-deduction on order confirmation and low-stock alerts. Off by default, per product.",
      h1: "Track your stock, without the complexity",
      lead: "If a product has a limited quantity, turn on stock tracking. If you make things to order, leave it off and nothing about your workflow changes.",
      highlights: [
        "Off by default, and turned on per product",
        "Auto-deducted from stock when an order is confirmed",
        "Quantities return automatically when a confirmed order is cancelled",
        "A \"low stock\" alert at a threshold you set per product (default 3)",
        "Manual adjustments with a reason: received, damaged, or correction",
        "Stock can go negative — shown in red as a warning, never blocked",
      ],
      sections: [
        {
          heading: "Automatic deduction and returns",
          body: "The moment you confirm an order, its quantities are deducted from stock. Cancel a confirmed order and the quantities come back. Edit a confirmed order's quantities and only the difference is adjusted.",
        },
        {
          heading: "Alert cards",
          body: "The Today screen shows a \"low stock\" card for any tracked product at or below its threshold, and the product list shows a stock badge on every item.",
        },
        {
          heading: "Automatically reflected on your shop link",
          body: "Any tracked product that reaches zero is automatically marked unavailable on your public shop link — no manual update needed.",
        },
      ],
    },
  },
  {
    slug: "ai-order-entry",
    icon: "wand",
    relatedSlugs: ["whatsapp-orders", "staff-sync"],
    ar: {
      cardTitle: "تسجيل الطلب بالذكاء الاصطناعي",
      cardBody: "الصق رسالة واتساب أو شارك لقطة شاشة، واوردرات يجهّز الطلب لمراجعتك.",
      metaTitle: "تسجيل الطلبات تلقائياً من رسائل واتساب بالذكاء الاصطناعي | اوردرات",
      metaDescription:
        "الصق نص رسالة أو شارك لقطة شاشة، ويجهّز اوردرات مسودة الطلب: العميل والمنتجات والكمية والموعد، لتراجعها قبل الحفظ.",
      h1: "من رسالة واتساب إلى طلب جاهز في ثوانٍ",
      lead: "بدل ما تقرأ الرسالة وتكتب كل تفاصيلها بنفسك، الصق نص الرسالة أو شارك لقطة شاشة مع اوردرات، وهو يجهّز مسودة الطلب: العميل، المنتجات، الكمية، والموعد.",
      highlights: [
        "يقبل نصاً ملصوقاً أو لقطة شاشة (صورة)",
        "على أندرويد: شارك أي رسالة إلى اوردرات مباشرة من قائمة المشاركة",
        "يطابق أسماء منتجاتك تلقائياً مع ما ورد في الرسالة",
        "تراجع المسودة وتعدّلها قبل الحفظ — لا يُحفظ شي دون موافقتك",
        "أرقام الهاتف تُحذف من النص قبل إرساله للمعالجة",
        "لا يُخزَّن شي من الرسالة أو الصورة بعد إنشاء المسودة",
      ],
      sections: [
        {
          heading: "مراجعة قبل الحفظ",
          body: "الذكاء الاصطناعي يقترح، وأنت تقرر. كل مسودة تفتح في نموذج المراجعة العادي، تعدّل فيه اسم العميل أو الكمية أو الموعد قبل حفظها كطلب فعلي.",
        },
        {
          heading: "خصوصية أولاً",
          body: "أرقام هواتف عملائك تُحذف من النص قبل إرساله للمعالجة، ولا تُحفظ الرسالة أو لقطة الشاشة على خوادمنا بعد إنشاء المسودة.",
        },
        {
          heading: "اسأل اوردرات عن أرقامك",
          body: "نفس فكرة المراجعة والدقة تقف خلف \"اسأل اوردرات\"، حيث تسأل بلهجتك الخليجية عن ربحك أو أكثر منتج مبيعاً أو منو باقي عليه فلوس، ويجاوبك من بيانات متجرك فقط.",
        },
      ],
    },
    en: {
      cardTitle: "AI order entry",
      cardBody: "Paste a WhatsApp message or share a screenshot, and Orderat drafts the order for you.",
      metaTitle: "AI order entry from WhatsApp messages and screenshots | Orderat",
      metaDescription:
        "Paste a message or share a screenshot, and Orderat drafts the order: customer, products, quantities and date, for you to review before saving.",
      h1: "From a WhatsApp message to a ready order in seconds",
      lead: "Instead of reading a message and typing out every detail yourself, paste the message text or share a screenshot with Orderat, and it drafts the order: customer, products, quantities, and date.",
      highlights: [
        "Accepts pasted text or a screenshot image",
        "On Android: share any message straight to Orderat from the share sheet",
        "Automatically matches product names mentioned in the message",
        "You review and edit the draft before saving — nothing is saved without your say",
        "Phone numbers are stripped from the text before it's processed",
        "Nothing from the message or screenshot is stored after the draft is created",
      ],
      sections: [
        {
          heading: "You review before it's saved",
          body: "AI suggests, you decide. Every draft opens in the normal review form, where you can edit the customer name, quantity, or date before it becomes a real order.",
        },
        {
          heading: "Privacy first",
          body: "Customers' phone numbers are removed from the text before it's processed, and neither the message nor the screenshot is stored on our servers after the draft is created.",
        },
        {
          heading: "Ask Orderat about your numbers",
          body: "The same reviewed, grounded approach powers Ask Orderat, where you ask in Gulf Arabic how much you made this month, your best-seller, or who still owes you money — answered only from your own shop data.",
        },
      ],
    },
  },
  {
    slug: "shop-link",
    icon: "link",
    relatedSlugs: ["photo-studio-campaigns", "stock"],
    showDemoLink: true,
    ar: {
      cardTitle: "رابط متجرك",
      cardBody: "صفحة عامة بمنتجاتك، يطلب منها عميلك مباشرة ويصل الطلب لتطبيقك.",
      metaTitle: "رابط متجر مجاني لعملك بدون موقع إلكتروني | اوردرات",
      metaDescription:
        "صفحة عامة بمنتجاتك وأسعارك، عميلك يطلب منها مباشرة، والطلب يصلك جاهزاً في اوردرات لتراجعه وتؤكده.",
      h1: "رابط متجر يشتغل بدون موقع إلكتروني",
      lead: "شارك رابطاً واحداً في بايو إنستغرام أو حالة واتساب، يشوف عملاؤك منتجاتك وأسعارك، ويطلبون منه مباشرة — والطلب يصلك في اوردرات جاهزاً.",
      highlights: [
        "صفحة عامة بمنتجاتك وأسعارك وصورها",
        "اختر: استلام فقط، توصيل فقط، أو الاثنين",
        "العميل يطلب من الصفحة، وتستلمه في اوردرات لتراجعه وتؤكده",
        "\"Powered by Orderat\" — ترويج خفيف لمتجرك، لا لأي طرف آخر",
        "رمز QR جاهز لطباعته أو مشاركته",
        "غير متاح في النسخة التجريبية — يحتاج متجرك الحقيقي",
      ],
      sections: [
        {
          heading: "من الصورة إلى الطلب",
          body: "عميلك يفتح الرابط، يشوف منتجاتك بصورها وأسعارها، يضيفها للسلة، ويكتب اسمه ورقمه وموعد الاستلام أو التوصيل، ثم يرسل الطلب.",
        },
        {
          heading: "يصلك في التطبيق",
          body: "الطلبات الجديدة من رابط متجرك تظهر في شاشة اليوم تحت قسم \"من رابط متجرك\"، تراجعها وتضيفها كطلب عادي بضغطة واحدة.",
        },
        {
          heading: "جرّبه بنفسك",
          body: "شوف كيف تبدو التجربة من طرف عميلك في متجر تجريبي جاهز الآن، بدون أي تسجيل.",
        },
      ],
    },
    en: {
      cardTitle: "Your shop link",
      cardBody: "A public page of your products — customers order directly, and it lands in your app.",
      metaTitle: "A free shop link for your business, no website needed | Orderat",
      metaDescription:
        "A public page with your products and prices. Customers order directly from it, and the order lands ready to review in Orderat.",
      h1: "A shop link that works without a website",
      lead: "Share one link in your Instagram bio or WhatsApp status. Customers see your products and prices and order right from it — and the order lands ready in Orderat.",
      highlights: [
        "A public page with your products, prices, and photos",
        "Choose pickup only, delivery only, or both",
        "Customers order from the page; you review and confirm it in Orderat",
        "\"Powered by Orderat\" — light promotion for your shop, not anyone else's",
        "A QR code ready to print or share",
        "Not available in demo mode — it needs your real shop",
      ],
      sections: [
        {
          heading: "From photo to order",
          body: "Your customer opens the link, browses your products with photos and prices, adds them to a cart, and enters their name, number, and pickup or delivery time before sending the order.",
        },
        {
          heading: "It lands right in the app",
          body: "New orders from your shop link show up on the Today screen under \"From your shop link\" — review and add them as a normal order with one tap.",
        },
        {
          heading: "See it for yourself",
          body: "See what the experience looks like from your customer's side in a live demo shop, right now, no sign-up needed.",
        },
      ],
    },
  },
  {
    slug: "profit-expenses",
    icon: "wallet",
    relatedSlugs: ["tax-invoice", "staff-sync"],
    ar: {
      cardTitle: "الربح والمصاريف",
      cardBody: "الإيرادات والمصاريف والربح الحقيقي، برسوم بيانية لأي فترة.",
      metaTitle: "احسب ربحك الحقيقي بعد المصاريف | اوردرات",
      metaDescription:
        "سجّل مصاريفك مع إيراداتك، واعرف ربحك الصافي أسبوعياً وشهرياً وسنوياً، مع أكثر منتج وأكثر عميل مبيعاً.",
      h1: "اعرف ربحك الحقيقي، لا فقط مبيعاتك",
      lead: "المبيعات ليست نفس الربح. اوردرات يسجّل مصاريفك مع إيراداتك، ويحسب لك الربح الصافي بعد خصم كل شي.",
      highlights: [
        "مصاريف بتصنيفات: مواد، تغليف، توصيل، إعلانات، أدوات، إيجار، أخرى",
        "مصاريف متكررة (شهرية مثلاً) تُسجَّل مرة واحدة",
        "رسوم بيانية أسبوعية، شهرية، لآخر 3 أشهر، سنوية، أو منذ البداية",
        "أكثر المنتجات مبيعاً وأكثر العملاء طلباً",
        "قيمة الضريبة المحصّلة تظهر منفصلة عند تفعيلها",
      ],
      sections: [
        {
          heading: "أرباح حسب الفترة",
          body: "قارن ربحك هذا الأسبوع بالأسبوع الماضي، أو هذا الشهر بالشهر اللي قبله، وشوف الاتجاه بدل حسابه يدوياً كل مرة.",
        },
        {
          heading: "مصاريف منظمة",
          body: "سجّل كل مصروف بتصنيفه، وحدد المصاريف المتكررة مرة واحدة بدل تسجيلها من جديد كل شهر.",
        },
        {
          heading: "اسأل عن أرقامك مباشرة",
          body: "بدل فتح الرسوم البيانية، اسأل \"اسأل اوردرات\": كم ربحت هذا الشهر؟ ويجاوبك من بيانات متجرك مباشرة.",
        },
      ],
    },
    en: {
      cardTitle: "Profit & expenses",
      cardBody: "Revenue, expenses, and real profit — with charts for any period.",
      metaTitle: "Know your real profit after expenses | Orderat",
      metaDescription:
        "Track expenses alongside revenue and see your net profit weekly, monthly and yearly, plus your best-selling products and customers.",
      h1: "Know your real profit, not just your sales",
      lead: "Sales are not the same as profit. Orderat tracks your expenses alongside your revenue and works out your net profit after everything is accounted for.",
      highlights: [
        "Expenses by category: ingredients, packaging, delivery, ads, tools, rent, other",
        "Recurring expenses (like a monthly bill) are entered once",
        "Charts by week, month, last 3 months, year, or all time",
        "Your best-selling products and most frequent customers",
        "VAT collected shown separately once it's turned on",
      ],
      sections: [
        {
          heading: "Profit by period",
          body: "Compare this week's profit to last week's, or this month to last month, and see the trend instead of calculating it by hand every time.",
        },
        {
          heading: "Organized expenses",
          body: "Log every expense under its category, and set up recurring expenses once instead of re-entering them every month.",
        },
        {
          heading: "Just ask about your numbers",
          body: "Instead of opening the charts, ask Ask Orderat how much you made this month, and get an answer straight from your own shop data.",
        },
      ],
    },
  },
  {
    slug: "staff-sync",
    icon: "users",
    relatedSlugs: ["ai-order-entry", "tax-invoice"],
    ar: {
      cardTitle: "الموظفين والمزامنة السحابية",
      cardBody: "اشتغل من أكثر من جهاز، وأضف موظفين بصلاحيات محددة.",
      metaTitle: "أضف موظفين وزامن متجرك بين أجهزة متعددة | اوردرات",
      metaDescription:
        "نسخ احتياطي ومزامنة سحابية اختيارية عبر Apple أو Google، مع دعوة موظفين بصلاحيات محددة للطلبات والتحضير والأموال والمنتجات.",
      h1: "متجر واحد، أكثر من جهاز وأكثر من شخص",
      lead: "لو تشتغل أنت وموظف أو شريك، أو تبي تشتغل من جوالك وجوال آخر، فعّل النسخ الاحتياطي والمزامنة السحابية — اختياري بالكامل.",
      highlights: [
        "تسجيل الدخول بحساب Apple أو Google",
        "بياناتك تبقى على جهازك أصلاً؛ المزامنة اختيار لا إلزام",
        "دعوة موظف برمز من 6 أرقام صالح لمدة 48 ساعة",
        "صلاحيات محددة: الطلبات، التحضير فقط، الأموال، المنتجات",
        "أي تعديل على صلاحيات الموظف يصل لجهازه في المزامنة التالية",
        "حذف حسابك يحذف متاجرك وبياناتها بالكامل",
      ],
      sections: [
        {
          heading: "بدون إنترنت أولاً",
          body: "التطبيق يقرأ من نسخته المحلية دائماً؛ المزامنة تعمل في الخلفية عند فتح التطبيق أو بعد كل تعديل، ولا توقفك عن الشغل لو النت بطيء أو مقطوع.",
        },
        {
          heading: "صلاحيات واضحة",
          body: "موظف \"التحضير\" يغيّر حالة الطلب فقط، وموظف بلا صلاحية \"الأموال\" لا يشوف المصاريف ولا الأرباح. أنت تتحكم بمن يشوف وش.",
        },
        {
          heading: "نفس المتجر من كل الأجهزة",
          body: "تعديلك يصل لجهاز موظفك بالمزامنة التالية، وبالعكس. وفي حال تعارض نادر، آخر تعديل هو الذي يُعتمد.",
        },
      ],
    },
    en: {
      cardTitle: "Staff & cloud sync",
      cardBody: "Work from more than one device, and invite staff with specific permissions.",
      metaTitle: "Add staff and sync your shop across devices | Orderat",
      metaDescription:
        "Optional cloud backup and sync with Apple or Google sign-in, plus staff invites with permissions for orders, prep, money and products.",
      h1: "One shop, more than one device and more than one person",
      lead: "Whether you work with staff or a partner, or just want to use your shop from two phones, turn on cloud backup and sync — entirely optional.",
      highlights: [
        "Sign in with an Apple or Google account",
        "Your data stays on your device by default; sync is opt-in",
        "Invite staff with a 6-digit code, valid for 48 hours",
        "Specific permissions: orders, prep only, money, products",
        "Any change to a staff member's permissions reaches their phone on the next sync",
        "Deleting your account deletes your shops and their data entirely",
      ],
      sections: [
        {
          heading: "Offline first",
          body: "The app always reads from its local copy; sync runs in the background on launch or after an edit, and never blocks you when the connection is slow or down.",
        },
        {
          heading: "Clear permissions",
          body: "A \"prep\" staff member can only change an order's status, and staff without \"money\" access never see expenses or profit. You decide who sees what.",
        },
        {
          heading: "The same shop, on every device",
          body: "Your change reaches your staff member's phone on the next sync, and theirs reaches yours. In the rare case of a conflict, the latest edit wins.",
        },
      ],
    },
  },
  {
    slug: "photo-studio-campaigns",
    icon: "camera",
    relatedSlugs: ["shop-link", "whatsapp-orders"],
    ar: {
      cardTitle: "استوديو الصور وحملات المناسبات",
      cardBody: "صورة جوال تتحول لصورة استوديو، وحملة جاهزة لكل مناسبة خليجية.",
      metaTitle: "استوديو صور بالذكاء الاصطناعي وحملات مناسبات جاهزة | اوردرات",
      metaDescription:
        "حوّل صورة منتجك بجوالك إلى صورة استوديو أو صورة مناسبة، واستخدم حملات جاهزة بأفكار وكابشنات وهاشتاقات لكل مناسبة خليجية.",
      h1: "صور استوديو وحملات مناسبات جاهزة، بدون مصمم",
      lead: "صوّر منتجك بجوالك، واوردرات يحوّلها لصورة استوديو بخلفية نظيفة. وقبل كل مناسبة خليجية، حملة جاهزة بأفكار وكابشنات وهاشتاقات.",
      highlights: [
        "صورة عادية بجوالك تتحول لصورة بخلفية استوديو أو مناسبة",
        "المنتج نفسه لا يتغيّر — يتغيّر الخلفية والإضاءة فقط",
        "أشكال جاهزة لمنشور مربع، بورتريه، أو ستوري",
        "حملة جاهزة لكل مناسبة (رمضان، عيد، اليوم الوطني، يوم المعلم...) تتحدث تلقائياً",
        "كابشنات جاهزة بثلاث صيغ، تُعبّى تلقائياً باسم متجرك ومنتجك وسعره",
        "هاشتاقات جاهزة لكل مناسبة",
      ],
      sections: [
        {
          heading: "قبل وبعد",
          body: "اختر صورة من جوالك، اختر نمط الاستوديو أو نمط المناسبة، واختر الشكل (مربع، بورتريه، ستوري)، ويجهّز لك اوردرات النتيجة لتقارنها بالأصل قبل الحفظ.",
        },
        {
          heading: "تقويم مناسبات الخليج",
          body: "بطاقة \"اليوم\" تذكّرك بالمناسبة القادمة قبل وقتها بأيام، بمواعيدها الهجرية والميلادية، وتقترح عليك حملة جاهزة.",
        },
        {
          heading: "من الحملة إلى الطلب",
          body: "كل كابشن جاهز يتضمن رابط متجرك تلقائياً إذا نشرته، فعميلك يطلب مباشرة من نفس المنشور.",
        },
      ],
    },
    en: {
      cardTitle: "Photo studio & occasion campaigns",
      cardBody: "A phone photo becomes a studio shot, with a ready campaign for every Gulf occasion.",
      metaTitle: "AI photo studio and ready-made occasion campaigns | Orderat",
      metaDescription:
        "Turn a plain phone photo into a studio or occasion photo, and use ready campaigns with tips, captions and hashtags for every Gulf occasion.",
      h1: "Studio photos and occasion campaigns, no designer needed",
      lead: "Take a plain photo of your product with your phone, and Orderat turns it into a clean studio shot. Before every Gulf occasion, a ready campaign gives you ideas, captions, and hashtags.",
      highlights: [
        "An ordinary phone photo becomes a studio or occasion-styled photo",
        "The product itself never changes — only the background and lighting do",
        "Ready shapes for a square post, a portrait post, or a story",
        "A ready campaign for every occasion (Ramadan, Eid, National Days, Teachers' Day...) that updates automatically",
        "Three caption variants, auto-filled with your shop name, product, and price",
        "Ready hashtags for every occasion",
      ],
      sections: [
        {
          heading: "Before and after",
          body: "Pick a photo from your phone, choose a studio or occasion style, and pick a shape (square, portrait, story). Orderat prepares the result in seconds so you can compare it with the original before saving.",
        },
        {
          heading: "A calendar of Gulf occasions",
          body: "The Today card reminds you of the next occasion days ahead, with both Hijri and Gregorian dates, and suggests a ready campaign.",
        },
        {
          heading: "From campaign to order",
          body: "Every ready caption automatically includes your shop link when you've published one, so your customer can order straight from the same post.",
        },
      ],
    },
  },
];

export function getFeature(slug) {
  return FEATURES.find((f) => f.slug === slug);
}
