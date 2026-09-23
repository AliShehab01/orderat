import { describe, expect, it } from "vitest";
import { demoProducts, findChangeCandidate } from "./plan";
import type { Draft, Order } from "./types";

const NOW = new Date("2026-09-21T06:00:00Z");

function order(items: Order["items"]): Order {
  return { id: "o1", customerName: "Sara", items, collectionAt: "2026-09-26T07:00:00.000Z", status: "pending", changes: [], createdAt: NOW.toISOString() };
}

function draft(items: Draft["items"], oldQuantities: number[] = []): Draft {
  return { customerName: "Sara", customerConfidence: "high", items, collectionConfidence: "low", oldQuantities };
}

describe("findChangeCandidate", () => {
  it("uses the replaced quantity to find the item when the named product is not in the order", () => {
    // "خليها 35 كب مو 20": the AI may map "كب" (cup) to the wrong cup product.
    const o = order([{ productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 20 }]);
    const c = findChangeCandidate(draft([{ productId: "p-cupcake", rawText: "كب", quantity: 35, confidence: "high" }], [20]), [o], demoProducts(), NOW);
    expect(c?.items).toEqual([{ productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 35 }]);
  });

  it("adds a new product when nothing in the order matches", () => {
    const o = order([{ productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 20 }]);
    const c = findChangeCandidate(draft([{ productId: "p-brownie", rawText: "براونيز", quantity: 5, confidence: "high" }]), [o], demoProducts(), NOW);
    expect(c?.items).toHaveLength(2);
    expect(c?.items[1]).toMatchObject({ productId: "p-brownie", quantity: 5 });
  });

  it("updates the matching product directly", () => {
    const o = order([{ productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 20 }, { productId: "p-brownie", rawText: "براونيز", quantity: 2 }]);
    const c = findChangeCandidate(draft([{ productId: "p-brownie", rawText: "براونيز", quantity: 4, confidence: "high" }]), [o], demoProducts(), NOW);
    expect(c?.items.map((i) => i.quantity)).toEqual([20, 4]);
  });

  it("adds a new line instead of hijacking an unrelated item when the draft names a specific product not in the order", () => {
    // The AI correctly identified "معمول" (maamoul) — that is not a generic word like "كب" that
    // could be a mistranslated match, so the oldQuantities fallback must not steal Brownie box's
    // quantity just because it happens to equal 5.
    const o = order([{ productId: "p-brownie", rawText: "براونيز", quantity: 5 }, { productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 10 }]);
    const c = findChangeCandidate(draft([{ productId: "p-maamoul", rawText: "معمول", quantity: 6, confidence: "high" }], [5]), [o], demoProducts(), NOW);
    expect(c?.items).toEqual([
      { productId: "p-brownie", rawText: "براونيز", quantity: 5 },
      { productId: "p-cheesecake", rawText: "تشيز كيك كب", quantity: 10 },
      { productId: "p-maamoul", rawText: "معمول", quantity: 6 },
    ]);
  });
});
