-- Shop link payment methods (the payment-methods contract shared by the phones, orderat-shop, the shop
-- page and the web app): a published shop lists how customers can pay it — bank transfer (IBAN), the
-- GCC wallets (BenefitPay, STC Pay, urpay, Aani, WAMD, Fawran), transfer to a mobile number, PayPal,
-- payment links and cash — as `payment_methods`, a JSON array of { type, value?, name? } that
-- server/shop/payment-methods.ts validates on publish and orderat-shop serves as `paymentMethods`.
-- Applied after 0001-0007 by scripts/hosting-migrate.mjs; builds on 0003's orderat.shops.
--
-- Idempotent by design, like 0001-0007: the column is added only if missing, and the backfill only
-- fills a shop that still has no methods at all.

alter table orderat.shops add column if not exists payment_methods jsonb not null default '[]'::jsonb;

-- Backfill: a shop published before this change with an IBAN in its document gets that IBAN as its one
-- bank_transfer method. The account holder's name (doc's ibanName) is not carried over: a bank transfer
-- has no name field any more (founder ruling, 30 Sep 2026).
update orderat.shops
set payment_methods = jsonb_build_array(jsonb_build_object('type', 'bank_transfer', 'value', doc->>'iban'))
where payment_methods = '[]'::jsonb
  and coalesce(doc->>'iban', '') <> '';
