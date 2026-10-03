-- The server owns an order's stock (third external review, 3 Oct 2026, F1-F5; fourth review, same day, R1 and R4;
-- docs/security-review-2026-10-01.md "Third review" and "Fourth review"; docs/sme-phase-2-cloud.md "Stock with several
-- phones"). Three things, all additive:
--
--   order_stock   what the server has actually taken out of each product's stock for each order, per
--                 (order, product): the "applied allocation". An accepted order write whose record carries a
--                 ledger (`stockDeducted`) moves each product by `applied - ledger` and sets `applied`, in the
--                 same unit as the order write (sync_apply below).
--   stock_ops     every client stock-move id the server has applied or deliberately ignored (and the moves
--                 already in a product's stored list whenever the server rewrites that list): a durable,
--                 uncapped record that a move is never applied twice, whatever the 50-entry display history
--                 holds. A row's key is orderat.stock_move_key(move) below: `id:` and the move's id with the
--                 ASCII capitals folded (iOS sends uppercase UUIDs, Android and the web lowercase), or, for a
--                 move with no id, `f:` and its fields. server/sync/stock-merge.ts moveKey computes the same
--                 key (fourth review, R4: the first draft of this file backfilled the bare lowercase id, which
--                 nothing ever looks up, so an old move the display list had trimmed could apply a second time).
--   functions     sync_apply: one atomic multi-record compare-and-swap (the sync push's unit, below), with
--                 apply_stock_effect as its relative stock update; claim_invite (F5): claim a staff invite and
--                 create the membership in one call, with the staff limit inside it; the key functions.
--
-- Why functions and not several statements: production reaches Postgres through Supabase's transaction pooler,
-- so a client-side BEGIN ... COMMIT across several statements is not safe, and the existing sync code
-- deliberately uses one statement per atomic unit (server/sync/store.ts writeRecordIfUnchanged). The order
-- version and its stock effect span several rows (the order, the products, order_stock, stock_ops), which one
-- plain statement cannot guard as a unit under READ COMMITTED: each row's own check re-runs after a lock wait,
-- but a sibling CTE does not see the winner. A function call is still ONE statement for the pooler and runs in
-- its own transaction, and inside it every step sees fresh rows after taking the row locks. All decisions stay
-- in TypeScript (server/sync); the functions only lock, verify that what was read is still what is stored,
-- and write. A check that fails returns no row, nothing written, and the caller reads and decides again.
--
-- Deploy order: this migration first, then the orderat-sync function. It is safe against the currently
-- deployed code (nothing reads or writes these tables or calls these functions) and the new code needs
-- them. Idempotent by design, like 0001-0009: tables are CREATE ... IF NOT EXISTS, functions CREATE OR
-- REPLACE, the backfill only inserts what is missing. It has not been applied to any real database before
-- the fourth review, so it is corrected in place; a database that did run the first draft gets its bare
-- backfilled ids taken out below and the right keys put in.

create table if not exists orderat.order_stock (
  shop_id uuid not null references orderat.shops_cloud (id) on delete cascade,
  order_id text not null,
  product_id text not null,
  -- Whole units the server has taken out of the product's stock for this order. 0 is a real value ("taken
  -- and given back", or "nothing taken"): the row records that the server has accounted for the pair.
  units integer not null check (units >= 0),
  updated_at timestamptz not null default now(),
  primary key (shop_id, order_id, product_id)
);

create table if not exists orderat.stock_ops (
  shop_id uuid not null references orderat.shops_cloud (id) on delete cascade,
  -- A client stock move's key (orderat.stock_move_key; server/sync/stock-merge.ts moveKey): `id:<id>` with the
  -- ASCII capitals folded, or `f:[at,delta,reason,orderId]` for a move with no id.
  op_id text not null,
  product_id text null,
  -- applied: its delta changed the stock; ignored: the server owns that order's stock (it has a ledger) and
  -- never applies the client's copy of the move; listed: it was already in the product's stored list when the
  -- server rewrote that list (or when this migration ran), so it counts as applied.
  outcome text not null check (outcome in ('applied', 'ignored', 'listed')),
  created_at timestamptz not null default now(),
  primary key (shop_id, op_id)
);

alter table orderat.order_stock enable row level security;
alter table orderat.stock_ops enable row level security;

-- The key of a stock move: the ONE rule in SQL (server/sync/stock-merge.ts moveKey is the one in TypeScript, and
-- server/sync/stock-ops-keys.test.ts runs both on the same fixtures). An id is a string of at least one character; its
-- ASCII capitals are folded with translate() so the key never depends on the database's locale (lower() would
-- change non-ASCII letters in some locales, JavaScript's toLowerCase() in others). A move with no id is
-- identified by [at, delta, reason, orderId] as JSON, a field that is not a string or a number counting as null.
create or replace function orderat.stock_move_key_token(v jsonb)
returns text
language sql
immutable
as $fn$
  select case jsonb_typeof(v)
    when 'string' then to_json(v #>> '{}')::text
    when 'number' then v::text
    else 'null'
  end
$fn$;

create or replace function orderat.stock_move_key(move jsonb)
returns text
language sql
immutable
as $fn$
  select case
    when jsonb_typeof(move -> 'id') = 'string' and length(move ->> 'id') > 0
      then 'id:' || translate(move ->> 'id', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
    else 'f:[' || orderat.stock_move_key_token(move -> 'at')
      || ',' || orderat.stock_move_key_token(move -> 'delta')
      || ',' || orderat.stock_move_key_token(move -> 'reason')
      || ',' || orderat.stock_move_key_token(move -> 'orderId') || ']'
  end
$fn$;

-- Records every move in a product's stored list (`p_data` is the product record as it is stored now) in stock_ops, as
-- 'listed', unless it is there already. sync_apply calls it for every product whose record it replaces, before the
-- 50-entry list can lose a move (fourth review, R4).
create or replace function orderat.record_listed_moves(p_shop uuid, p_product_id text, p_data jsonb)
returns void
language sql
as $fn$
  insert into orderat.stock_ops (shop_id, op_id, product_id, outcome)
  select p_shop, orderat.stock_move_key(m.move), p_product_id, 'listed'
    from jsonb_array_elements(
           case when jsonb_typeof(p_data -> 'stockMoves') = 'array' then p_data -> 'stockMoves' else '[]'::jsonb end
         ) as m(move)
   where jsonb_typeof(m.move) = 'object'
  on conflict (shop_id, op_id) do nothing
$fn$;

-- Backfill: every move in a product's stored list is an applied move (the old server applied what it stored), keyed
-- exactly as the runtime computes it, with an id or without. Moves the old server had already trimmed off a list are not
-- recoverable; the new code also lists the moves of a product's stored list whenever it rewrites that list, which covers
-- the gap between this migration and the deploy. Nothing reads this table until the new code runs.
-- First, take out what the first draft of this migration listed: bare lowercase ids, which no key the runtime computes
-- can match (every one of its keys starts with `id:` or `f:[`).
delete from orderat.stock_ops
 where outcome = 'listed' and op_id not like 'id:%' and op_id not like 'f:[%';

insert into orderat.stock_ops (shop_id, op_id, product_id, outcome)
select r.shop_id, orderat.stock_move_key(m.move), r.id, 'listed'
  from orderat.records r
 cross join lateral jsonb_array_elements(
         case when jsonb_typeof(r.data->'stockMoves') = 'array' then r.data->'stockMoves' else '[]'::jsonb end
       ) as m(move)
 where r.entity = 'product'
   and jsonb_typeof(m.move) = 'object'
on conflict (shop_id, op_id) do nothing;

-- Same ownership dance as 0001-0009 (see 0001_orderat_isolation.sql's comments for the full reasoning).
grant orderat_app to current_user with set true, inherit true;
grant usage, create on schema orderat to orderat_app;

alter table orderat.order_stock owner to orderat_app;
alter table orderat.stock_ops owner to orderat_app;

revoke create on schema orderat from orderat_app;
grant usage on schema orderat to orderat_app;

-- order_stock: read, inserted and updated in place; stock_ops: read, inserted, and (only inside sync_apply, to take
-- back the rows of a write that lost a race) deleted.
grant select, insert, update on orderat.order_stock to orderat_app;
grant select, insert, delete on orderat.stock_ops to orderat_app;

revoke all on orderat.order_stock, orderat.stock_ops from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on orderat.order_stock, orderat.stock_ops from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on orderat.order_stock, orderat.stock_ops from authenticated';
  end if;
end
$$;

-- A product's quantity and stock history after the server moves it by `delta` for an order: the quantity
-- changes by delta (whatever it is now: a relative update), and the move `mv` goes first in the list, which
-- keeps its newest 50 (the cap the phones use). `qty` (the web's old name) is kept in step when present.
create or replace function orderat.apply_stock_effect(d jsonb, delta numeric, mv jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_qty numeric;
  v_moves jsonb;
  v_out jsonb;
begin
  v_qty := coalesce(
    case when jsonb_typeof(d->'stockQuantity') = 'number' then (d->>'stockQuantity')::numeric end,
    case when jsonb_typeof(d->'qty') = 'number' then (d->>'qty')::numeric end,
    0
  ) + delta;
  v_moves := case when jsonb_typeof(d->'stockMoves') = 'array' then d->'stockMoves' else '[]'::jsonb end;
  select coalesce(jsonb_agg(t.m order by t.ord), '[]'::jsonb) into v_moves
    from jsonb_array_elements(jsonb_build_array(mv) || v_moves) with ordinality as t(m, ord)
   where t.ord <= 50;
  v_out := jsonb_set(jsonb_set(d, '{stockQuantity}', to_jsonb(v_qty), true), '{stockMoves}', v_moves, true);
  if d ? 'qty' then
    v_out := jsonb_set(v_out, '{qty}', to_jsonb(v_qty), true);
  end if;
  return v_out;
end
$fn$;

-- The sync push's atomic unit (server/sync/store.ts writeAtomic). One record (`p_primary`) is written only
-- if it is still the version the caller decided on, together with its stock side effects:
--   p_primary      { entity, id, expect_seq (number, or null when the record must not exist yet), data, deleted }
--   p_deps         [ { entity, id, seq } ]  records the decision read but does not write (an order a product's
--                  stock move names): each must still have that seq.
--   p_effects      [ { product_id, order_id, delta, reason, at } ]  relative stock updates: each live product's
--                  quantity moves by delta and gets a server-made move whose id is derived from the order id,
--                  the primary's NEW seq and the product id, so it is the same for the same accepted version.
--                  A missing or deleted product is skipped.
--   p_order_stock  [ { order_id, product_id, expect (number or null = no row), units, write } ]  each row must
--                  still hold `expect`; `write` rows are set to `units`.
--   p_ops          [ { op_id, product_id, outcome } ]  stock_ops rows that must not exist yet, inserted.
--   p_listed       [ { op_id, product_id } ]  ids of moves already in the stored list, recorded if missing.
-- Locks come first, in one fixed order (orders before products, then by id; a product written by an effect is
-- locked too), so two writers cannot wait on each other. Anything that no longer matches returns no row and
-- writes nothing. Returns the primary record as stored.
--
-- Seqs (fourth review, R1): a phone applies a pull in seq order and an installed Android app keeps a null link for an
-- order line whose product it has not got yet, so when one write stores an order and the stock effects on its products
-- the PRODUCTS draw their new seqs first and the primary record (the order) its own last: a pull delivers the products
-- before the order. The server's move id is still derived from the primary's new seq (drawn up front), so it is unchanged.
-- Stock keys (R4): every move in the stored list of a product this call replaces (the primary, or an effect's target) is
-- recorded in stock_ops before the list can be trimmed, so a move the 50-entry list loses is still known.
create or replace function orderat.sync_apply(
  p_shop uuid,
  p_by uuid,
  p_primary jsonb,
  p_deps jsonb,
  p_effects jsonb,
  p_order_stock jsonb,
  p_ops jsonb,
  p_listed jsonb
) returns setof orderat.records
language plpgsql
as $fn$
declare
  v_entity text := p_primary->>'entity';
  v_id text := p_primary->>'id';
  v_expect bigint := case when jsonb_typeof(p_primary->'expect_seq') = 'number' then (p_primary->>'expect_seq')::bigint end;
  v_deleted boolean := coalesce((p_primary->>'deleted')::boolean, false);
  v_ref record;
  v_seq bigint;
  v_found boolean;
  v_row orderat.records;
  v_units integer;
  v_os record;
  v_op_count integer;
  v_inserted text[];
  v_effect record;
  v_move jsonb;
  v_effect_count integer;
  v_new_seq bigint;
  v_product_seqs bigint[] := '{}';
  v_n integer;
begin
  -- 1. Lock every record involved, in a fixed order, and check each is still the version that was decided on.
  for v_ref in
    select distinct r.entity, r.id, r.mode, r.seq
      from (
        select v_entity as entity, v_id as id, 'write'::text as mode, v_expect as seq
        union all
        select d->>'entity', d->>'id', 'dep', (d->>'seq')::bigint from jsonb_array_elements(p_deps) as d
        union all
        select 'product', e->>'product_id', 'effect', null::bigint from jsonb_array_elements(p_effects) as e
      ) as r
     order by r.entity, r.id, r.mode
  loop
    if v_ref.mode = 'dep' then
      select rec.seq into v_seq from orderat.records rec
       where rec.shop_id = p_shop and rec.entity = v_ref.entity and rec.id = v_ref.id for share;
      v_found := found;
      if not v_found or v_seq <> v_ref.seq then return; end if;
    else
      select rec.seq into v_seq from orderat.records rec
       where rec.shop_id = p_shop and rec.entity = v_ref.entity and rec.id = v_ref.id for update;
      v_found := found;
      if v_ref.mode = 'write' then
        if v_expect is null and v_found then return; end if;
        if v_expect is not null and (not v_found or v_seq <> v_expect) then return; end if;
      end if;
    end if;
  end loop;

  -- 2. The order_stock rows read must still hold what was read.
  for v_os in
    select o->>'order_id' as order_id, o->>'product_id' as product_id,
           case when jsonb_typeof(o->'expect') = 'number' then (o->>'expect')::integer end as expect
      from jsonb_array_elements(p_order_stock) as o
     order by 1, 2
  loop
    select s.units into v_units from orderat.order_stock s
     where s.shop_id = p_shop and s.order_id = v_os.order_id and s.product_id = v_os.product_id for update;
    if found then
      if v_os.expect is null or v_os.expect <> v_units then return; end if;
    elsif v_os.expect is not null then
      return;
    end if;
  end loop;

  -- 3. The stock_ops rows must not exist yet: insert them first, and take them back if one did meanwhile.
  select count(*) into v_op_count from jsonb_array_elements(p_ops);
  if v_op_count > 0 then
    with ins as (
      insert into orderat.stock_ops (shop_id, op_id, product_id, outcome)
      select p_shop, o->>'op_id', o->>'product_id', o->>'outcome' from jsonb_array_elements(p_ops) as o
      on conflict (shop_id, op_id) do nothing
      returning op_id
    )
    select array_agg(ins.op_id) into v_inserted from ins;
    if coalesce(cardinality(v_inserted), 0) <> v_op_count then
      delete from orderat.stock_ops where shop_id = p_shop and op_id = any(coalesce(v_inserted, '{}'::text[]));
      return;
    end if;
  end if;

  -- 4. Draw the seqs: one for each product an effect moves, then the primary's own, which is the highest (R1).
  select count(*) into v_effect_count from jsonb_array_elements(p_effects);
  for v_n in 1..v_effect_count loop
    v_product_seqs[v_n] := nextval(pg_get_serial_sequence('orderat.records', 'seq'));
  end loop;
  v_new_seq := nextval(pg_get_serial_sequence('orderat.records', 'seq'));

  -- 5. A product this call replaces: the moves its stored list holds now are recorded before the list changes (R4).
  if v_entity = 'product' and v_expect is not null then
    perform orderat.record_listed_moves(
      p_shop, v_id,
      (select rec.data from orderat.records rec where rec.shop_id = p_shop and rec.entity = 'product' and rec.id = v_id)
    );
  end if;

  -- 6. The primary record.
  if v_expect is null then
    insert into orderat.records (shop_id, entity, id, data, deleted, updated_by, updated_at, seq)
    values (p_shop, v_entity, v_id, p_primary->'data', v_deleted, p_by, now(), v_new_seq)
    on conflict (shop_id, entity, id) do nothing
    returning * into v_row;
    if v_row.id is null then
      delete from orderat.stock_ops where shop_id = p_shop and op_id = any(coalesce(v_inserted, '{}'::text[]));
      return;
    end if;
  else
    update orderat.records rec
       set data = p_primary->'data',
           deleted = v_deleted,
           updated_by = p_by,
           updated_at = now(),
           seq = v_new_seq
     where rec.shop_id = p_shop and rec.entity = v_entity and rec.id = v_id and rec.seq = v_expect
    returning * into v_row;
    if v_row.id is null then
      delete from orderat.stock_ops where shop_id = p_shop and op_id = any(coalesce(v_inserted, '{}'::text[]));
      return;
    end if;
  end if;

  -- 7. Stock effects: a relative update of each live product, with a server-made move.
  v_n := 0;
  for v_effect in
    select e->>'product_id' as product_id, e->>'order_id' as order_id, (e->>'delta')::numeric as delta,
           e->>'reason' as reason, e->>'at' as moved_at
      from jsonb_array_elements(p_effects) as e
     order by 1
  loop
    v_n := v_n + 1;
    v_move := jsonb_build_object(
      'id', md5(v_effect.order_id || ':' || v_row.seq::text || ':' || v_effect.product_id)::uuid::text,
      'delta', v_effect.delta,
      'reason', v_effect.reason,
      'orderId', v_effect.order_id,
      'note', null,
      'at', v_effect.moved_at
    );
    -- R4: the moves the list holds now are known before the new move can push the oldest off it.
    perform orderat.record_listed_moves(
      p_shop, v_effect.product_id,
      (select rec.data from orderat.records rec
        where rec.shop_id = p_shop and rec.entity = 'product' and rec.id = v_effect.product_id and not rec.deleted)
    );
    update orderat.records rec
       set data = orderat.apply_stock_effect(rec.data, v_effect.delta, v_move),
           updated_by = p_by,
           updated_at = now(),
           seq = v_product_seqs[v_n]
     where rec.shop_id = p_shop and rec.entity = 'product' and rec.id = v_effect.product_id and not rec.deleted;
    if found then
      -- The server's own move is an applied move: a phone that pulled it and pushes it back (in its list, however
      -- much later, even after the 50-entry list has dropped it) is never applied a second time.
      insert into orderat.stock_ops (shop_id, op_id, product_id, outcome)
      values (p_shop, orderat.stock_move_key(v_move), v_effect.product_id, 'applied')
      on conflict (shop_id, op_id) do nothing;
    end if;
  end loop;

  -- 8. The applied allocations.
  insert into orderat.order_stock (shop_id, order_id, product_id, units, updated_at)
  select p_shop, o->>'order_id', o->>'product_id', (o->>'units')::integer, now()
    from jsonb_array_elements(p_order_stock) as o
   where coalesce((o->>'write')::boolean, false)
  on conflict (shop_id, order_id, product_id) do update set units = excluded.units, updated_at = now();

  -- 9. Moves already in the stored list count as applied (best effort: never a reason to refuse the write).
  insert into orderat.stock_ops (shop_id, op_id, product_id, outcome)
  select p_shop, o->>'op_id', o->>'product_id', 'listed' from jsonb_array_elements(p_listed) as o
  on conflict (shop_id, op_id) do nothing;

  return next v_row;
  return;
end
$fn$;

-- F5: claim a staff invite and create the membership in one call. The invite row is locked (a second
-- account racing for the same code waits, then finds it used and gets "invalid"), and the shop row is locked
-- (no key update, so an invite_create's foreign key check is not held up) while the staff count is read, so
-- two accounts holding two different invites cannot both take the last seat. An invite is consumed only by a
-- join that goes through, or by someone who is already a member of the shop (as before); a join refused for
-- the staff limit leaves it unused. Returns { outcome, shopId?, role?, permissions? } where outcome is one of
-- invalid, staff_limit, already_member, joined.
create or replace function orderat.claim_invite(
  p_code_hash text,
  p_user uuid,
  p_now timestamptz,
  p_permissions jsonb,
  p_max_staff integer
) returns jsonb
language plpgsql
as $fn$
declare
  v_invite orderat.invites;
  v_member orderat.shop_members;
  v_staff integer;
begin
  select i.* into v_invite from orderat.invites i
   where i.code_hash = p_code_hash and i.used_at is null and i.expires_at > p_now
   order by i.created_at desc
   limit 1
     for update;
  if v_invite.id is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  perform 1 from orderat.shops_cloud s where s.id = v_invite.shop_id for no key update;

  select m.* into v_member from orderat.shop_members m where m.shop_id = v_invite.shop_id and m.user_id = p_user;
  if v_member.user_id is not null then
    update orderat.invites set used_at = p_now, used_by_user_id = p_user where id = v_invite.id;
    return jsonb_build_object('outcome', 'already_member', 'shopId', v_invite.shop_id, 'role', v_member.role, 'permissions', v_member.permissions);
  end if;

  select count(*) into v_staff from orderat.shop_members m where m.shop_id = v_invite.shop_id and m.role = 'staff';
  if v_staff >= p_max_staff then
    return jsonb_build_object('outcome', 'staff_limit');
  end if;

  insert into orderat.shop_members (shop_id, user_id, role, permissions)
  values (v_invite.shop_id, p_user, 'staff', p_permissions);
  update orderat.invites set used_at = p_now, used_by_user_id = p_user where id = v_invite.id;
  return jsonb_build_object('outcome', 'joined', 'shopId', v_invite.shop_id, 'role', 'staff', 'permissions', p_permissions);
end
$fn$;

-- Functions run with the caller's own privileges (the default, SECURITY INVOKER): orderat_app already holds
-- exactly the table privileges these need. Only orderat_app may call them.
revoke all on function orderat.stock_move_key_token(jsonb) from public;
revoke all on function orderat.stock_move_key(jsonb) from public;
revoke all on function orderat.record_listed_moves(uuid, text, jsonb) from public;
revoke all on function orderat.apply_stock_effect(jsonb, numeric, jsonb) from public;
revoke all on function orderat.sync_apply(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function orderat.claim_invite(text, uuid, timestamptz, jsonb, integer) from public;
grant execute on function orderat.stock_move_key_token(jsonb) to orderat_app;
grant execute on function orderat.stock_move_key(jsonb) to orderat_app;
grant execute on function orderat.record_listed_moves(uuid, text, jsonb) to orderat_app;
grant execute on function orderat.apply_stock_effect(jsonb, numeric, jsonb) to orderat_app;
grant execute on function orderat.sync_apply(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to orderat_app;
grant execute on function orderat.claim_invite(text, uuid, timestamptz, jsonb, integer) to orderat_app;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function orderat.stock_move_key_token(jsonb) from anon';
    execute 'revoke all on function orderat.stock_move_key(jsonb) from anon';
    execute 'revoke all on function orderat.record_listed_moves(uuid, text, jsonb) from anon';
    execute 'revoke all on function orderat.apply_stock_effect(jsonb, numeric, jsonb) from anon';
    execute 'revoke all on function orderat.sync_apply(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from anon';
    execute 'revoke all on function orderat.claim_invite(text, uuid, timestamptz, jsonb, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function orderat.stock_move_key_token(jsonb) from authenticated';
    execute 'revoke all on function orderat.stock_move_key(jsonb) from authenticated';
    execute 'revoke all on function orderat.record_listed_moves(uuid, text, jsonb) from authenticated';
    execute 'revoke all on function orderat.apply_stock_effect(jsonb, numeric, jsonb) from authenticated';
    execute 'revoke all on function orderat.sync_apply(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from authenticated';
    execute 'revoke all on function orderat.claim_invite(text, uuid, timestamptz, jsonb, integer) from authenticated';
  end if;
end
$$;
