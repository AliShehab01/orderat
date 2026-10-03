'use strict';
// Demo shops for the web demo, one per business type. A port of the phone apps' demo data
// (orderat-ios Orderat/Data/DemoCatalog.swift + DemoSeed.swift): the same 12-item catalogs,
// customer book, 40 orders from 3 weeks back to 1 week ahead, expenses and occasions. Amounts are
// in major units (6.5 = 6.500 BHD) rather than the apps' minor units.

const DEMO_CATALOGS = {
  home: {
    ar: 'حلويات أم أحمد', en: 'Umm Ahmed Sweets', phone: '+97336005005',
    items: [
      ['كيك إسفنجي بالفانيليا', 'Vanilla Sponge Cake', ['كيك فانيليا', 'كيك', 'vanilla cake', 'vanilla', 'sponge'], 6.5, 2.5, 6],
      ['كوكيز الشوكولاتة (دزينة)', 'Chocolate Chip Cookies (dozen)', ['كوكيز', 'cookies'], 3, 1.2, 15],
      ['تشيز كيك بالتوت', 'Berry Cheesecake', ['تشيز كيك', 'تشيزكيك', 'cheesecake'], 8, 3.5, 5],
      ['كنافة بالجبن (صينية)', 'Cheese Kunafa (tray)', ['كنافة', 'kunafa'], 7, 3, 8],
      ['بقلاوة مشكلة (علبة)', 'Assorted Baklava (box)', ['بقلاوة', 'baklava'], 5.5, 2.2, 10],
      ['ماكرون فرنسي (6 حبات)', 'French Macarons (box of 6)', ['ماكرون', 'macarons', 'macaron'], 4, 1.5, 12],
      ['كب كيك ريد فيلفت (6 حبات)', 'Red Velvet Cupcakes (6pc)', ['كب كيك', 'ريد فيلفت', 'cupcakes', 'cupcake'], 4.5, 1.8, 12],
      ['لقيمات', 'Luqaimat', ['luqaimat'], 2.5, 1, 20],
      ['تمر محشي (علبة)', 'Stuffed Dates (box)', ['تمر محشي', 'تمر', 'dates'], 4, 1.6, 10],
      ['كيك عيد ميلاد مخصص', 'Custom Birthday Cake', ['كيكة عيد ميلاد', 'كيك عيد ميلاد', 'birthday cake'], 12, 5, 3],
      ['برطمان ديلايت الشوكولاتة', 'Chocolate Delight Jar', ['ديلايت', 'delight'], 3.5, 1.4, 15],
      ['حلى الفستق', 'Pistachio Delight', ['فستق', 'pistachio'], 6, 2.6, 8],
    ],
  },
  shop: {
    ar: 'بوتيك لمسة', en: 'Lamsa Boutique', phone: '+97336005006',
    items: [
      ['عطر عود ملكي', 'Royal Oud Perfume', ['عطر عود', 'عطر', 'عود', 'oud perfume', 'oud', 'perfume'], 15, 6, null],
      ['عباية تطريز يدوي', 'Hand-Embroidered Abaya', ['عباية', 'abaya'], 25, 10, null],
      ['شيلة حرير', 'Silk Shawl', ['شيلة', 'silk shawl', 'shawl'], 8, 3, null],
      ['طقم هدايا فخم', 'Luxury Gift Set', ['هدية', 'طقم هدايا', 'gift set', 'gift'], 12, 5, null],
      ['حقيبة يد جلد', 'Leather Handbag', ['حقيبة', 'handbag', 'bag'], 18, 8, null],
      ['إكسسوار شعر مطرز', 'Embroidered Hair Accessory', ['إكسسوار', 'hair accessory'], 4, 1.5, null],
      ['بخور فاخر (علبة)', 'Premium Bakhoor (box)', ['بخور', 'bakhoor'], 6, 2.5, null],
      ['مبخرة كهربائية', 'Electric Incense Burner', ['مبخرة', 'burner'], 9, 4, null],
      ['عطر سبراي محمول', 'Travel Spray Perfume', ['سبراي', 'spray'], 5, 2, null],
      ['قفطان مناسبات', 'Occasion Kaftan', ['قفطان', 'kaftan'], 22, 9, null],
      ['طقم إكسسوارات ذهبي', 'Gold-Tone Accessory Set', ['طقم', 'accessory set'], 7, 2.8, null],
      ['علبة عطور مسافر', 'Traveler Perfume Set', ['سفر', 'traveler'], 10, 4.2, null],
    ],
  },
  services: {
    ar: 'صالون لمسات', en: 'Lamasat Salon', phone: '+97336005007',
    items: [
      ['قص وتصفيف شعر', 'Haircut & Styling', ['قص شعر', 'haircut'], 8, 2, 6],
      ['صبغة شعر كاملة', 'Full Hair Color', ['صبغة', 'hair color', 'color'], 15, 6, 4],
      ['تنظيف بشرة', 'Facial Cleaning', ['تنظيف بشرة', 'facial'], 12, 4, 5],
      ['تفصيل ثوب', 'Custom Thobe Tailoring', ['تفصيل ثوب', 'تفصيل', 'thobe tailoring', 'thobe'], 10, 4, 3],
      ['تعديل فستان', 'Dress Alteration', ['تعديل', 'alteration'], 5, 1.5, 6],
      ['مناكير وباديكير', 'Manicure & Pedicure', ['مناكير', 'manicure'], 7, 2, 8],
      ['تنظيف مكيف', 'AC Cleaning Service', ['تنظيف مكيف', 'ac cleaning'], 9, 3, 4],
      ['صيانة أجهزة منزلية', 'Home Appliance Repair', ['صيانة', 'repair'], 11, 4.5, 4],
      ['تنظيف منزل شامل', 'Full Home Cleaning', ['تنظيف منزل', 'home cleaning'], 16, 6, 3],
      ['مكياج مناسبات', 'Occasion Makeup', ['مكياج', 'makeup'], 20, 5, 3],
      ['تركيب رموش', 'Lash Extensions', ['رموش', 'lashes'], 9, 2.5, 6],
      ['تدليك استرخاء', 'Relaxation Massage', ['مساج', 'massage'], 14, 4, 4],
    ],
  },
  food: {
    ar: 'كافيه الزاوية', en: 'Corner Café', phone: '+97336005008',
    items: [
      ['قهوة عربية (دلة)', 'Arabic Coffee (pot)', ['قهوة عربية', 'قهوة', 'arabic coffee', 'coffee'], 4, 1.2, 20],
      ['لاتيه مثلج', 'Iced Latte', ['لاتيه', 'latte'], 1.8, 0.7, 30],
      ['صينية معجنات مشكلة', 'Assorted Pastry Tray', ['معجنات', 'pastry tray', 'pastry'], 9, 3.5, 6],
      ['صينية كنافة', 'Kunafa Tray', ['صينية كنافة', 'كنافة', 'kunafa tray', 'kunafa'], 8, 3.2, 6],
      ['ساندويش دجاج مشوي', 'Grilled Chicken Sandwich', ['ساندويش', 'sandwich'], 2.5, 1, 25],
      ['سلطة سيزر', 'Caesar Salad', ['سلطة', 'salad'], 3, 1.2, 15],
      ['طبق كبسة (كبير)', 'Kabsa Platter (large)', ['كبسة', 'kabsa'], 12, 5, 10],
      ['بوفيه كيترنق (للفرد)', 'Catering Buffet (per person)', ['كيترنق', 'بوفيه', 'catering', 'buffet'], 6, 2.5, 50],
      ['عصير طبيعي', 'Fresh Juice', ['عصير', 'juice'], 1.5, 0.5, 30],
      ['كروسان جبن', 'Cheese Croissant', ['كروسان', 'croissant'], 1.2, 0.4, 25],
      ['طبق تمر وقهوة للضيافة', 'Dates & Coffee Hospitality Set', ['ضيافة', 'hospitality'], 5, 2, 15],
      ['كيك تمر بالعسل', 'Date & Honey Cake', ['كيك تمر', 'date cake'], 4.5, 1.8, 10],
    ],
  },
  foodTruck: {
    ar: 'عربة زاد', en: 'Zad Food Truck', phone: '+97336005009',
    items: [
      ['كرك حليب', 'Karak Tea', ['كرك', 'شاي كرك', 'karak'], 0.3, 0.1, 150],
      ['شاي زعفران', 'Saffron Tea', ['زعفران', 'saffron'], 0.4, 0.15, 80],
      ['برجر لحم', 'Beef Burger', ['برجر لحم', 'برجر', 'beef burger', 'burger'], 1.8, 0.8, 40],
      ['برجر دجاج كرسبي', 'Crispy Chicken Burger', ['برجر دجاج', 'كرسبي', 'chicken burger'], 1.6, 0.7, 40],
      ['تشيز فرايز', 'Cheese Fries', ['فرايز', 'بطاطس', 'fries'], 1, 0.35, 60],
      ['هوت دوغ', 'Hot Dog', ['هوت دوق', 'hot dog'], 1.2, 0.5, 40],
      ['ساندويش شاورما', 'Shawarma Sandwich', ['شاورما', 'shawarma'], 0.8, 0.35, 60],
      ['باستا ألفريدو', 'Alfredo Pasta', ['باستا', 'الفريدو', 'pasta'], 2, 0.9, 25],
      ['موهيتو', 'Mojito', ['موهيتو فراولة', 'mojito'], 1.2, 0.4, 50],
      ['آيس كرم (كوب)', 'Ice Cream Cup', ['آيس كريم', 'ايس كريم', 'ice cream'], 0.8, 0.3, 40],
      ['كرواسون زعتر', 'Zaatar Croissant', ['كرواسون', 'croissant'], 0.6, 0.25, 40],
      ['وجبة كومبو (برجر + فرايز + مشروب)', 'Combo Meal (burger, fries, drink)', ['كومبو', 'وجبة', 'combo'], 2.8, 1.2, 30],
    ],
  },
};
DEMO_CATALOGS.other = DEMO_CATALOGS.shop;

