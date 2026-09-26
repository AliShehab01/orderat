-- Tables for SME phase 2 (docs/sme-phase-2-cloud.md): a cloud account so a shop's data survives a
-- lost phone and works on several phones, optional staff, and the sync log they read/write through.
-- Applied after 0001 (schema "orderat" + role "orderat_app"), 0002 (Ask Orderat's usage tables) and
-- 0003 (marketing tables), all untouched here, by scripts/hosting-migrate.mjs, which always applies
-- db/migrations/*.sql in filename order.
--
-- Idempotent by design, like 0001-0003 (every statement is CREATE ... IF NOT EXISTS, or otherwise
-- safe to re-run): safe against a brand-new Postgres, against PGlite in tests
-- (server/cloud-pglite-test-support.ts), or a second time against a project that already has these
-- tables.

-- One row per signed-in seller or staff member, keyed by (provider, provider_sub) — the provider's
-- own stable subject id from the verified ID token (server/auth/verify-token.ts), never the token
-- itself. `email`/`name` are whatever the provider's token carries (Apple omits both after the
-- user's first grant; Google usually sends both) — display-only, never used to look a user up.
create table if not exists orderat.users (
  id uuid primary key,
  provider text not null check (provider in ('apple', 'google')),
  provider_sub text not null,
  email text null,
  name text null,
  created_at timestamptz not null default now()
);

create unique index if not exists users_provider_sub_idx on orderat.users (provider, provider_sub);

-- A signed-in session (docs/sme-phase-2-cloud.md's "Accounts"). `token_hash` is the SHA-256 hex of a
-- random 32-byte session token (server/shared/crypto.ts's sha256HexOfString) — the raw token is
-- returned to the app exactly once, on signin, and never stored; every later call is authenticated by
-- hashing the token it sends back (X-Orderat-Session) and looking up that hash, the same
-- hash-then-constant-time-compare pattern as orderat.shops.token_hash (server/shop/store.ts's
-- findShopByToken). Sessions are long-lived (no expiry column) — "signing out revokes them" by
-- setting revoked_at, which every lookup filters on.
create table if not exists orderat.sessions (
  token_hash text primary key,
  user_id uuid not null references orderat.users (id) on delete cascade,
  device_name text null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists sessions_user_id_idx on orderat.sessions (user_id);

-- Separate from `sessions` (rather than extra columns on it) for the same reason
-- orderat.feature_usage is its own table instead of columns bolted onto another one: a rate-limit
-- counter is its own concern, sharing nothing else with the session row it's keyed by.
-- server/sync/rate-limit.ts's fixed-window counter (docs/sme-phase-2-cloud.md: "60 syncs per minute
-- per session") — one row per session that has ever called `sync`, reset whenever a request lands
-- outside the current 60-second window.
create table if not exists orderat.sync_rate_limit (
  token_hash text primary key,
  window_started_at timestamptz not null,
  count int not null default 0
);

-- The cloud copy of a seller's shop (docs/sme-phase-2-cloud.md's "Shops and members"). `id` is the
-- shop's own local id — both apps already mint a string UUID for their local shop before any sync
-- exists (docs: "both apps already use string UUID ids") — so `create_shop` (server/sync/handler.ts)
-- never has to invent a new id and reconcile it back to the phone; the phone's existing id becomes
-- the cloud row's id directly, and every synced record is scoped under it.
create table if not exists orderat.shops_cloud (
  id uuid primary key,
  owner_user_id uuid not null references orderat.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists shops_cloud_owner_idx on orderat.shops_cloud (owner_user_id);

-- One row per person with access to a shop: the owner (inserted by create_shop) and each invited
-- staff member (inserted by invite_join). `permissions` is always a complete
-- `{orders,prepare,money,products}` boolean object (server/sync/permissions.ts normalizes it on every
-- write) even for an owner row, whose permissions are ignored in favor of role = 'owner' granting
-- everything (server/sync/permissions.ts's hasPermission) — stored explicitly anyway so no reader ever
-- has to special-case a null. `on delete cascade` on both foreign keys: removing a shop (owner account
-- deletion) or a user (their own account deletion) removes their membership rows with it.
create table if not exists orderat.shop_members (
  shop_id uuid not null references orderat.shops_cloud (id) on delete cascade,
  user_id uuid not null references orderat.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  permissions jsonb not null default '{"orders": false, "prepare": false, "money": false, "products": false}'::jsonb,
  joined_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- Staff join codes (docs/sme-phase-2-cloud.md: "the owner creates a 6-digit code, valid for 48 hours,
-- single use, stored hashed"). `code_hash` is the SHA-256 hex of the 6-digit code, the same
-- hash-only-ever-stored approach as session tokens and shop edit tokens; the raw code is returned to
-- the owner exactly once, on invite_create. No uniqueness constraint on `code_hash`: with a 6-digit
-- space, a brand-new code can collide with an old, already-used-or-expired row, so
-- server/sync/store.ts checks for an active (unused, unexpired) collision itself before inserting and
-- retries with a new random code rather than leaning on the database to enforce it (a partial unique
-- index can't reference now() in Postgres, since index predicates must be immutable).
create table if not exists orderat.invites (
  id uuid primary key,
  shop_id uuid not null references orderat.shops_cloud (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  -- Audit-only ("who joined with this code"); set null rather than cascading the invite away if that
  -- user later deletes their account — the invite row itself (now long since used) has nothing left
  -- to cascade to.
  used_by_user_id uuid null references orderat.users (id) on delete set null
);

create index if not exists invites_code_hash_idx on orderat.invites (code_hash);

-- The synced record log (docs/sme-phase-2-cloud.md's "Sync"): one row per (shop, entity, local id),
-- exactly the shape the spec gives — "data jsonb" is the record precisely as the apps store it
-- locally (both apps already use string UUID ids, so `id` here is that same string, not a fresh
-- server-assigned one). `seq` is what "last writer wins" is decided by (server/sync/store.ts's
-- applyChange): every accepted push, insert or update alike, draws a new value from the bigserial's
-- sequence, never reusing the DEFAULT (which only fires on INSERT) — see that file for why the
-- `on conflict` path re-draws it explicitly. Deletes are tombstones (`deleted = true`, row kept) so a
-- pull can tell every other device to remove it too, per the spec.
create table if not exists orderat.records (
  shop_id uuid not null references orderat.shops_cloud (id) on delete cascade,
  entity text not null check (entity in ('shop', 'product', 'customer', 'order', 'expense', 'occasion', 'stock_move', 'setting')),
  id text not null,
  seq bigserial,
  data jsonb not null,
  deleted boolean not null default false,
  updated_by uuid null,
  updated_at timestamptz not null default now(),
  primary key (shop_id, entity, id)
);

-- The pull query's own access path: "records with seq > cursor, up to 500" (docs/sme-phase-2-cloud.md),
-- always scoped to one shop.
create index if not exists records_shop_seq_idx on orderat.records (shop_id, seq);

alter table orderat.users enable row level security;
alter table orderat.sessions enable row level security;
alter table orderat.sync_rate_limit enable row level security;
alter table orderat.shops_cloud enable row level security;
alter table orderat.shop_members enable row level security;
alter table orderat.invites enable row level security;
alter table orderat.records enable row level security;

-- Same ownership dance as 0001-0003 (see 0001_orderat_isolation.sql's comments for the full
-- reasoning): the connecting role needs SET-option membership in orderat_app plus CREATE on the
-- schema for the moment of ALTER ... OWNER TO, both revoked again once ownership has moved.
-- Idempotent: re-granting a membership or privilege already held is not an error.
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.users owner to orderat_app;
alter table orderat.sessions owner to orderat_app;
alter table orderat.sync_rate_limit owner to orderat_app;
alter table orderat.shops_cloud owner to orderat_app;
alter table orderat.shop_members owner to orderat_app;
alter table orderat.invites owner to orderat_app;
alter table orderat.records owner to orderat_app;

revoke create on schema orderat from orderat_app;
grant usage on schema orderat to orderat_app;

-- users/shops_cloud/shop_members/records: read, written, and edited in place; "delete my account"
-- (server/auth/store.ts's deleteAccount) deletes a users row and lets the foreign keys above cascade
-- everything else, so delete is only ever granted on orderat.users itself, not on the tables that
-- cascade from it.
grant select, insert, update on orderat.shops_cloud, orderat.shop_members, orderat.records to orderat_app;
grant select, insert, update, delete on orderat.users to orderat_app;
-- sessions: signout revokes in place (update); nothing ever deletes a session row directly (account
-- deletion removes them via the cascade above, driven by a delete on orderat.users).
grant select, insert, update on orderat.sessions to orderat_app;
-- sync_rate_limit: read and incremented/reset in place; a row for a signed-out or deleted session is
-- harmless (its token_hash can never match a live session again) and is left for a future cleanup job
-- rather than granted delete here.
grant select, insert, update on orderat.sync_rate_limit to orderat_app;
-- invites: read, inserted by invite_create, marked used by invite_join — never deleted (an expired or
-- used invite is harmless clutter, not a cleanup priority for v1).
grant select, insert, update on orderat.invites to orderat_app;

revoke all on orderat.users, orderat.sessions, orderat.sync_rate_limit, orderat.shops_cloud, orderat.shop_members, orderat.invites, orderat.records from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.users, orderat.sessions, orderat.sync_rate_limit, orderat.shops_cloud, orderat.shop_members, orderat.invites, orderat.records from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.users, orderat.sessions, orderat.sync_rate_limit, orderat.shops_cloud, orderat.shop_members, orderat.invites, orderat.records from authenticated';
  end if;
end
$$;

-- Private Storage bucket for synced product photos (docs/sme-phase-2-cloud.md: "Product photos go to
-- the Storage bucket orderat-photos ... They are ... private", fetched only through orderat-sync's
-- own `photo_url` action, a short-lived signed URL — never `public: true`, unlike orderat.shops'
-- public "orderat-shop" bucket in 0003_marketing.sql). Guarded the same way as that bucket insert: a
-- no-op against PGlite in tests, which has no `storage` schema at all.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('orderat-photos', 'orderat-photos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end
$$;
