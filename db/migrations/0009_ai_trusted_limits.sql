-- Daily limits on the AI functions (orderat-ask, orderat-studio's caption and photo, orderat-parse) that a
-- client cannot reset (security review 1 Oct 2026, F02; docs/security-review-2026-10-01.md). Until now
-- their only per-caller limits were keyed by the request body's own `installId` and scaled by its own
-- `demo` flag, so a script could start over by sending a new installId, and claim the bigger paid quota
-- with demo=false. Those per-install counters stay (orderat.ai_usage, orderat.feature_usage) for the
-- apps' "remaining today"; these two tables add the trusted side (server/usage/trusted-limits.ts):
--   ai_ip_usage       calls without a signed-in session, per salted client-IP hash, per feature and day.
--                     bucket 'all' counts every such call; bucket 'paid_claim' only those that claim
--                     demo=false, which get a stricter cap. `ip_hash` is server/shared/crypto.ts's
--                     hashClientIp (salted SHA-256 hex), never the raw address.
--   ai_account_usage  calls with a valid X-Orderat-Session, per account, per feature and day: what those
--                     calls are limited by instead of the installId. Deleted with the account.
-- Applied after 0001-0008 by scripts/hosting-migrate.mjs; builds on 0004's orderat.users.
--
-- Idempotent by design, like 0001-0008 (every statement is CREATE ... IF NOT EXISTS, or otherwise safe
-- to re-run).

create table if not exists orderat.ai_ip_usage (
  feature text not null check (feature in ('ask', 'caption', 'photo', 'parse')),
  bucket text not null check (bucket in ('all', 'paid_claim')),
  ip_hash text not null,
  day date not null,
  count int not null default 0,
  primary key (feature, bucket, ip_hash, day)
);

create table if not exists orderat.ai_account_usage (
  feature text not null check (feature in ('ask', 'caption', 'photo', 'parse')),
  user_id uuid not null references orderat.users (id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (feature, user_id, day)
);

alter table orderat.ai_ip_usage enable row level security;
alter table orderat.ai_account_usage enable row level security;

-- Same ownership dance as 0001-0008 (see 0001_orderat_isolation.sql's comments for the full reasoning):
-- the connecting role needs SET-option membership in orderat_app plus CREATE on the schema for the
-- moment of ALTER ... OWNER TO, both revoked again once ownership has moved.
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.ai_ip_usage owner to orderat_app;
alter table orderat.ai_account_usage owner to orderat_app;

revoke create on schema orderat from orderat_app;
grant usage on schema orderat to orderat_app;

-- Read and incremented in place, like orderat.ai_usage/feature_usage: nothing in the app deletes a
-- counter row (an account's go with the account through the cascade above).
grant select, insert, update on orderat.ai_ip_usage, orderat.ai_account_usage to orderat_app;

revoke all on orderat.ai_ip_usage, orderat.ai_account_usage from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.ai_ip_usage, orderat.ai_account_usage from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.ai_ip_usage, orderat.ai_account_usage from authenticated';
  end if;
end
$$;
