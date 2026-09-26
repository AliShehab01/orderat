-- Tables for the marketing tools (docs/marketing-tools.md): occasion campaigns, the AI photo
-- studio, and a seller's public shop link. Applied after 0001 (schema "orderat" + role "orderat_app")
-- and 0002 (Ask Orderat's own usage tables, untouched here) by scripts/hosting-migrate.mjs, which
-- always applies db/migrations/*.sql in filename order.
--
-- Idempotent by design, like 0001 and 0002 (every statement is CREATE ... IF NOT EXISTS, or
-- otherwise safe to re-run): safe against a brand-new Postgres, against PGlite in tests
-- (server/marketing-pglite-test-support.ts), or a second time against a project that already has
-- these tables.

-- Generic AI-feature usage ledger (docs/marketing-tools.md's "Usage ledger"): one pair of tables for
-- every AI-gated marketing feature, keyed by `feature` ("caption" | "photo" — server/usage's own
-- Feature type) so both counters share one table pair instead of one per feature, the way
-- orderat.ai_usage/ai_usage_daily are Ask Orderat's own, separate pair (0002_ai_usage.sql). Same
-- atomic-upsert shape and reasoning as those two: see 0002's comments for why increment-then-check
-- (never check-then-increment) is what keeps a burst of concurrent requests from pushing a counter
-- unboundedly past its limit.
create table if not exists orderat.feature_usage (
  feature text not null,
  install_id text not null,
  day date not null,
  count int not null default 0,
  primary key (feature, install_id, day)
);

create table if not exists orderat.feature_usage_daily (
  feature text not null,
  day date not null,
  count int not null default 0,
  primary key (feature, day)
);

-- A published shop (docs/marketing-tools.md's "Public shop document" lives in `doc`, verbatim: the
-- server only ever fills in `photoUrl`/`logoUrl` before writing it, per server/shop/doc.ts — nothing
-- else transforms it). `token_hash` is the SHA-256 hex of the seller's edit token
-- (server/shared/crypto.ts); the raw token itself is never stored, only ever returned once, on the
-- publish call that creates it. `publish_count_today`/`publish_count_day` back the "30 publishes per
-- shop per day" rate limit (server/shop/handler.ts) — kept as columns on the row being updated
-- anyway, rather than a separate counter table, since a shop must already exist to be re-published
-- (the very first publish can never itself be rate-limited: there is no row yet to check a count
-- against).
create table if not exists orderat.shops (
  id uuid primary key,
  slug text not null unique,
  token_hash text not null,
  install_id text not null,
  doc jsonb not null,
  published boolean not null default true,
  blocked boolean not null default false,
  publish_count_today int not null default 0,
  publish_count_day date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per photo actually uploaded to Storage, keyed by its content hash (`photo_id` = the SHA-256
-- hex of the JPEG/PNG/WebP bytes — server/shop/photos.ts) so a publish that resends a photo the
-- server already has is recognized and never re-uploaded. `path` is the Storage object path
-- (`<shop_id>/<photo_id>.jpg`, matching docs/marketing-tools.md); the public URL is derived from it,
-- never stored redundantly.
create table if not exists orderat.shop_photos (
  shop_id uuid not null references orderat.shops (id) on delete cascade,
  photo_id text not null,
  path text not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, photo_id)
);

-- A customer order placed on the public shop page. `doc` is the validated order (customer name/phone,
-- items with server-priced totals, pickup/delivery details) — see server/shop/orders.ts for the exact
-- shape. `ip_hash` is the SHA-256 hex of the submitting IP (server/shared/crypto.ts), never the raw
-- address, used only for the per-IP rate limit. Rows are deleted by `ack` once the seller's app has
-- downloaded them, and purged after 30 days regardless (server/shop/orders.ts's purgeOldOrders) —
-- so, unlike orderat.orders (0001), this table intentionally has no long-term retention.
create table if not exists orderat.shop_orders (
  id uuid primary key,
  shop_id uuid not null references orderat.shops (id) on delete cascade,
  ref text not null,
  doc jsonb not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

-- The order and rate-limit queries this table exists for: "this shop's orders, newest first" (inbox),
-- "how many orders has this shop had in the last day" (rate limit), and "how many orders has this IP
-- placed in the last hour" (the other rate limit, server/shop/orders.ts).
create index if not exists shop_orders_shop_created_idx on orderat.shop_orders (shop_id, created_at desc);
create index if not exists shop_orders_ip_created_idx on orderat.shop_orders (ip_hash, created_at desc);

-- View counter for a shop's public page, one row per shop per day (same shape as
-- orderat.ai_usage/feature_usage: an atomic upsert increment on every public GET), rolled up into
-- `stats`'s `views7d` by summing the last 7 rows.
create table if not exists orderat.shop_views_daily (
  shop_id uuid not null references orderat.shops (id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (shop_id, day)
);

-- Public Storage bucket for shop photos (docs/marketing-tools.md: "Photos go to the public Supabase
-- Storage bucket orderat-shop"). Guarded so this is a no-op against PGlite in tests, which has no
-- `storage` schema at all (that schema only exists on a real Supabase project) — `to_regclass` returns
-- null for a schema-qualified name that doesn't exist, rather than erroring, which is what makes the
-- guard work. `file_size_limit` is in bytes (400 KB, this migration's own copy of
-- docs/marketing-tools.md's photo size cap — server/shop/photos.ts enforces the same number before a
-- photo is ever uploaded, so this is defense in depth, not the primary check).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('orderat-shop', 'orderat-shop', true, 409600, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end
$$;

alter table orderat.feature_usage enable row level security;
alter table orderat.feature_usage_daily enable row level security;
alter table orderat.shops enable row level security;
alter table orderat.shop_photos enable row level security;
alter table orderat.shop_orders enable row level security;
alter table orderat.shop_views_daily enable row level security;

-- Same ownership dance as 0001/0002 (see 0001_orderat_isolation.sql's comments for the full
-- reasoning): the connecting role needs SET-option membership in orderat_app plus CREATE on the
-- schema for the moment of ALTER ... OWNER TO, both revoked again once ownership has moved.
-- Idempotent: re-granting a membership or privilege already held is not an error.
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.feature_usage owner to orderat_app;
alter table orderat.feature_usage_daily owner to orderat_app;
alter table orderat.shops owner to orderat_app;
alter table orderat.shop_photos owner to orderat_app;
alter table orderat.shop_orders owner to orderat_app;
alter table orderat.shop_views_daily owner to orderat_app;

revoke create on schema orderat from orderat_app;
grant usage on schema orderat to orderat_app;

-- feature_usage/feature_usage_daily: same as orderat.ai_usage (0002) — read and increment only,
-- nothing ever deletes a usage row.
grant select, insert, update on orderat.feature_usage, orderat.feature_usage_daily to orderat_app;
-- shops/shop_views_daily: read and updated in place (a shop is edited, never recreated; the view
-- counter is upserted daily) — no delete path exists for either.
grant select, insert, update on orderat.shops, orderat.shop_views_daily to orderat_app;
-- shop_photos: a photo is written once (content-addressed by photo_id) and never edited or removed
-- on its own — cleanup, if ever needed, would go through a dedicated maintenance path, not this role.
grant select, insert on orderat.shop_photos to orderat_app;
-- shop_orders: the only table here that's ever deleted from — `ack` removes rows the seller's app has
-- downloaded, and purgeOldOrders removes anything older than 30 days regardless.
grant select, insert, delete on orderat.shop_orders to orderat_app;

revoke all on orderat.feature_usage, orderat.feature_usage_daily, orderat.shops, orderat.shop_photos, orderat.shop_orders, orderat.shop_views_daily from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.feature_usage, orderat.feature_usage_daily, orderat.shops, orderat.shop_photos, orderat.shop_orders, orderat.shop_views_daily from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.feature_usage, orderat.feature_usage_daily, orderat.shops, orderat.shop_photos, orderat.shop_orders, orderat.shop_views_daily from authenticated';
  end if;
end
$$;
