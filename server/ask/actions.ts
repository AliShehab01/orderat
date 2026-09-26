// Action validation for "Ask Orderat" (docs/ask-orderat.md). Gemini's answer suggests actions the
// app can offer the seller as confirm-to-run cards; since the model can hallucinate a ref or a
// malformed field, every action is re-checked here against the allowed types and the snapshot the
// app actually sent. An invalid action is dropped, never treated as a reason to fail the whole
// answer (the spec: "Actions are suggestions only").

export const EXPENSE_CATEGORIES = ["ingredients", "packaging", "delivery", "ads", "tools", "rent", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface SendRemindersAction {
  type: "send_reminders";
  customerRefs: string[];
}

export interface AddExpenseAction {
  type: "add_expense";
  amountMinor: number;
  category: ExpenseCategory;
  note?: string;
}

export interface DraftCaptionAction {
  type: "draft_caption";
  text: string;
}

export interface OpenOrderAction {
  type: "open_order";
  orderRef: string;
}

export type AskAction = SendRemindersAction | AddExpenseAction | DraftCaptionAction | OpenOrderAction;

export interface SnapshotRefs {
  customerRefs: Set<string>;
  orderRefs: Set<string>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(entry: unknown, key: string): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Every ref the snapshot actually contains, read defensively (docs/ask-orderat.md's shape assumed,
 * but a missing or malformed field is just skipped rather than thrown — a bad snapshot should never
 * crash the request, only make ref-checked actions fail their check below and get dropped).
 * `topCustomers` and `unpaid` both carry customer refs; `unpaid` and `upcoming` both carry order refs.
 */
export function collectSnapshotRefs(snapshot: unknown): SnapshotRefs {
  const customerRefs = new Set<string>();
  const orderRefs = new Set<string>();
  if (typeof snapshot !== "object" || snapshot === null) return { customerRefs, orderRefs };
  const s = snapshot as Record<string, unknown>;

  for (const entry of asArray(s.topCustomers)) {
    const ref = stringField(entry, "ref");
    if (ref) customerRefs.add(ref);
  }
  for (const entry of asArray(s.unpaid)) {
    const ref = stringField(entry, "ref");
    if (ref) customerRefs.add(ref);
    const orderRef = stringField(entry, "orderRef");
    if (orderRef) orderRefs.add(orderRef);
  }
  for (const entry of asArray(s.upcoming)) {
    const orderRef = stringField(entry, "orderRef");
    if (orderRef) orderRefs.add(orderRef);
  }
  return { customerRefs, orderRefs };
}

function isPositiveIntegerAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Keeps only the actions that are well-formed for their `type` and whose refs exist in the
 * snapshot's own refs (`refs`, from collectSnapshotRefs); every other action — an unknown type, a
 * missing/wrong-typed field, an invented ref — is silently dropped rather than failing the answer.
 */
export function validateActions(rawActions: unknown, refs: SnapshotRefs): AskAction[] {
  const out: AskAction[] = [];
  for (const item of asArray(rawActions)) {
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    switch (a.type) {
      case "send_reminders": {
        if (!Array.isArray(a.customerRefs)) break;
        const customerRefs = a.customerRefs.filter((ref): ref is string => typeof ref === "string" && refs.customerRefs.has(ref));
        if (customerRefs.length > 0) out.push({ type: "send_reminders", customerRefs });
        break;
      }
      case "add_expense": {
        if (!isPositiveIntegerAmount(a.amountMinor) || !isExpenseCategory(a.category)) break;
        const note = typeof a.note === "string" && a.note.trim() ? a.note.trim().slice(0, 200) : undefined;
        out.push({ type: "add_expense", amountMinor: a.amountMinor, category: a.category, ...(note ? { note } : {}) });
        break;
      }
      case "draft_caption": {
        if (typeof a.text === "string" && a.text.trim()) out.push({ type: "draft_caption", text: a.text.trim().slice(0, 2000) });
        break;
      }
      case "open_order": {
        if (typeof a.orderRef === "string" && refs.orderRefs.has(a.orderRef)) out.push({ type: "open_order", orderRef: a.orderRef });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
