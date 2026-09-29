-- Phone-to-web login, "Open on computer": the website (https://orderatweb.com/app/) shows a pairing's
-- code as a QR code and as 6 digits, the seller's signed-in phone scans or types it and approves, and
-- the website, polling, receives a web session for the phone's account — orderat-auth's pair_start,
-- pair_approve and pair_poll (server/auth/handler.ts, store.ts, rate-limit.ts). Applied after
-- 0001-0005 by scripts/hosting-migrate.mjs; builds on 0004's orderat.users.
--
-- Idempotent by design, like 0001-0005 (every statement is CREATE ... IF NOT EXISTS, or otherwise safe
-- to re-run).

-- One row per pairing, alive for five minutes from pair_start (expires_at, which an approval in the
-- last minute pushes to a minute after the approval, so the website can still collect its session);
-- every pairing call first deletes the rows whose time is up (server/auth/store.ts's
-- deleteExpiredPairings), so the table only ever holds pairings still in progress, and pair_start
-- refuses new ones while 500 are pending (server/auth/handler.ts's MAX_PENDING_PAIRINGS).
--   code          the 6 digits the website shows, stored as is: unlike a session or poll token it is not
--                 a secret that grants anything on its own (approving it takes a signed-in phone,
--                 rate limited), and a hash of 6 digits would be reversed by trying all 1,000,000.
--   poll_hash     SHA-256 hex of the poll token pair_start returned to the website — its only proof,
--                 when polling, that it started this pairing. The raw poll token is never stored.
--   status        pending (waiting for a phone) -> approved (a phone approved; session_token set)
--                 -> consumed (the website collected its session; session_token cleared).
--   user_id       the approving phone's user, whose account the web session is for.
--   session_token the RAW token of the web session pair_approve created, held only until the website's
--                 first successful poll hands it out and clears it (or, never collected, until the row
--                 expires and is deleted, and that session revoked) — the one place a raw session token
--                 is ever written down; orderat.sessions itself only ever stores its hash.
create table if not exists orderat.web_pairings (
  id uuid primary key,
  code text not null,
  poll_hash text not null,
  status text not null check (status in ('pending', 'approved', 'consumed')),
  user_id uuid null references orderat.users (id) on delete cascade,
  session_token text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz null
);

-- pair_approve's lookup ("the pending pairing with this code"), and what keeps a code unique among
-- pending pairings: pair_start's insert does nothing on a clash and retries with a fresh code. Unlike
-- orderat.invites' codes (0004), uniqueness can be enforced here because it only needs `status`, not
-- now(); an expired but not yet deleted pending row cannot block a code either, since pair_start
-- deletes expired rows before it inserts.
create unique index if not exists web_pairings_pending_code_idx on orderat.web_pairings (code) where status = 'pending';

-- The expiry cleanup every pairing call runs first ("delete ... where expires_at <= now") and
-- pair_start's count of unexpired pending pairings, both without reading the whole table.
create index if not exists web_pairings_expires_at_idx on orderat.web_pairings (expires_at);

-- server/auth/rate-limit.ts's fixed-window counters, the same shape (and the same reasons for being
-- tables of their own) as 0004's orderat.sync_rate_limit:
--   pair_start_rate_limit    pair_start calls per client IP (at most 10 a minute). `ip_hash` is the
--                            salted SHA-256 hex of the IP (server/shared/crypto.ts's hashClientIp),
--                            never the raw address.
--   pair_approve_rate_limit  pair_approve calls per account (at most 10 a minute), whichever of the
--                            account's sessions makes them; deleted with the account.
create table if not exists orderat.pair_start_rate_limit (
  ip_hash text primary key,
  window_started_at timestamptz not null,
  count int not null default 0
);

create table if not exists orderat.pair_approve_rate_limit (
  user_id uuid primary key references orderat.users (id) on delete cascade,
  window_started_at timestamptz not null,
  count int not null default 0
);

alter table orderat.web_pairings enable row level security;
alter table orderat.pair_start_rate_limit enable row level security;
alter table orderat.pair_approve_rate_limit enable row level security;

-- Same ownership dance as 0001-0004 (see 0001_orderat_isolation.sql's comments for the full reasoning):
-- the connecting role needs SET-option membership in orderat_app plus CREATE on the schema for the
-- moment of ALTER ... OWNER TO, both revoked again once ownership has moved.
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.web_pairings owner to orderat_app;
alter table orderat.pair_start_rate_limit owner to orderat_app;
alter table orderat.pair_approve_rate_limit owner to orderat_app;

revoke create on schema orderat from orderat_app;
grant usage on schema orderat to orderat_app;

-- web_pairings: inserted by pair_start, updated by pair_approve and pair_poll, and deleted once expired.
grant select, insert, update, delete on orderat.web_pairings to orderat_app;
-- The rate-limit counters: read and incremented/reset in place, never deleted by the app (same as
-- sync_rate_limit; an account's approval counter goes with the account through the cascade above).
grant select, insert, update on orderat.pair_start_rate_limit, orderat.pair_approve_rate_limit to orderat_app;

revoke all on orderat.web_pairings, orderat.pair_start_rate_limit, orderat.pair_approve_rate_limit from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.web_pairings, orderat.pair_start_rate_limit, orderat.pair_approve_rate_limit from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.web_pairings, orderat.pair_start_rate_limit, orderat.pair_approve_rate_limit from authenticated';
  end if;
end
$$;
