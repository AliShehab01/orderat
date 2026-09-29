// Privacy and Terms content, copied from the existing legal pages at public/orderat/privacy.html
// and public/orderat/terms.html (both already bilingual and reviewed). Reproduced here verbatim
// where possible, re-flowed into this site's section structure. Segments are either a plain
// string (escaped as text) or an array of {text} / {link, text} parts for inline links.

import { BRAND } from "../config.mjs";

const DATA_DELETION_URL = "https://orderatweb.com/data-deletion.html";

export const PRIVACY = {
  lastUpdated: { ar: "27 سبتمبر 2026", en: "27 September 2026" },
  ar: {
    title: "سياسة الخصوصية",
    metaTitle: "سياسة الخصوصية | اوردرات",
    metaDescription: "سياسة الخصوصية لاوردرات: ما المعلومات التي نتعامل معها ولماذا، وكيف تطلب حذفها.",
    intro:
      "يساعد اوردرات (\"نحن\") الأعمال الصغيرة في مملكة البحرين على تحويل رسائل العملاء إلى طلبات مؤكدة وخطة تحضير يومية. توضح هذه السياسة المعلومات التي يتعامل معها اوردرات، وسبب ذلك، والخيارات المتاحة لك. تنطبق على أصحاب الأعمال الذين يستخدمون اوردرات (\"البائعون\")، وعلى الأشخاص الذين يراسلون بائعاً يستخدم اوردرات (\"العملاء\").",
    sections: [
      {
        heading: "1. المعلومات التي نتعامل معها",
        list: [
          "معلومات حساب البائع: الاسم والبريد الإلكتروني وبيانات تسجيل الدخول عبر Google أو Apple، واسم النشاط التجاري والمنتجات والإعدادات.",
          "الطلبات والمحتوى الذي يضيفه البائع: نصوص الطلبات التي يلصقها أو يشاركها، ولقطات الشاشة، والرسائل الصوتية، والطلبات والمنتجات والخطط الناتجة عنها.",
          "الرسائل في الحسابات المرتبطة (باقة Pro): عندما يربط البائع رقم واتساب للأعمال أو حساب إنستغرام احترافياً، يستقبل اوردرات الرسائل التي يرسلها العملاء إلى ذلك الحساب، ويشمل ذلك رقم هاتف العميل أو اسم مستخدمه، ونص الرسالة، والرسائل الصوتية والصور. كما يحفظ اوردرات الردود التي يرسلها نيابةً عن البائع.",
          "بيانات تطبيق الجوال: يحفظ تطبيق اوردرات الطلبات والعملاء والمنتجات والمصاريف على جهاز البائع نفسه، ولا يصل منها شيء إلى خوادمنا إلا عند استخدام الميزات المذكورة في هذه السياسة.",
          "الحساب والمزامنة السحابية (اختيارية): إذا سجّل البائع الدخول عبر Apple أو Google لتفعيل النسخ الاحتياطي والمزامنة، نحفظ معرّف الحساب والبريد الإلكتروني والاسم، ونسخة من بيانات المتجر لتتزامن بين أجهزته وأجهزة موظفيه.",
          "رابط المتجر: عندما ينشر البائع رابط متجره، نحفظ ما يختار نشره (اسم المتجر ونبذة عنه والمنطقة وأوقات الاستلام ورقم واتساب والمنتجات وأسعارها وصورها)، ويصبح هذا المحتوى متاحاً للعامة. وعندما يطلب عميل من صفحة المتجر، نحفظ اسمه ورقم هاتفه وتفاصيل طلبه حتى يستلمها تطبيق البائع.",
          "حالة الاشتراك: تتم معالجة المدفوعات عبر Google Play أو App Store. نستلم حالة الاشتراك فقط، ولا نستلم بيانات البطاقات.",
          "المعلومات التقنية: سجلات أساسية مثل أوقات الطلبات وتقارير الأخطاء، نستخدمها لتشغيل الخدمة وحمايتها.",
        ],
      },
      {
        heading: "2. كيف نستخدم المعلومات",
        list: [
          "لقراءة الطلبات من الرسائل وإنشاء مسودات طلبات يراجعها البائع.",
          "لإرسال الردود وملخصات الطلبات والتأكيدات إلى العملاء نيابةً عن البائع، عندما يفعّل البائع ذلك.",
          "لإعداد دفتر الطلبات وخطة التحضير وعرض المخزون والمبيعات للبائع.",
          "لتشغيل اوردرات وحمايته ودعمه وتحسينه.",
        ],
        paragraphs: ["لا نبيع المعلومات الشخصية، ولا نستخدم رسائل العملاء لأغراض إعلانية."],
      },
      {
        heading: "3. المعالجة بالذكاء الاصطناعي",
        paragraphs: [
          "يستخدم اوردرات خدمة ذكاء اصطناعي، هي Gemini API من Google، لقراءة تفاصيل الطلب من النصوص والصور والرسائل الصوتية. يُرسل محتوى الرسالة إلى هذه الخدمة لاستخراج الطلب فقط، ولا نرسل أرقام هواتف العملاء إليها. ويراجع البائع كل طلب يجهّزه الذكاء الاصطناعي قبل تأكيده.",
          "ويستخدم تطبيق الجوال خدمة Gemini في الميزات التالية، ولا تعمل أي منها إلا عندما يستخدمها البائع:",
        ],
        list: [
          "اسأل اوردرات: يُرسل ملخص لأرقام المتجر (المبيعات والمصاريف وأسماء المنتجات والأسماء الأولى للعملاء) مع سؤال البائع. لا نرسل أرقام الهواتف ولا العناوين.",
          "كتابة المنشورات: يُرسل اسم المتجر وأسماء المنتجات المختارة وأسعارها.",
          "قراءة الطلب بالذكاء الاصطناعي: عندما يلصق البائع رسالة طلب أو يختار لقطة شاشة، تُرسل إلى Gemini لقراءة تفاصيل الطلب بعد حذف أرقام الهواتف من النص، ولا نحفظ الرسالة ولا الصورة.",
          "استوديو الصور: تُرسل صورة المنتج التي يختارها البائع لإنشاء صورة جديدة، ولا نحفظ أياً من الصورتين على خوادمنا.",
        ],
      },
      {
        heading: "4. مشاركة المعلومات",
        paragraphs: ["نشارك المعلومات بالقدر اللازم لتشغيل اوردرات فقط:"],
        list: [
          "مع البائع صاحب الحساب: يرى رسائل عملائه وطلباتهم.",
          "مع أي شخص يفتح رابط المتجر: يرى المحتوى الذي اختار البائع نشره فقط.",
          "مع مزودي الخدمات الذين يعالجون البيانات لصالحنا: Meta (منصة واتساب للأعمال ورسائل إنستغرام)، وGoogle (خدمة Gemini وتسجيل الدخول والدفع عبر Google Play)، وApple (تسجيل الدخول والدفع عبر App Store)، ومزودو الاستضافة وقواعد البيانات.",
          "عندما يتطلب القانون ذلك، أو لحماية حقوق المستخدمين واوردرات وسلامتهم.",
        ],
      },
      {
        heading: "5. مدة الاحتفاظ",
        list: [
          "تُحذف لقطات الشاشة والرسائل الصوتية بعد 30 يوماً من تأكيد الطلب المرتبط بها.",
          "تُحفظ الطلبات والرسائل ما دام حساب البائع نشطاً.",
          "تُحذف طلبات العملاء المرسلة من صفحة المتجر من خوادمنا بمجرد أن يستلمها تطبيق البائع، وخلال 30 يوماً كحد أقصى.",
          "تبقى بيانات المزامنة السحابية ما دام الحساب موجوداً، وعند حذف الحساب من التطبيق نحذفه ونحذف المتاجر التي يملكها وبياناتها.",
          "يختفي محتوى رابط المتجر من الصفحة العامة عندما يوقف البائع النشر، ونحذفه عندما يطلب البائع ذلك.",
          "عند انتهاء الاشتراك، تبقى بيانات البائع متاحة للقراءة 30 يوماً ليتمكن من تصديرها، ثم تُحذف.",
          "عندما يحذف البائع حسابه، أو يطلب أي شخص حذف بياناته، نحذفها خلال 30 يوماً، إلا ما يلزمنا القانون بالاحتفاظ به.",
        ],
      },
      {
        heading: "6. الأمان",
        paragraphs: [
          "تُنقل المعلومات عبر اتصالات مشفرة (HTTPS). تُحفظ مفاتيح الوصول إلى واتساب وإنستغرام على خوادمنا ولا تُحفظ في التطبيق. وتُفصل بيانات كل بائع عن بيانات غيره من البائعين.",
        ],
      },
      {
        heading: "7. حقوقك",
        paragraphs: [
          [
            "وفقاً لقانون حماية البيانات الشخصية في مملكة البحرين (القانون رقم 30 لسنة 2018)، يحق لك طلب الاطلاع على بياناتك الشخصية أو تصحيحها أو حذفها، أو الاعتراض على طريقة استخدامها. راسلنا على ",
            { link: `mailto:${BRAND.email}`, text: BRAND.email },
            ". ويمكن لعملاء البائع أيضاً التواصل مع البائع مباشرة. لطريقة حذف بياناتك، راجع ",
            { link: DATA_DELETION_URL, text: "صفحة حذف البيانات" },
            ".",
          ],
        ],
      },
      {
        heading: "8. مكان معالجة البيانات",
        paragraphs: ["قد يعالج مزودو الخدمات البيانات خارج مملكة البحرين، ونستخدم مزودين يحمون البيانات وفق شروطهم ومعايير الأمان لديهم."],
      },
      { heading: "9. الأطفال", paragraphs: ["اوردرات أداة للأعمال، وهو غير موجّه للأطفال دون 18 عاماً."] },
      { heading: "10. التغييرات", paragraphs: ["نحدّث هذه الصفحة عند تغيّر ممارساتنا، ونعرض تاريخ التحديث الجديد في أعلاها."] },
    ],
    contact: ["للتواصل: اوردرات، مملكة البحرين. البريد الإلكتروني: ", { link: `mailto:${BRAND.email}`, text: BRAND.email }, "."],
  },
  en: {
    title: "Privacy Policy",
    metaTitle: "Privacy Policy | Orderat",
    metaDescription: "Orderat's privacy policy: what information we handle, why, and how to request deletion.",
    intro:
      "Orderat (\"we\", \"us\") helps small businesses in the Kingdom of Bahrain turn customer messages into confirmed orders and a daily preparation plan. This policy explains what information Orderat handles, why, and the choices you have. It applies to business owners who use Orderat (\"sellers\") and to people who message a seller that uses Orderat (\"customers\").",
    sections: [
      {
        heading: "1. Information we handle",
        list: [
          "Seller account information: name, email address and sign-in details from Google or Apple, plus the business name, products and settings.",
          "Orders and content sellers add: order text they paste or share, screenshots, voice notes, and the orders, products and plans created from them.",
          "Messages on connected accounts (Pro plan): when a seller connects a WhatsApp Business number or an Instagram professional account, Orderat receives the messages customers send to that account, including the customer's phone number or username, message text, voice notes and images. Orderat also stores the replies it sends on the seller's behalf.",
          "Data in the phone app: the Orderat phone app keeps orders, customers, products and expenses on the seller's own device. None of it reaches our servers unless the seller uses a feature described in this policy.",
          "Account and cloud sync (optional): if a seller signs in with Apple or Google to turn on cloud backup and sync, we store the provider account id, email address and name, and a copy of the shop's data so it syncs across the seller's devices and staff.",
          "Shop link: when a seller publishes a shop link, we store what they choose to publish (shop name, bio, area, pickup hours, WhatsApp number, products, prices and photos), and that content becomes public. When a customer orders from the shop page, we store their name, phone number and order details until the seller's app downloads them.",
          "Subscription status: Google Play or the App Store process payments. We receive the subscription status, not card details.",
          "Technical information: basic logs such as request times and error reports, used to run the service and keep it secure.",
        ],
      },
      {
        heading: "2. How we use information",
        list: [
          "To read orders from messages and create draft orders for the seller to review.",
          "To send replies, order summaries and confirmations to customers on the seller's behalf, when the seller turns this on.",
          "To build the seller's order book, preparation plan, stock and sales views.",
          "To operate, secure, support and improve Orderat.",
        ],
        paragraphs: ["We do not sell personal information, and we do not use customer messages for advertising."],
      },
      {
        heading: "3. AI processing",
        paragraphs: [
          "Orderat uses an AI service, Google's Gemini API, to read order details from text, images and voice notes. Message content is sent to this service only to extract the order, and we do not send customers' phone numbers to it. The seller reviews every order the AI drafts before it is confirmed.",
          "The phone app also uses Gemini for the features below, and each one runs only when the seller uses it:",
        ],
        list: [
          "Ask Orderat: a summary of the shop's numbers (sales, expenses, product names and customers' first names) is sent with the seller's question. We never send phone numbers or addresses.",
          "Post writing: the shop name and the chosen products' names and prices are sent.",
          "AI order reading: when the seller pastes an order message or picks a screenshot, it is sent to Gemini to read the order details, with phone numbers removed from the text first. We do not store the message or the image.",
          "Photo studio: the product photo the seller picks is sent to create a new image. We do not store either image on our servers.",
        ],
      },
      {
        heading: "4. Sharing",
        paragraphs: ["We share information only as needed to run Orderat:"],
        list: [
          "With the seller who owns the account, who sees their customers' messages and orders.",
          "With anyone who opens a shop link, who sees only the content the seller chose to publish.",
          "With service providers that process data for us: Meta (WhatsApp Business Platform and Instagram messaging), Google (Gemini API, sign-in and Google Play billing), Apple (sign-in and App Store billing), and our hosting and database providers.",
          "When the law requires it, or to protect the rights and safety of users and Orderat.",
        ],
      },
      {
        heading: "5. Retention",
        list: [
          "Screenshots and voice notes are deleted 30 days after the related order is confirmed.",
          "Orders and messages are kept while the seller's account is active.",
          "Customer orders sent from a shop page are deleted from our servers as soon as the seller's app downloads them, and within 30 days at most.",
          "Cloud sync data is kept while the account exists. Deleting the account in the app deletes it and every shop it owns with its data.",
          "Shop link content leaves the public page when the seller unpublishes it, and we delete it when the seller asks.",
          "When a subscription ends, the seller's data stays readable for 30 days so it can be exported, and is then deleted.",
          "When a seller deletes their account, or anyone asks us to delete their data, we delete it within 30 days, except what the law requires us to keep.",
        ],
      },
      {
        heading: "6. Security",
        paragraphs: [
          "Information travels over encrypted connections (HTTPS). Access keys for WhatsApp and Instagram are stored on our servers, not in the app. Each seller's data is kept separate from other sellers' data.",
        ],
      },
      {
        heading: "7. Your rights",
        paragraphs: [
          [
            "Under Bahrain's Personal Data Protection Law (Law No. 30 of 2018), you can ask to access, correct or delete your personal data, or object to how it is used. Email us at ",
            { link: `mailto:${BRAND.email}`, text: BRAND.email },
            ". Customers of a seller can also contact that seller directly. To delete your data, see the ",
            { link: DATA_DELETION_URL, text: "data deletion page" },
            ".",
          ],
        ],
      },
      {
        heading: "8. Where data is processed",
        paragraphs: ["Our service providers may process data outside Bahrain. We use providers that protect data under their own terms and security standards."],
      },
      { heading: "9. Children", paragraphs: ["Orderat is a business tool and is not directed at children under 18."] },
      { heading: "10. Changes", paragraphs: ["We update this page when our practices change and show the new date at the top."] },
    ],
    contact: ["Contact: Orderat, Kingdom of Bahrain. Email: ", { link: `mailto:${BRAND.email}`, text: BRAND.email }, "."],
  },
};

