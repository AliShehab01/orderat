// Tester feedback, 1 Oct 2026, section 1: AI order entry picks up delivery and the address. The model's
// raw answer (its `fulfillment`, `address` and `deliveryNote`) is checked and tidied here before it
// reaches the apps, and the address never stays in the order's notes.

import { describe, expect, it } from "vitest";
import { stripDeliveryFromNotes, toDelivery } from "./delivery.ts";

describe("toDelivery", () => {
  it("an Arabic Bahrain address: area, block, road, building, Western digits for the numbers", () => {
    expect(toDelivery({
      fulfillment: "delivery",
      address: { area: " الرفاع ", block: "٩٣٥", road: "٣٥٢٤", building: "١٢", flat: null, city: null, text: "الرفاع مجمع ٩٣٥ طريق ٣٥٢٤ منزل ١٢" },
      deliveryNote: "اتصلوا لما توصلون",
    })).toEqual({
      fulfillment: "delivery",
      address: { area: "الرفاع", block: "935", road: "3524", building: "12", text: "الرفاع مجمع ٩٣٥ طريق ٣٥٢٤ منزل ١٢" },
      deliveryNote: "اتصلوا لما توصلون",
    });
  });

  it("an English Bahrain address with a flat", () => {
    expect(toDelivery({ fulfillment: "delivery", address: { area: "Juffair", block: "340", road: "4033", building: "1450", flat: "21" }, deliveryNote: "Black gate" })).toEqual({
      fulfillment: "delivery",
      address: { area: "Juffair", block: "340", road: "4033", building: "1450", flat: "21" },
      deliveryNote: "Black gate",
    });
  });

  it("a Saudi or UAE address that is only a free-text line (with its city)", () => {
    expect(toDelivery({ fulfillment: "delivery", address: { city: "الرياض", text: "حي العليا، شارع الملك فهد" }, deliveryNote: null })).toEqual({
      fulfillment: "delivery",
      address: { city: "الرياض", text: "حي العليا، شارع الملك فهد" },
      deliveryNote: null,
    });
    expect(toDelivery({ fulfillment: "delivery", address: { city: "Dubai", text: "Dubai Marina, Marina Gate 2, apt 1203" } })).toEqual({
      fulfillment: "delivery",
      address: { city: "Dubai", text: "Dubai Marina, Marina Gate 2, apt 1203" },
      deliveryNote: null,
    });
  });

  it("pickup, with no address", () => {
    expect(toDelivery({ fulfillment: "pickup", address: null, deliveryNote: null })).toEqual({ fulfillment: "pickup", address: null, deliveryNote: null });
  });

  it("an address without a stated fulfillment means delivery", () => {
    expect(toDelivery({ fulfillment: null, address: { text: "Saar, Road 15, House 7" } }).fulfillment).toBe("delivery");
  });

  it("nothing said about delivery: every key null (an old-style answer too)", () => {
    expect(toDelivery({})).toEqual({ fulfillment: null, address: null, deliveryNote: null });
    expect(toDelivery({ fulfillment: null, address: { area: "", text: "   " }, deliveryNote: " " })).toEqual({ fulfillment: null, address: null, deliveryNote: null });
  });

  it("drops anything malformed: an unknown fulfillment, a non-object address, non-string parts, overlong text", () => {
    expect(toDelivery({ fulfillment: "ship", address: "Riffa", deliveryNote: 5 })).toEqual({ fulfillment: null, address: null, deliveryNote: null });
    const long = "x".repeat(1000);
    const out = toDelivery({ fulfillment: "delivery", address: { area: 12, block: ["1"], text: long }, deliveryNote: long });
    expect(out.address).toEqual({ text: "x".repeat(300) });
    expect(out.deliveryNote).toBe("x".repeat(300));
  });
});

describe("stripDeliveryFromNotes", () => {
  it("removes the address line and its label from notes, keeping the real notes", () => {
    const delivery = toDelivery({ fulfillment: "delivery", address: { text: "الرفاع مجمع ٩٣٥ طريق ٣٥٢٤ منزل ١٢" }, deliveryNote: "اتصلوا لما توصلون" });
    expect(stripDeliveryFromNotes("بدون مكسرات\nالعنوان: الرفاع مجمع ٩٣٥ طريق ٣٥٢٤ منزل ١٢\nاتصلوا لما توصلون", delivery)).toBe("بدون مكسرات");
  });

  it("removes the sentence carrying the address, keeping the other sentences of the line", () => {
    const delivery = toDelivery({ fulfillment: "delivery", address: { text: "Dubai Marina, Marina Gate 2, apt 1203" } });
    expect(stripDeliveryFromNotes("Write 'Happy birthday' on top. Deliver to Dubai Marina, Marina Gate 2, apt 1203.", delivery)).toBe("Write 'Happy birthday' on top.");
  });

  it("removes an address that itself has full stops, wherever it sits", () => {
    const delivery = toDelivery({ fulfillment: "delivery", address: { text: "Bldg. 1450, Rd. 4033, Juffair" } });
    expect(stripDeliveryFromNotes("Less sugar, Bldg. 1450, Rd. 4033, Juffair", delivery)).toBe("Less sugar");
  });

  it("nothing left once the address is gone: no notes at all", () => {
    const delivery = toDelivery({ fulfillment: "delivery", address: { text: "Saar, Road 15, House 7" } });
    expect(stripDeliveryFromNotes("Address: Saar, Road 15, House 7", delivery)).toBeUndefined();
  });

  it("leaves notes alone when no address was extracted", () => {
    expect(stripDeliveryFromNotes("Less sugar", toDelivery({ fulfillment: "pickup" }))).toBe("Less sugar");
    expect(stripDeliveryFromNotes(undefined, toDelivery({}))).toBeUndefined();
  });
});
