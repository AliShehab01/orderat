import type { Draft, Order, OrderItem, Product } from "./types";
import { normalizeName, nextWeekday } from "./parser";

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const keyOf = (iso: string) => dateKey(new Date(iso));

export interface Diff { label: string; oldValue: string; newValue: string }
export interface ChangeCandidate { order: Order; diffs: Diff[]; items: OrderItem[]; collectionAt?: string }

export function findChangeCandidate(draft: Draft, orders: Order[], products: Product[], now = new Date()): ChangeCandidate | null {
  if (!draft.customerName) return null;
  const name = normalizeName(draft.customerName);
  const cutoff = now.getTime() - 14 * 86400000;
  const order = orders
    .filter((o) => o.status !== "collected" && new Date(o.createdAt).getTime() >= cutoff)
    .filter((o) => { const n = normalizeName(o.customerName); return n === name || n.startsWith(name) || name.startsWith(n); })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!order) return null;
  const items = order.items.map((i) => ({ ...i }));
  const diffs: Diff[] = [];
  const label = (id?: string) => products.find((p) => p.id === id)?.name ?? "item";
  for (const d of draft.items) {
    if (d.quantity === undefined) continue;
    const target = d.productId
      ? items.find((i) => i.productId === d.productId)
      : items.find((i) => draft.oldQuantities.includes(i.quantity)) ?? (items.length === 1 ? items[0] : undefined);
    if (target) {
      if (target.quantity !== d.quantity) { diffs.push({ label: label(target.productId), oldValue: String(target.quantity), newValue: String(d.quantity) }); target.quantity = d.quantity; }
    } else if (d.productId) {
      items.push({ productId: d.productId, rawText: d.rawText, quantity: d.quantity });
      diffs.push({ label: label(d.productId), oldValue: "0", newValue: String(d.quantity) });
    }
  }
  let collectionAt = order.collectionAt;
  if (draft.collectionAt && draft.collectionConfidence === "high" && draft.collectionAt !== order.collectionAt) {
    diffs.push({ label: "time", oldValue: order.collectionAt ?? "-", newValue: draft.collectionAt });
    collectionAt = draft.collectionAt;
  }
  return diffs.length ? { order, diffs, items, collectionAt } : null;
}

export interface DayPlan {
  dateKey: string;
  totals: { productId: string; name: string; nameAr: string; ordered: number; toPrepare: number; batches?: number; batchSize?: number }[];
  packaging: { name: string; qty: number }[];
  slots: { time: string; orders: { id: string; customerName: string; status: string; notes?: string; lines: { name: string; quantity: number }[] }[] }[];
  unitsTotal: number;
  overCapacity: boolean;
  noTime: Order[];
}

export function buildDayPlan(orders: Order[], products: Product[], key: string, capacity: number, locale: "ar" | "en"): DayPlan {
  const active = orders.filter((o) => o.status !== "collected");
  const noTime = active.filter((o) => !o.collectionAt);
  const day = active.filter((o) => o.collectionAt && keyOf(o.collectionAt) === key);
  const totals = new Map<string, DayPlan["totals"][number]>();
  const pack = new Map<string, number>();
  const slots = new Map<string, DayPlan["slots"][number]>();
  let unitsTotal = 0;
  for (const o of day) {
    const slot = slots.get(o.collectionAt!) ?? { time: o.collectionAt!, orders: [] };
    slots.set(o.collectionAt!, slot);
    const lines: { name: string; quantity: number }[] = [];
    for (const it of o.items) {
      const p = products.find((x) => x.id === it.productId);
      if (!p) { lines.push({ name: it.rawText, quantity: it.quantity }); continue; }
      lines.push({ name: locale === "ar" ? p.nameAr : p.name, quantity: it.quantity });
      unitsTotal += it.quantity;
      const t = totals.get(p.id) ?? { productId: p.id, name: p.name, nameAr: p.nameAr, ordered: 0, toPrepare: 0, batchSize: p.batchSize };
      t.ordered += it.quantity; totals.set(p.id, t);
      for (const pk of p.packaging) pack.set(pk.name, (pack.get(pk.name) ?? 0) + it.quantity * pk.qtyPerUnit);
    }
    slot.orders.push({ id: o.id, customerName: o.customerName, status: o.status, notes: o.notes, lines });
  }
  return {
    dateKey: key,
    totals: [...totals.values()].map((t) => { if (t.batchSize) { t.batches = Math.ceil(t.ordered / t.batchSize); t.toPrepare = t.batches * t.batchSize; } else t.toPrepare = t.ordered; return t; }).sort((a, b) => b.ordered - a.ordered),
    packaging: [...pack.entries()].map(([name, q]) => ({ name, qty: Math.ceil(q) })),
    slots: [...slots.values()].sort((a, b) => a.time.localeCompare(b.time)),
    unitsTotal, overCapacity: capacity > 0 && unitsTotal > capacity, noTime,
  };
}

