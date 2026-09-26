# Ask Orderat (اسأل اوردرات): chat with your numbers

A chat screen where the seller asks about her business in Gulf Arabic or English and gets an answer
built from her own data. Shared spec for the backend (this repo), the iPhone app (orderat-ios) and
the Android app (orderat-app).

## Principles
- **The app does the math; the model only talks.** The phone computes a compact business snapshot
  (totals, lists) from its local data and sends it with the question. The model must answer from the
  snapshot only and never invent numbers.
- **Minimal data.** Customer first names only (no phone numbers, no addresses, no notes). Amounts in
  integer minor units (fils/halalas) with the currency code.
- **Opt-in.** The first time, a consent sheet explains that a summary of the shop's numbers is sent to
  Google Gemini to answer, and that phone numbers are never sent. A Settings toggle turns it off.
- **Paid feature.** Available during the free trial and to subscribers. In demo mode (sample data)
  the seller can ask up to 3 questions to try it; demo data is fake, so nothing personal leaves.
- **The API key never ships in the apps.** Apps call our Supabase Edge Function, which calls Gemini.

## API
`POST https://ckjmbdbvlbxfofjgqiuj.supabase.co/functions/v1/orderat-ask`
(headers: `apikey` and `Authorization: Bearer <anon key>` like the other orderat functions; JSON body)

Request:
```json
{
  "installId": "random UUID generated once per install, stored locally",
  "platform": "ios | android",
  "appVersion": "1.0.0",
  "lang": "ar | en",
  "demo": false,
  "question": "كم ربحت هالشهر؟",
  "history": [{ "role": "user | assistant", "text": "..." }],
  "snapshot": { "...": "see below" }
}
```
`history` holds at most the last 6 turns. `question` is 1-500 characters.

Response (200):
```json
{
  "answer": "ربحك هالشهر 240.500 د.ب ...",
  "actions": [
    { "type": "send_reminders", "customerRefs": ["c12", "c7"] },
    { "type": "add_expense", "amountMinor": 5000, "category": "ingredients", "note": "طحين" },
    { "type": "draft_caption", "text": "..." },
    { "type": "open_order", "orderRef": "o33" }
  ],
  "remainingToday": 27
}
```
Errors: 400 invalid body, 429 `{ "error": "daily_limit" }` (per install) or `{ "error": "busy" }`
(global daily budget reached), 502 `{ "error": "ai_unavailable" }`.

Actions are suggestions only. The app shows each one as a card with a confirm button and performs it
locally. Allowed `category` values for `add_expense`: ingredients, packaging, delivery, ads, tools,
rent, other.

## Snapshot (computed on the phone)
```json
{
  "today": "2026-09-26",
  "shopName": "Sweet Studio",
  "currency": "BHD",
  "periods": {
    "today":     { "revenueMinor": 0, "expensesMinor": 0, "profitMinor": 0, "orders": 0, "items": 0 },
    "thisWeek":  { "...": "same shape" },
    "thisMonth": { "...": "same shape" },
    "lastMonth": { "...": "same shape" },
    "last90Days":{ "...": "same shape" }
  },
  "topProducts":  [{ "name": "Cheesecake cups", "qty": 120, "revenueMinor": 180000 }],
  "topCustomers": [{ "ref": "c12", "firstName": "Sara", "orders": 9, "revenueMinor": 95000 }],
  "unpaid":       [{ "ref": "c12", "firstName": "Sara", "orderRef": "o33", "amountMinor": 4500, "dueDate": "2026-09-27" }],
  "upcoming":     [{ "orderRef": "o40", "date": "2026-09-27", "time": "17:00", "firstName": "Noor", "items": "2 x Chocolate cake", "totalMinor": 24500, "status": "confirmed" }],
  "prepTomorrow": [{ "name": "Chocolate cake", "qty": 2 }],
  "expensesThisMonth": [{ "category": "ingredients", "amountMinor": 32000 }],
  "occasions": [{ "name": "National Day", "daysUntil": 81 }],
  "capacity": { "daily": 150, "tomorrowUsed": 56 }
}
```
Revenue = order totals of non-cancelled orders due in the period; profit = revenue minus expenses in
the period. Lists are capped: topProducts 10, topCustomers 10, unpaid 50, upcoming 50, prep 30.

## Backend (this repo)
- Migration `db/migrations/0002_ai_usage.sql`: `orderat.ai_usage (install_id text, day date,
  count int, primary key (install_id, day))` plus a daily total, owned by `orderat_app`.
- Edge Function `supabase/functions/orderat-ask`: validate the body (size cap ~64 KB), enforce
  30 questions per install per day (3 in demo mode) and a global daily cap (env `ORDERAT_ASK_DAILY_CAP`,
  default 3000), call Gemini through the existing client (server/ai/gemini.ts, model + fallbacks) with
  JSON output `{answer, actions}`, validate actions against the allowed types and the refs present in
  the snapshot, and return. Log only counts and latency, never the snapshot or question.
- System prompt essentials: you are Orderat's assistant for a home seller; answer only from the
  snapshot; say you don't know if the snapshot lacks it; Gulf Arabic when lang=ar, simple English
  otherwise; short (max ~6 lines); format money with the currency (BHD/KWD/OMR 3 decimals, others 2,
  Latin digits); never mention phone numbers; only suggest the listed actions.

## Apps (iPhone and Android)
- Entry points: a prominent "اسأل اوردرات ✨" card on Today, and an icon on the Money screen.
- Chat screen: message list, input box, send button, 4-6 suggestion chips ("كم ربحت هالشهر؟",
  "منو باقي عليه فلوس؟", "وش أكثر شي ينباع؟", "وش أحضّر بكرة؟", "اكتب لي بوست"), action cards with
  confirm buttons, friendly errors (limit reached, offline).
- Consent sheet before the first question; Settings toggle "Ask Orderat (AI)".
- Snapshot builder as a pure, unit-tested function over the local data.
- The conversation is kept in memory only (not persisted) in v1.