const DEMO_PEOPLE = [
  ['فاطمة العلي', 'Fatima Al-Ali', '+97333001001', 'muharraq'],
  ['نورة أحمد', 'Noora Ahmed', '+97333001002', 'riffa'],
  ['مريم خالد', 'Maryam Khalid', '+97333001003', 'hamadTown'],
  ['سارة عبدالله', 'Sara Abdulla', '+97333001004', 'isaTown'],
  ['هند سلمان', 'Hind Salman', '+97333001005', 'sitra'],
  ['عائشة يوسف', 'Aisha Yousif', '+97333001006', 'budaiya'],
  ['زينب محمد', 'Zainab Mohamed', '+97333001007', 'muharraq'],
  ['دانة إبراهيم', 'Dana Ebrahim', '+97333001008', 'riffa'],
  ['لولوة حسن', 'Lulwa Hasan', '+97333001009', 'hamadTown'],
  ['أمل جعفر', 'Amal Jaffar', '+97333001010', 'isaTown'],
  ['وداد كريم', 'Widad Kareem', '+97333001011', 'sitra'],
  ['شيخة علي', 'Shaikha Ali', '+97333001012', 'budaiya'],
];

const DEMO_EXPENSES = [
  [20, 'ingredients', 18.5, 'Flour, sugar & dairy run', 'مشتريات طحين وسكر وألبان'],
  [18, 'packaging', 6.2, 'Boxes & ribbons', 'علب وشرائط'],
  [16, 'ads', 10, 'Instagram boost', 'إعلان ممول على إنستغرام'],
  [14, 'ingredients', 22, 'Chocolate & nuts', 'شوكولاتة ومكسرات'],
  [12, 'delivery', 4, 'Fuel', 'بنزين'],
  [10, 'equipment', 45, 'Stand mixer attachment', 'ملحق للعجانة'],
  [9, 'packaging', 5.5, 'Cake boxes (large)', 'علب كيك (كبيرة)'],
  [7, 'ingredients', 19.5, 'Weekly grocery run', 'مشتريات الأسبوع'],
  [5, 'delivery', 3.5, 'Talabat delivery fees', 'رسوم توصيل طلبات'],
  [3, 'ads', 8, 'TikTok promotion', 'إعلان تيك توك'],
  [2, 'other', 3, 'Propane refill', 'تعبئة غاز'],
  [1, 'ingredients', 21, 'Weekly grocery run', 'مشتريات الأسبوع'],
];