export function demoProducts(): Product[] {
  return [
    { id: "p-cheesecake", name: "Cheesecake cup", nameAr: "تشيز كيك كب", aliases: ["cheesecake cups", "cup cheesecake", "cheesecake", "cheese cake", "تشيز كيك", "تشيزكيك", "تشيز"], batchSize: 12, packaging: [{ name: "Cup + lid", qtyPerUnit: 1 }, { name: "Sticker", qtyPerUnit: 1 }] },
    { id: "p-brownie", name: "Brownie box", nameAr: "براونيز بوكس", aliases: ["brownie boxes", "brownies box", "brownies", "brownie", "براونيز", "براوني", "بوكس براونيز"], batchSize: 6, packaging: [{ name: "Box", qtyPerUnit: 1 }, { name: "Bag", qtyPerUnit: 1 }] },
    { id: "p-redvelvet", name: "Red velvet cup", nameAr: "ريد فلفت كب", aliases: ["red velvet cups", "red velvet", "ريد فلفت", "رد فلفت"], batchSize: 12, packaging: [{ name: "Cup + lid", qtyPerUnit: 1 }] },
    { id: "p-cupcake", name: "Vanilla cupcake", nameAr: "كب كيك فانيلا", aliases: ["vanilla cupcakes", "cupcake", "cupcakes", "كب كيك", "كبكيك"], batchSize: 12, packaging: [{ name: "Cupcake box of 6", qtyPerUnit: 1 / 6 }] },
    { id: "p-maamoul", name: "Maamoul box", nameAr: "معمول بوكس", aliases: ["maamoul", "mamoul", "معمول", "بوكس معمول"], batchSize: 10, packaging: [{ name: "Box", qtyPerUnit: 1 }] },
  ];
}

export function demoOrders(now = new Date()): Order[] {
  const at = (wd: number, h: number) => { const d = nextWeekday(now, wd); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const mk = (customerName: string, items: [string, number][], collectionAt?: string, notes?: string): Order => ({
    id: crypto.randomUUID(), customerName, items: items.map(([productId, quantity]) => ({ productId, rawText: productId, quantity })),
    collectionAt, notes, status: "confirmed", changes: [], createdAt: new Date(now.getTime() - 86400000).toISOString(),
  });
  return [
    mk("سارة", [["p-cheesecake", 20]], at(6, 10)),
    mk("Noor_bh", [["p-redvelvet", 15], ["p-cheesecake", 5]], at(4, 12)),
    mk("أم خالد", [["p-cupcake", 30], ["p-cheesecake", 12]], at(6, 18)),
    mk("Mona", [["p-brownie", 2], ["p-cheesecake", 3]], at(5, 17)),
    mk("Huda", [["p-maamoul", 4]], at(5, 11)),
    mk("Fatima", [["p-brownie", 5]], at(4, 16)),
    mk("أم يوسف", [["p-cupcake", 24]], at(6, 12), "بدون مكسرات"),
    mk("Zainab", [["p-cheesecake", 10]], at(6, 10)),
    mk("Ahmed", [["p-brownie", 3], ["p-redvelvet", 6]], at(5, 19)),
    mk("Layla", [["p-maamoul", 10]], at(6, 16)),
    mk("Reem", [["p-redvelvet", 12]], at(4, 18)),
    mk("Ali", [["p-cheesecake", 6]]),
  ];
}
