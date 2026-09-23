-- Orders captured by the WhatsApp/Instagram agent, and the Meta message ids already handled.
--
-- Both tables have RLS enabled with no policies at all: nothing is reachable through the anon or
-- authenticated PostgREST roles. Only the service role key (which bypasses RLS entirely) can read
-- or write, and that key only ever lives in the Edge Function's environment (see
-- server/agent/supabase-store.ts) — never in a client. This matches the local MemoryStore, which
-- is equally only reachable through the agent's own request handlers, never queried directly.

create table if not exists orders (
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
  on orders (channel, customer_id, created_at desc);

alter table orders enable row level security;

-- Meta retries webhook deliveries; markSeen(messageId) is an insert-ignore-conflict on this
-- primary key so a retried delivery is never processed twice (server/agent/supabase-store.ts).
create table if not exists processed_messages (
  id text primary key,
  created_at timestamptz not null default now()
);

alter table processed_messages enable row level security;
