# Orderat (اوردرات) Web MVP — Implementation Plan (compact)

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans. Spec = PRD doc https://claude.ai/code/artifact/8bdbd530-5f6c-4945-aeb5-46905c69d780

**Goal:** Pitch demo web app: paste/upload a customer message → draft order → confirm → order book → day plan. Arabic default + English.

**Architecture:** Next.js (App Router, TS, Tailwind v4). No backend DB: zustand + localStorage. `/api/extract` route calls Gemini when `GEMINI_API_KEY` set, else a mock parser. Pure logic in `src/lib` with vitest tests.

**Stack:** next 15, react 19, tailwind 4, zustand (persist), vitest.

## Global constraints
- Arabic default, English toggle; `dir` follows language, never mixed.
- Nothing enters the order book without a Confirm tap.
- No customer-facing messaging. No ingredient engine (packaging only).
- Gemini key server-side only (`.env.local`). Model `gemini-2.5-flash-lite`, JSON schema output.

## Files
- `src/lib/types.ts` — Product, Order, OrderItem, Draft, Settings.
- `src/lib/text/normalize.ts` — Arabic digit/letter normalisation.
- `src/lib/parser/mockParser.ts` — `parseOrderText({text, products, now}) → Draft` (name, items, weekday/time, notes).
- `src/lib/changes/matchOrder.ts` — `findChangeCandidate(draft, orders, products, now)` → diffs for same customer within 14 days.
- `src/lib/plan/buildPlan.ts` — `buildDayPlan(orders, products, dateKey, capacity)` → totals (round up to batch), packaging, slots by time, flags.
- `src/lib/gemini/extract.ts` — REST call with responseSchema; `src/lib/parser/demoDrafts.ts` for image/voice without key.
- `src/lib/demo/seed.ts` — 5 products, 12 orders on next Thu/Fri/Sat.
- `src/store/useAppStore.ts` — zustand persist, `skipHydration`.
- `src/i18n/dictionaries.ts`, `src/i18n/LocaleProvider.tsx` — `useT()`.
- Routes: `/` language, `/login` placeholder, `/(app)/today|inbox|orders|orders/new|orders/[id]|plan|products|settings`, `/api/extract`.
- Components: `AppShell`, `BottomNav`, `inbox/{CaptureForm,OrderFields,DraftCard,ChangeCard}`, `plan/DayPlanView`, `products/ProductForm`, `ui/{Button,Card,Field}`.

## Tasks (each: test → implement → `npm test` → commit)
1. Tooling: vitest config (`tests/**`), `npm i zustand`, `npm i -D vitest`. Commit.
2. types + normalize + dates helpers, tests for digits/tashkeel/nextWeekday.
3. mockParser, TDD with PRD examples: Sara text (20 cheesecake, 10 brownie, Sat 10:00), Noor text (15 red velvet, 5 cheesecake, Thu 12:00, no name), Um Khalid (30 cupcake, 12 cheesecake, Sat 18:00), Sara change ("35 كب مو 20" → loose qty 35, oldQuantities [20]), Arabizi Mona (Fri 17:00).
4. matchOrder, TDD: same customer + qty diff → change; other customer → null; >14 days → null; loose qty maps via oldQuantities or single-item order.
5. buildPlan, TDD: batch rounding (20 ordered, batch 12 → 24), packaging sums (ceil), slots sorted, noTime flagged, overCapacity.
6. store + seed + i18n + shell + language/login pages (manual check in browser).
7. `/api/extract` + gemini client + demo drafts. Mock when no key.
8. Inbox screen (capture, draft card, change card, examples chips).
9. Orders screens (list, filters, manual add/edit, status, change log).
10. Plan + Today screens (check-off state in store).
11. Products + Settings + PWA manifest + README pitch script. Final lint/test/browser walkthrough.

## Demo script (pitch)
Language → Continue as demo seller (loads demo data) → Inbox → "Try example: Sara" → confirm → Orders → Inbox → "Sara changes to 35" → confirm change → Plan (Saturday) shows 35 + batches → Today.