// Approximate Gregorian dates for Eid al-Fitr, so the demo's own occasions always sit in the future.
const EID_AL_FITR = ['2027-03-10', '2028-02-27', '2029-02-15', '2030-02-05', '2031-01-25'];

function demoId() { return Math.random().toString(36).slice(2, 10); }

function makeDemoData(businessType, now = new Date()) {
  const cat = DEMO_CATALOGS[businessType] || DEMO_CATALOGS.home;
  const tracksStock = businessType !== 'services';
  const products = cat.items.map(([nameAr, nameEn, aliases, price, cost, cap], i) => ({
    id: demoId(), nameAr, nameEn, aliases, price, cost, cap, active: true,
    // A few tracked items, one of them already low, so Today's low-stock card has something to show.
    track: tracksStock && i < 4, qty: [14, 3, 9, 22][i] ?? 0, low: 4,
  }));
  const customers = DEMO_PEOPLE.map(([name, nameEn, phone, area]) => ({ id: demoId(), name, nameEn, phone, area, notes: '' }));

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hours = [16, 17, 17, 18, 19, 19], minutes = [0, 0, 30, 0, 0, 30];
  const methods = ['benefit', 'cash', 'transfer', 'card'];
  const orders = [];
  for (let i = 0; i < 40; i++) {
    const dayOffset = -21 + Math.floor((i * 28) / 40);
    const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hours[i % 6], minutes[i % 6]);
    const customer = customers[i % customers.length];
    const items = [];
    for (let j = 0; j < 1 + (i % 3); j++) {
      const p = products[(i + j * 5) % products.length];
      items.push({ pid: p.id, nameAr: p.nameAr, nameEn: p.nameEn, qty: 1 + ((i + j) % 3), price: p.price, cost: p.cost });
    }
    const delivery = i % 3 === 0;
    const order = {
      id: demoId(), no: i + 1, customerId: customer.id, dueAt: due.toISOString(), items,
      fulfillment: delivery ? 'delivery' : 'pickup', area: delivery ? customer.area : '', deliveryFee: delivery ? 1 : 0,
      source: i % 5 === 0 ? 'link' : i % 4 === 0 ? 'instagram' : 'whatsapp',
      payments: [], notes: '', changes: [{ kind: 'created', at: due.toISOString() }], status: 'new', stockApplied: false,
    };
    const isPast = dayOffset < 0, isToday = dayOffset === 0;
    if (isPast) order.status = i % 9 === 0 ? 'cancelled' : 'collected';
    else if (isToday) order.status = ['ready', 'confirmed', 'new'][i % 3];
    else order.status = i % 2 === 0 ? 'confirmed' : 'new';
    // Today's ready delivery order has gone out for delivery, the step between Ready and Delivered.
    if (isToday && delivery && order.status === 'ready') {
      order.outForDeliveryAt = new Date(now.getTime() - 10 * 60000).toISOString();
      order.changes.push({ kind: 'outForDelivery', value: order.outForDeliveryAt, at: order.outForDeliveryAt });
    }

    if (order.status !== 'cancelled') {
      const total = items.reduce((s, it) => s + it.qty * it.price, 0) + order.deliveryFee;
      const method = methods[i % 4];
      let amount = 0, note = '';
      if (isPast && i % 13 === 0) amount = 0; // collected on credit
      else if (isPast && i % 7 === 0) { amount = Math.round(total * 500) / 1000; note = 'Deposit only'; }
      else if (isPast) amount = total;
      else if (i % 4 === 0) { amount = Math.round(total * 300) / 1000; note = 'Deposit to confirm'; }
      // Payments have ids, like the phones', so deleting one can remember its id (removedPaymentIds).
      if (amount > 0) order.payments.push({ id: demoId(), amount, method, note, at: (isPast ? due : now).toISOString() });
    }
    orders.push(order);
  }

  const expenses = DEMO_EXPENSES.map(([daysAgo, category, amount, en, ar]) => ({
    id: demoId(), category, amount, note: { en, ar },
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, 10).toISOString(),
  }));

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayKey = iso(today);
  const nationalYear = iso(new Date(today.getFullYear(), 11, 17)) >= todayKey ? today.getFullYear() : today.getFullYear() + 1;
  const eid = EID_AL_FITR.find(d => d >= todayKey) || EID_AL_FITR[EID_AL_FITR.length - 1];
  const eidEnd = new Date(`${eid}T00:00`); eidEnd.setDate(eidEnd.getDate() + 2);
  const occasions = [
    { id: demoId(), kind: 'bahrainNationalDay', nameAr: 'اليوم الوطني البحريني', nameEn: 'Bahrain National Day', start: `${nationalYear}-12-16`, end: `${nationalYear}-12-17`, cap: 60, blocked: false },
    { id: demoId(), kind: 'eidAlFitr', nameAr: 'عيد الفطر', nameEn: 'Eid al-Fitr', start: eid, end: iso(eidEnd), cap: 60, blocked: false },
  ];

  // Two orders waiting in the shop-link inbox, as if customers had just ordered from the public page:
  // one to pick up, one for delivery (added with the shop's default delivery fee).
  const at = (days, h, m) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, h, m).toISOString();
  const webOrders = [
    { id: demoId(), name: 'ريم سعيد', nameEn: 'Reem Saeed', phone: '+97333001099', dueAt: at(1, 17, 0), items: [{ pid: products[1].id, qty: 2 }, { pid: products[4].id, qty: 1 }] },
    {
      id: demoId(), name: 'حصة جاسم', nameEn: 'Hessa Jasim', phone: '+97333001098', dueAt: at(2, 18, 30), items: [{ pid: products[2].id, qty: 1 }],
      fulfillment: 'delivery', area: 'riffa', address: 'House 12, Road 3510, Block 935',
    },
  ];

  return {
    isDemo: true,
    shop: { nameAr: cat.ar, nameEn: cat.en, phone: cat.phone, currency: 'BHD', pickupHours: '4:00 PM - 8:00 PM', dailyCapacity: 35, businessType },
    products, customers, orders, expenses, occasions, webOrders,
    vat: { enabled: true, trn: '220012345600003', pricesInclude: true },
    // The default delivery fee, in minor units like the phones' setting/deliveryDefaults: 1.000 BHD.
    deliveryDefaults: { feeMinor: 1000 },
    stockEnabled: tracksStock,
    askEnabled: true,
    hiddenCampaigns: [],
    shopLink: { slug: '', bio: '', leadDays: 1, delivery: 'both', acceptsWebOrders: true, showAll: true, published: false },
    cloud: { signedIn: false, email: '', lastSynced: null, invite: null, team: [
      { id: demoId(), name: 'مريم', nameEn: 'Maryam', perms: { orders: true, prepare: true, money: false, products: false } },
      { id: demoId(), name: 'أحمد', nameEn: 'Ahmed', perms: { orders: false, prepare: true, money: false, products: false } },
    ] },
    nextOrderNo: 41,
  };
}
