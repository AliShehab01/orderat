import { describe, expect, it } from "vitest";
import { collectSnapshotRefs, validateActions } from "./actions.ts";

const SNAPSHOT = {
  topCustomers: [{ ref: "c12", firstName: "Sara" }],
  unpaid: [{ ref: "c7", firstName: "Noor", orderRef: "o33", amountMinor: 4500 }],
  upcoming: [{ orderRef: "o40", firstName: "Layla" }],
};

describe("collectSnapshotRefs", () => {
  it("collects customer refs from topCustomers and unpaid", () => {
    const refs = collectSnapshotRefs(SNAPSHOT);
    expect(refs.customerRefs).toEqual(new Set(["c12", "c7"]));
  });

  it("collects order refs from unpaid and upcoming", () => {
    const refs = collectSnapshotRefs(SNAPSHOT);
    expect(refs.orderRefs).toEqual(new Set(["o33", "o40"]));
  });

  it("returns empty sets for a missing, non-object, or malformed snapshot", () => {
    expect(collectSnapshotRefs(undefined)).toEqual({ customerRefs: new Set(), orderRefs: new Set() });
    expect(collectSnapshotRefs(null)).toEqual({ customerRefs: new Set(), orderRefs: new Set() });
    expect(collectSnapshotRefs("nope")).toEqual({ customerRefs: new Set(), orderRefs: new Set() });
    expect(collectSnapshotRefs({ topCustomers: "not an array", unpaid: [{ ref: 5 }] })).toEqual({
      customerRefs: new Set(),
      orderRefs: new Set(),
    });
  });
});

describe("validateActions", () => {
  const refs = collectSnapshotRefs(SNAPSHOT);

  it("keeps a send_reminders action whose customerRefs all exist in the snapshot", () => {
    const actions = validateActions([{ type: "send_reminders", customerRefs: ["c12", "c7"] }], refs);
    expect(actions).toEqual([{ type: "send_reminders", customerRefs: ["c12", "c7"] }]);
  });

  it("drops refs that don't exist in the snapshot but keeps the ones that do", () => {
    const actions = validateActions([{ type: "send_reminders", customerRefs: ["c12", "made-up"] }], refs);
    expect(actions).toEqual([{ type: "send_reminders", customerRefs: ["c12"] }]);
  });

  it("drops a send_reminders action whose refs are all invented", () => {
    expect(validateActions([{ type: "send_reminders", customerRefs: ["made-up"] }], refs)).toEqual([]);
  });

  it("keeps a well-formed add_expense action", () => {
    const actions = validateActions([{ type: "add_expense", amountMinor: 5000, category: "ingredients", note: "طحين" }], refs);
    expect(actions).toEqual([{ type: "add_expense", amountMinor: 5000, category: "ingredients", note: "طحين" }]);
  });

  it("keeps add_expense without a note, since note is optional", () => {
    const actions = validateActions([{ type: "add_expense", amountMinor: 100, category: "other" }], refs);
    expect(actions).toEqual([{ type: "add_expense", amountMinor: 100, category: "other" }]);
  });

  it("drops add_expense with a category outside the allowed list", () => {
    expect(validateActions([{ type: "add_expense", amountMinor: 100, category: "salary" }], refs)).toEqual([]);
  });

  for (const badAmount of [0, -5, 1.5, "100", null, undefined]) {
    it(`drops add_expense with a non-positive-integer amountMinor (${JSON.stringify(badAmount)})`, () => {
      expect(validateActions([{ type: "add_expense", amountMinor: badAmount, category: "ingredients" }], refs)).toEqual([]);
    });
  }

  it("keeps a draft_caption action with non-empty text", () => {
    const actions = validateActions([{ type: "draft_caption", text: "عرض اليوم!" }], refs);
    expect(actions).toEqual([{ type: "draft_caption", text: "عرض اليوم!" }]);
  });

  it("drops a draft_caption action with empty or missing text", () => {
    expect(validateActions([{ type: "draft_caption", text: "" }], refs)).toEqual([]);
    expect(validateActions([{ type: "draft_caption", text: "   " }], refs)).toEqual([]);
    expect(validateActions([{ type: "draft_caption" }], refs)).toEqual([]);
  });

  it("keeps an open_order action whose orderRef exists in the snapshot", () => {
    expect(validateActions([{ type: "open_order", orderRef: "o33" }], refs)).toEqual([{ type: "open_order", orderRef: "o33" }]);
  });

  it("drops an open_order action whose orderRef is invented", () => {
    expect(validateActions([{ type: "open_order", orderRef: "made-up" }], refs)).toEqual([]);
  });

  it("drops an action with an unknown type", () => {
    expect(validateActions([{ type: "delete_everything" }], refs)).toEqual([]);
  });

  it("drops non-object entries and a non-array actions value entirely", () => {
    expect(validateActions([null, "x", 5], refs)).toEqual([]);
    expect(validateActions("not an array", refs)).toEqual([]);
    expect(validateActions(undefined, refs)).toEqual([]);
  });

  it("keeps only the valid actions out of a mixed list, in order", () => {
    const actions = validateActions(
      [
        { type: "open_order", orderRef: "made-up" },
        { type: "draft_caption", text: "Eid special!" },
        { type: "add_expense", amountMinor: -1, category: "ingredients" },
        { type: "send_reminders", customerRefs: ["c12"] },
      ],
      refs,
    );
    expect(actions).toEqual([
      { type: "draft_caption", text: "Eid special!" },
      { type: "send_reminders", customerRefs: ["c12"] },
    ]);
  });
});
