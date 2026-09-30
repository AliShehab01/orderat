-- Sign in with Apple token revocation (App Store Review Guideline 5.1.1(v)): when an account that signed
-- in with Apple is deleted, Orderat must also revoke the Apple tokens it holds for it. At signin the app
-- (or the web app) may send Apple's one-time authorization code alongside the ID token; orderat-auth
-- exchanges it at https://appleid.apple.com/auth/token for a refresh token, keeps that here, and on
-- delete_account calls https://appleid.apple.com/auth/revoke with it before deleting the account
-- (server/auth/apple-tokens.ts, server/auth/handler.ts, server/auth/store.ts). Only used when the
-- ORDERAT_APPLE_TEAM_ID / ORDERAT_APPLE_KEY_ID / ORDERAT_APPLE_PRIVATE_KEY secrets are set.
-- Applied after 0001-0006 by scripts/hosting-migrate.mjs; builds on 0004's orderat.users.
--
-- Idempotent by design, like 0001-0006 (every statement is CREATE ... IF NOT EXISTS, or otherwise safe
-- to re-run).

-- One row per (account, Apple client id): the iPhone app's tokens are issued to its bundle id
-- (com.ams.orderat), the website's to its Services ID (com.ams.orderat.web), and a revoke must name the
-- same client id the token was issued to. A later signin from the same client replaces the row.
--   refresh_token  Apple's refresh token for this account and client. It grants nothing at Orderat (a
--                  session is a separate token) and at Apple only lets its holder, with Orderat's own
--                  signing key, refresh or revoke; it is deleted with the account through the cascade.
create table if not exists orderat.apple_tokens (
  user_id uuid not null references orderat.users (id) on delete cascade,
  client_id text not null,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table orderat.apple_tokens enable row level security;

-- Same ownership dance as 0001-0006 (see 0001_orderat_isolation.sql's comments for the full reasoning).
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.apple_tokens owner to orderat_app;

revoke create on schema orderat from orderat_app;
grant usage on schema orderat to orderat_app;

-- Upserted at signin, read and deleted at delete_account.
grant select, insert, update, delete on orderat.apple_tokens to orderat_app;

revoke all on orderat.apple_tokens from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.apple_tokens from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.apple_tokens from authenticated';
  end if;
end
$$;
