-- Orderat's isolation contract. This project (Hayati, ref ckjmbdbvlbxfofjgqiuj) is a live iOS game;
-- Orderat is a tenant sharing its free-tier Postgres, not a co-owner of it. Everything Orderat owns
-- lives in schema "orderat" — nothing touches "public" or any other schema in this database — and
-- is reached only through the least-privilege role "orderat_app" created below, never through
-- Hayati-wide credentials (no service role key, no admin DB URL: see server/agent/postgres-store.ts).
--
-- Idempotent by design (every statement is CREATE ... IF NOT EXISTS or guarded by a pg_catalog
-- check): safe to run against a brand-new Postgres, against PGlite in tests
-- (server/agent/order-store.contract.test.ts), or a second time against a project that already has
-- this schema. That is also what makes "move to a dedicated project" cheap later — this same file,
-- unmodified, is step one of the runbook in README.md's "Hosting" section: run it against the new
-- project, copy the data across, and Orderat's code needs nothing beyond a new connection string.
--
-- Applied by scripts/hosting-migrate.mjs (npm run hosting:migrate), never by `supabase db push` —
-- this file intentionally lives outside supabase/migrations so the Supabase CLI's own migration
-- history for Hayati (its game tables) never sees or clashes with it.

create schema if not exists orderat;

-- The role Orderat's code connects as (ORDERAT_DATABASE_URL, "orderat_app.<project-ref>" as the
-- pooler username). Created here with NOLOGIN: it cannot be connected to until a password is set,
-- and that happens out of band, in scripts/hosting-db-user.mjs, as a SCRAM-SHA-256 verifier computed
-- locally — the plaintext password is never written to this repo, a migration file, or a query log.
-- CREATE ROLE is DDL, which PL/pgSQL can only run via EXECUTE; the IF NOT EXISTS guard (checked
-- through pg_roles, not "CREATE ROLE IF NOT EXISTS", which not every Postgres-compatible engine
-- implements) is what makes re-running this file safe.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orderat_app') then
    execute 'create role orderat_app nologin';
  end if;
end
$$;

-- search_path so unqualified table names in orderat_app's own session default to this schema (belt
-- and suspenders alongside the schema-qualified names PostgresStore always uses); a tight statement
-- timeout so one slow query can't hold a pooler connection open; a hard connection cap so a bug or a
-- traffic spike in Orderat can never crowd out Hayati's game out of the pooler's 60-connection budget.
alter role orderat_app set search_path = orderat;
alter role orderat_app set statement_timeout = '10s';
alter role orderat_app connection limit 10;

create table if not exists orderat.orders (
  id uuid primary key,
  channel text not null check (channel in ('whatsapp', 'instagram')),
  customer_id text not null,
  customer_name text not null,
  items jsonb not null default '[]'::jsonb,
  collection_at timestamptz null,
  notes text null,
  status text not null check (status in ('pending', 'confirmed', 'prepped', 'collected')),
  changes jsonb not null default '[]'::jsonb,
  lang text not null check (lang in ('ar', 'en')),
  source_text text null,
  created_at timestamptz not null default now()
);

-- The agent's hot path: "this customer's orders, newest first" (server/agent/store.ts openOrdersFor).
create index if not exists orders_channel_customer_created_idx
  on orderat.orders (channel, customer_id, created_at desc);

-- Meta retries webhook deliveries; markSeen(messageId) is an insert-ignore-conflict on this primary
-- key so a retried delivery is never processed twice (server/agent/postgres-store.ts).
create table if not exists orderat.processed_messages (
  id text primary key,
  created_at timestamptz not null default now()
);

-- Applied-migrations ledger for scripts/hosting-migrate.mjs. Deliberately not owned by or granted to
-- orderat_app: only the project admin connection hosting-migrate.mjs uses (supabase db query
-- --linked, i.e. the Management API) ever writes to it, so a compromised or buggy orderat_app
-- connection can't rewrite its own migration history.
create table if not exists orderat.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

alter table orderat.orders enable row level security;
alter table orderat.processed_messages enable row level security;

-- Ownership, not policies, is how orderat_app reads/writes its two tables: Orderat has no PostgREST
-- access path at all (it speaks the Postgres wire protocol directly over the pooler — see
-- server/agent/postgres-store.ts), so there is no anon/authenticated request to write an RLS policy
-- for. A table owner bypasses RLS by default (Postgres only enforces RLS against the owner when the
-- table has FORCE ROW LEVEL SECURITY, which is deliberately not set here), so ownership gives
-- orderat_app unrestricted access to exactly these two tables and nothing else, while RLS stays ON
-- as defense in depth: if either table is ever exposed through PostgREST later (a future admin UI,
-- say), the default posture is "no anon/authenticated policy exists, so nobody can read or write"
-- until someone deliberately adds one — the same posture the pre-isolation public.orders/
-- public.processed_messages tables had.
alter table orderat.orders owner to orderat_app;
alter table orderat.processed_messages owner to orderat_app;

grant usage on schema orderat to orderat_app;
grant select, insert, update, delete on orderat.orders, orderat.processed_messages to orderat_app;

-- Nobody else gets anything on this schema. PUBLIC always exists; anon/authenticated are
-- Supabase-only roles that this schema-qualified file also needs to run cleanly against plain
-- Postgres and PGlite (server/agent/order-store.contract.test.ts), neither of which defines them —
-- hence the pg_roles guard instead of a bare "revoke ... from anon".
revoke all on schema orderat from public;
revoke all on all tables in schema orderat from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema orderat from anon';
    execute 'revoke all on all tables in schema orderat from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema orderat from authenticated';
    execute 'revoke all on all tables in schema orderat from authenticated';
  end if;
end
$$;

-- No INSERT into orderat.schema_migrations here: scripts/hosting-migrate.mjs appends that
-- bookkeeping insert (this filename, from the file system, not hardcoded per-migration) around
-- every file it applies, in the same transaction, so migration files stay pure schema and the
-- ledger logic lives in exactly one place.
