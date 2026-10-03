# SME phase 1: business type, optional VAT invoices, optional stock

Orderat started as an order book for home sellers. The founder wants it to fit every small business
that sells through WhatsApp and Instagram (shops, boutiques, services, restaurants and cafés, home
businesses). Many of them have no VAT registration and no staff, so **everything here is optional
and off by default**. A seller who never opens these settings sees the app exactly as before.

Shared by the iPhone app (orderat-ios) and the Android app (orderat-app). All data stays on the
phone (cloud sync is phase 2).

## A. Business type

- Shop setup (onboarding) asks "What kind of business?" with one card per type:

  | Value | Arabic | English | Examples |
  |---|---|---|---|
  | `home` | مشروع منزلي | Home business | sweets, food trays, crafts |
  | `shop` | متجر / محل | Shop or boutique | perfumes, abayas, gifts, accessories |
  | `services` | خدمات | Services | salon, tailoring, repairs, cleaning |
  | `food` | مطعم / كافيه | Restaurant or café | catering, coffee, trays |
  | `food_truck` | عربة طعام (فود ترك) | Food truck | karak, burgers, snacks, coffee |
  | `other` | غير ذلك | Other | anything else |

  `food_truck` was added after the first release (food trucks, "العربات", are common in Bahrain).
  Its demo shop is a street-food truck (karak, burgers, fries, shawarma, mojito).

- Stored on the Shop (`businessType`, default `home` for existing installs, so old data keeps working).
  Editable later in Settings.
- The demo shop (before subscribing) is seeded to match the chosen type: 5 demo catalogs (home
  sweets = today's demo; shop = perfumes/abayas/gifts; services = salon/tailoring services; food =
  café/catering; food_truck = street food) with the same customers/orders structure. `other` uses the shop catalog.
- Ask Orderat's snapshot gets `"businessType"` so answers fit (server ignores unknown fields safely;
  prompt improvement is optional).
- Wording stays neutral everywhere ("مشروعك", "منتجاتك وخدماتك"); nothing assumes food.

## B. VAT invoices (optional)

Settings → "الضريبة (VAT)" → toggle, **off by default**.

When on:
- **Tax number (TRN)**: required text, up to 20 characters.
- **Rate**: prefilled from the shop currency's country and editable, from 0% to 30% with 2 decimals.
  - BHD 10%, SAR 15%, AED 5%, OMR 5%.
  - KWD and QAR 0%. Show a note that the country has no VAT yet.
- **Prices include VAT?** Yes (default) or No.

The VAT amount per order is computed in **minor units with integer math** and rounded half-up per order:
- If prices include VAT: `vat = total - round(total / (1 + rate))`.
- If prices exclude VAT: `vat = round(subtotal × rate)` and `total = subtotal + vat`.

When an order is created, it snapshots `vatRateBps` (the rate in basis points, 1000 = 10%), `vatIncluded` and `vatMinor`. Turning VAT off later, or changing the rate, never rewrites past orders, and editing an order recomputes its VAT from its own rate and mode, never the shop's current settings.

The order detail and the receipt show:
- Subtotal (before VAT)
- VAT X%
- Total

The receipt becomes a **"فاتورة ضريبية مبسطة / Simplified tax invoice"** with:
- the seller's name
- the TRN
- a sequential invoice number (per install, e.g. `INV-000123`, never reused)
- the date and time
- the lines
- subtotal, VAT and total

**Saudi Arabia (SAR)**: add the ZATCA phase-1 QR code to the invoice. Its content is base64 of TLV:
- tag 1: seller name
- tag 2: VAT number
- tag 3: ISO timestamp
- tag 4: invoice total with VAT
- tag 5: VAT total

Each value is UTF-8; tag and length are single bytes. Unit-test the TLV encoding against a known vector.

The Money screen gets a "VAT collected" line for the selected range. It only shows when VAT is on or when any order in the range has `vatMinor > 0`.

## C. Stock (optional)

Settings → "تتبع المخزون / Track stock" → toggle, **off by default**.

When on:
- **Product edit** gets two fields:
  - Track stock for this product: a per-product toggle, default on for new products once the feature is on.
  - Quantity in stock (integer ≥ 0) and a "low stock at" threshold (default 3).
- **Stock moves:**
  - Confirming an order (moving to confirmed or later) deducts its quantities for tracked products.
  - Cancelling a confirmed order puts them back.
  - Editing a confirmed order's quantities adjusts by the difference.
  - Stock may go negative, shown in red with a warning, because sellers sometimes take the order first. It is never blocked.
- **Manual adjust** from the product: + / − with a reason (received / damaged / correction). The last 50 moves are kept per product.
- **Where stock shows:**
  - Today shows a "Low stock" card when any tracked product is at or below its threshold.
  - The product list shows stock badges.
  - The shop link's publish marks tracked products with stock ≤ 0 as `available: false`.
- Demo mode: stock works on the demo data too, so the seller can try it.

## Rules

- Everything local, integer money math, Latin digits, Arabic first with RTL.
- Arabic copy is masculine by default, with the feminine setting's variants (see the address setting).
- Old saved data and backups stay decodable. New fields are optional with safe defaults.
- Unit tests for the pure parts:
  - VAT math (both modes, rounding, 3-decimal currencies)
  - invoice numbering
  - the ZATCA TLV
  - stock moves (confirm, cancel, edit, negative)
  - demo catalog selection
- Widget tests: the settings toggles show and hide their fields, and the receipt shows the VAT lines.
