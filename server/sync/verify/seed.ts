// A realistic shop built the way the released iOS 1.0 builds one: offline first, through its own local operations (so every
// stock move, payment and history entry is the one Store.swift writes), then uploaded. Orders in every status, payments of
// every kind, products with stock (one with a move list that has hit the 50 cap), untracked products, and deleted records.

import { SimPhone } from "./phone.ts";

export interface SeededShop {
  customers: string[];
  products: { cake: string; cookie: string; tart: string; box: string; busy: string; free: string };
  orders: Record<string, string>;
}

/** Fills `phone` (not attached to the cloud yet) with the shop; the shop record is created with the id the fleet uses. */
export function seedLocalShop(phone: SimPhone): SeededShop {
  const shopId = phone.fleet.shopId;
  phone.createShop(shopId);
  const customers = Array.from({ length: 12 }, (_, i) => phone.createCustomer(`Customer ${i + 1}`, `+9733300${String(100 + i)}`));

  const cake = phone.createProduct({ name: "Chocolate cake", priceMinor: 6500, costMinor: 2500, track: true, stock: 40, low: 5 });
  const cookie = phone.createProduct({ name: "Cookies box", priceMinor: 2500, costMinor: 900, track: true, stock: 100, low: 10 });
  const tart = phone.createProduct({ name: "Lemon tart", priceMinor: 4000, costMinor: 1500, track: true, stock: 25, low: 3 });
  const box = phone.createProduct({ name: "Gift box", priceMinor: 1500, costMinor: 500, track: false, stock: 0 });
  const busy = phone.createProduct({ name: "Brownie", priceMinor: 1200, costMinor: 400, track: true, stock: 200, low: 20 });
  const free = phone.createProduct({ name: "Delivery bag", priceMinor: 100, track: false });

  // A busy product: more than 50 manual and order moves, so its list is at the cap.
  for (let i = 0; i < 40; i++) phone.adjustStockManually(busy, i % 2 === 0 ? 10 : -5, i % 2 === 0 ? "received" : "damaged", `batch ${i}`);

  const orders: Record<string, string> = {};
  const line = (productId: string | null, name: string, qty: number, priceMinor: number) => ({ productId, name, qty, priceMinor });

  // new, untouched
  orders.fresh = phone.createOrder({ customerId: customers[0]!, lines: [line(cake, "Chocolate cake", 2, 6500)] });
  // confirmed, deposit paid
  orders.confirmedDeposit = phone.createOrder({ customerId: customers[1]!, lines: [line(cake, "Chocolate cake", 3, 6500), line(box, "Gift box", 3, 1500)] });
  phone.setStatus(orders.confirmedDeposit, "confirmed");
  phone.recordPayment(orders.confirmedDeposit, 5000, "benefit");
  // ready, fully paid by two payments
  orders.readyPaid = phone.createOrder({ customerId: customers[2]!, lines: [line(cookie, "Cookies box", 4, 2500), line(tart, "Lemon tart", 1, 4000)] });
  phone.setStatus(orders.readyPaid, "confirmed");
  phone.setStatus(orders.readyPaid, "ready");
  phone.recordPayment(orders.readyPaid, 7000);
  phone.recordPayment(orders.readyPaid, 7000, "transfer", "rest");
  // collected, paid, then a payment removed
  orders.collected = phone.createOrder({ customerId: customers[3]!, lines: [line(tart, "Lemon tart", 2, 4000)] });
  phone.setStatus(orders.collected, "confirmed");
  phone.setStatus(orders.collected, "collected");
  const wrong = phone.recordPayment(orders.collected, 900);
  phone.recordPayment(orders.collected, 8000);
  phone.removePayment(orders.collected, wrong);
  // confirmed then cancelled: the stock came back
  orders.cancelled = phone.createOrder({ customerId: customers[4]!, lines: [line(cake, "Chocolate cake", 5, 6500)] });
  phone.setStatus(orders.cancelled, "confirmed");
  phone.recordPayment(orders.cancelled, 2000);
  phone.setStatus(orders.cancelled, "cancelled");
  // confirmed, items edited up and down (orderEdited moves)
  orders.edited = phone.createOrder({ customerId: customers[5]!, lines: [line(cookie, "Cookies box", 2, 2500), line(cake, "Chocolate cake", 1, 6500)] });
  phone.setStatus(orders.edited, "confirmed");
  phone.editItems(orders.edited, [{ productId: cookie, name: "Cookies box", qty: 5, priceMinor: 2500 }, { productId: tart, name: "Lemon tart", qty: 1, priceMinor: 4000 }]);
  // an order on the busy product (its move list is full)
  orders.busyOrder = phone.createOrder({ customerId: customers[6]!, lines: [line(busy, "Brownie", 12, 1200)] });
  phone.setStatus(orders.busyOrder, "confirmed");
  // many more small orders of every status, same amounts on purpose
  for (let i = 0; i < 30; i++) {
    const id = phone.createOrder({ customerId: customers[i % customers.length]!, lines: [line([cake, cookie, tart, busy][i % 4]!, "Item", 1 + (i % 3), 2000 + (i % 4) * 500), line(free, "Delivery bag", 1, 100)] });
    orders[`bulk${i}`] = id;
    if (i % 5 !== 0) phone.setStatus(id, "confirmed");
    if (i % 5 === 2) phone.setStatus(id, "ready");
    if (i % 5 === 3) phone.setStatus(id, "collected");
    if (i % 5 === 4) phone.setStatus(id, "cancelled");
    if (i % 3 === 0) phone.recordPayment(id, 1000);
    if (i % 6 === 0) phone.recordPayment(id, 1000); // two payments of the same amount
  }

  // expenses and occasions (iOS expensePatch / occasionPatch)
  for (let i = 0; i < 3; i++) {
    const id = phone.newId();
    phone.records.set(`expense:${id}`, { entity: "expense", id, data: { amountMinor: 1500 + i * 500, category: "ingredients", note: `flour ${i}`, receiptPhotoId: null, recurring: false, date: phone.now(), createdAt: phone.now() } });
  }
  for (let i = 0; i < 2; i++) {
    const id = phone.newId();
    phone.records.set(`occasion:${id}`, { entity: "occasion", id, data: { kind: "custom", nameAr: "عيد", nameEn: "Eid", startDate: phone.now(), endDate: phone.now(), preOrderOpensAt: null, dailyCapacityOverride: null, blocked: false, notes: null } });
  }

  // the owner's reports and a template, as iOS writes them
  phone.records.set("setting:subscription", { entity: "setting", id: "subscription", data: { value: { status: "active", expiresAt: null, platform: "ios", reporter: "reporter-1", updatedAt: phone.now() } } });
  phone.records.set("setting:whatsappTemplates", { entity: "setting", id: "whatsappTemplates", data: { value: { "orderConfirmed.ar": "تم تأكيد طلبك" } } });
  return { customers, products: { cake, cookie, tart, box, busy, free }, orders };
}