export const TERMS = {
  lastUpdated: { ar: "24 سبتمبر 2026", en: "24 September 2026" },
  ar: {
    title: "شروط الخدمة",
    metaTitle: "شروط الخدمة | اوردرات",
    metaDescription: "شروط استخدام اوردرات.",
    intro:
      "تنطبق هذه الشروط على استخدامك لاوردرات، وهي خدمة تساعد الأعمال على تحويل رسائل العملاء إلى طلبات وخطط يومية. باستخدامك اوردرات فإنك توافق على هذه الشروط، وإذا لم توافق عليها فلا تستخدم اوردرات.",
    sections: [
      {
        heading: "1. الخدمة",
        paragraphs: [
          "يقرأ اوردرات رسائل الطلبات التي تلصقها أو تشاركها أو تستقبلها في حسابات واتساب وإنستغرام المرتبطة، ويجهّز مسودات طلبات لتراجعها، ويعدّ دفتر الطلبات وخطط التحضير. بعض الميزات ما زالت قيد التطوير وقد تتغير.",
        ],
      },
      {
        heading: "2. حسابك",
        paragraphs: [
          "أنت مسؤول عن حسابك، وعن دقة منتجاتك وطلباتك، وعن حماية بيانات تسجيل دخولك. يجب أن يكون عمرك 18 عاماً أو أكثر، وأن تستخدم اوردرات لنشاط تجاري حقيقي.",
        ],
      },
      {
        heading: "3. حسابات واتساب وإنستغرام المرتبطة (باقة Pro)",
        paragraphs: [
          "عندما تربط حساباً، فإنك تفوّض اوردرات باستقبال رسائل عملائك وإرسال الردود ورسائل الطلبات نيابةً عنك. وأنت مسؤول عن الالتزام بشروط واتساب وإنستغرام وسياساتهما، ومنها سياسة المراسلة التجارية في واتساب، وعن الحصول على إذن عملائك لمراسلتهم. ويمكنك إلغاء الربط في أي وقت.",
        ],
      },
      {
        heading: "4. مسودات الذكاء الاصطناعي تحتاج مراجعتك",
        paragraphs: [
          "يستخدم اوردرات الذكاء الاصطناعي لقراءة الطلبات، وقد يخطئ. راجع كل مسودة طلب قبل تأكيدها. وتبقى مسؤولاً عن الطلبات التي تؤكدها وعن الرسائل المرسلة من حساباتك.",
        ],
      },
      {
        heading: "5. الاشتراكات",
        paragraphs: [
          "تُحصَّل رسوم الباقات المدفوعة عبر Google Play أو App Store وفق شروطهما، ويمكنك الإلغاء من حسابك في المتجر. وتسري الأسعار المعروضة قبل اشتراكك إلى أن نبلغك بأي تغيير.",
        ],
      },
      {
        heading: "6. الاستخدام المقبول",
        paragraphs: ["لا تستخدم اوردرات لإرسال رسائل مزعجة، أو لمخالفة القانون، أو لبيع سلع ممنوعة، أو لإساءة استخدام بيانات الآخرين."],
      },
      {
        heading: "7. بياناتك",
        paragraphs: [
          [
            "بياناتك ملك لك. توضح ",
            { link: "/privacy/", text: "سياسة الخصوصية" },
            " كيف نتعامل معها، وتوضح ",
            { link: DATA_DELETION_URL, text: "صفحة حذف البيانات" },
            " طريقة حذفها.",
          ],
        ],
      },
      {
        heading: "8. توفر الخدمة والمسؤولية",
        paragraphs: [
          "نعمل على إبقاء اوردرات متاحاً، لكننا نقدمه \"كما هو\"، ولا نضمن أن يكون متاحاً دائماً أو خالياً من الأخطاء. وفي الحدود التي يسمح بها القانون، لا يتحمل اوردرات مسؤولية الخسائر غير المباشرة مثل فوات المبيعات أو الأرباح، وتقتصر مسؤوليتنا الإجمالية على الرسوم التي دفعتها خلال الأشهر الثلاثة الأخيرة.",
        ],
      },
      { heading: "9. إنهاء الخدمة", paragraphs: ["يمكنك التوقف عن استخدام اوردرات في أي وقت، وقد نوقف الحسابات التي تخالف هذه الشروط."] },
      { heading: "10. القانون المطبق", paragraphs: ["تخضع هذه الشروط لقوانين مملكة البحرين."] },
    ],
    contact: ["للتواصل: اوردرات، مملكة البحرين. البريد الإلكتروني: ", { link: `mailto:${BRAND.email}`, text: BRAND.email }, "."],
  },
  en: {
    title: "Terms of Service",
    metaTitle: "Terms of Service | Orderat",
    metaDescription: "Orderat's terms of service.",
    intro:
      "These terms apply to your use of Orderat, a service that helps businesses turn customer messages into orders and daily plans. By using Orderat you agree to them. If you do not agree, do not use Orderat.",
    sections: [
      {
        heading: "1. The service",
        paragraphs: [
          "Orderat reads the order messages you paste, share or receive on connected WhatsApp and Instagram accounts, drafts orders for you to review, and builds order books and preparation plans. Some features are still in development and may change.",
        ],
      },
      {
        heading: "2. Your account",
        paragraphs: [
          "You are responsible for your account, for the accuracy of your products and orders, and for keeping your sign-in secure. You must be 18 or older and use Orderat for a real business.",
        ],
      },
      {
        heading: "3. Connected WhatsApp and Instagram accounts (Pro)",
        paragraphs: [
          "When you connect an account, you authorise Orderat to receive your customers' messages and to send replies and order messages on your behalf. You are responsible for following WhatsApp's and Instagram's terms and policies, including the WhatsApp Business Messaging Policy, and for having your customers' permission to message them. You can disconnect at any time.",
        ],
      },
      {
        heading: "4. AI drafts need your review",
        paragraphs: [
          "Orderat uses AI to read orders, and AI can make mistakes. Check every draft order before you confirm it. You remain responsible for the orders you confirm and for the messages sent from your accounts.",
        ],
      },
      {
        heading: "5. Subscriptions",
        paragraphs: [
          "Paid plans are billed through Google Play or the App Store under their terms, and you can cancel through your store account. The price shown before you subscribe applies until we tell you about a change.",
        ],
      },
      {
        heading: "6. Acceptable use",
        paragraphs: ["Do not use Orderat to send spam, break the law, sell prohibited goods, or misuse other people's data."],
      },
      {
        heading: "7. Your data",
        paragraphs: [
          [
            "Your data belongs to you. The ",
            { link: "/en/privacy/", text: "privacy policy" },
            " explains how we handle it, and the ",
            { link: DATA_DELETION_URL, text: "data deletion page" },
            " explains how to delete it.",
          ],
        ],
      },
      {
        heading: "8. Availability and liability",
        paragraphs: [
          "We work to keep Orderat running, but we provide it \"as is\" and cannot promise it will always be available or free of errors. To the extent the law allows, Orderat is not liable for indirect losses such as lost sales or profits, and our total liability is limited to the fees you paid in the last three months.",
        ],
      },
      { heading: "9. Ending the service", paragraphs: ["You can stop using Orderat at any time. We may suspend accounts that break these terms."] },
      { heading: "10. Governing law", paragraphs: ["These terms are governed by the laws of the Kingdom of Bahrain."] },
    ],
    contact: ["Contact: Orderat, Kingdom of Bahrain. Email: ", { link: `mailto:${BRAND.email}`, text: BRAND.email }, "."],
  },
};
