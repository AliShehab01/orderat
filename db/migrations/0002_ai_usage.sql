-- Ledger for "Ask Orderat" (docs/ask-orderat.md): per-install and shared global daily question
-- counts, so the Edge Function orderat-ask can enforce its limits (30/day per install, 3/day in
-- demo mode, a global budget from ORDERAT_ASK_DAILY_CAP) with a single atomic upsert per request
-- instead of a read-then-write race that concurrent requests could slip through.
--
-- Lives in schema "orderat" and is owned by "orderat_app" — both created by
-- 0001_orderat_isolation.sql, which always runs first (scripts/hosting-migrate.mjs applies
-- db/migrations/*.sql in filename order). See that file's header for the full isolation contract;
-- this migration only adds two tables to the schema it already set up.
--
-- Idempotent by design, like 0001 (every statement is CREATE ... IF NOT EXISTS, or otherwise safe to
-- re-run): safe against a brand-new Postgres (after 0001), against PGlite in tests
-- (server/ask/pglite-test-support.ts), or a second time against a project that already has these
-- tables.

create table if not exists orderat.ai_usage (
  install_id text not null,
  day date not null,
  count int not null default 0,
  primary key (install_id, day)
);

-- One row per day: the shared budget across every install, incremented alongside orderat.ai_usage
-- on every request that passes body validation (see server/ask/limits.ts) — never reverted, even if
-- the request is later refused for being over a limit or Gemini fails, so the counters always
-- reflect "requests attempted today", not "requests answered today".
create table if not exists orderat.ai_usage_daily (
  day date primary key,
  count int not null default 0
);

alter table orderat.ai_usage enable row level security;
alter table orderat.ai_usage_daily enable row level security;

-- Same ownership dance as 0001_orderat_isolation.sql, repeated here for these two new tables (see
-- that file's comments for why each step is needed: the connecting role needs SET-option membership
-- in orderat_app plus CREATE on the schema for the moment of ALTER ... OWNER TO, both revoked again
-- once ownership has moved). Idempotent: re-granting a membership or privilege already held is not
-- an error.
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.ai_usage owner to orderat_app;
alter table orderat.ai_usage_daily owner to orderat_app;
revoke create on schema orderat from orderat_app;

grant usage on schema orderat to orderat_app;
-- No delete: nothing in the app prunes old rows (yet), so orderat_app only ever needs to read counts
-- and increment them.
grant select, insert, update on orderat.ai_usage, orderat.ai_usage_daily to orderat_app;

revoke all on orderat.ai_usage, orderat.ai_usage_daily from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.ai_usage, orderat.ai_usage_daily from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.ai_usage, orderat.ai_usage_daily from authenticated';
  end if;
end
$$;
