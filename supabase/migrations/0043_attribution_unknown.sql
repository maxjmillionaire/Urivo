-- ------------------------------------------------------------
-- 0043 — KNOWN NONE and UNKNOWN are not the same state
--
-- Until now an order that was never attributed and an order determined to
-- have no ad behind it were both 'none'. They are different facts:
--
--   'none'    — we looked, and this sale did not come from an ad.
--   'unknown' — we did not look, or looking failed. We do not know.
--
-- Collapsing them made every attribution failure invisible. The 42804 raised
-- by 0039 left orders sitting at the column default, 'none', which reads as a
-- confident answer; the coverage panel then reported that revenue as direct
-- traffic the merchant never bought. A dashboard cannot be honest if the
-- schema cannot express uncertainty.
--
-- The default is now 'unknown'. An order starts out un-assessed, and only a
-- successful run of attribute_order can move it to a decided state. That
-- inverts the failure mode: a broken attribution path now shows up as growing
-- 'unknown' revenue rather than silently inflating 'direct'.
-- ------------------------------------------------------------

alter type public.attribution_basis add value if not exists 'unknown';

-- Committed before the new enum label is used below: PostgreSQL cannot use a
-- value added by ALTER TYPE in the same transaction that added it.
commit;

alter table public.orders
    alter column attribution_basis set default 'unknown'::public.attribution_basis;

comment on column public.orders.attribution_basis is
    'Why this order carries the attribution it carries. ''unknown'' means not yet assessed or assessment failed — never treat it as ''none''. See specifications/10-attribution.md.';

-- ------------------------------------------------------------
-- Coverage gains the bucket, or the reconciliation hides it
--
-- Spec §16.4 requires the buckets to sum to the total. Adding a state without
-- adding its bucket would have broken that sum loudly — which is the designed
-- behaviour, and exactly why the SQL names every basis explicitly rather than
-- sweeping the remainder into an else.
-- ------------------------------------------------------------
create or replace function public.attribution_coverage(p_store_id uuid, p_days integer default 30)
returns table (
    attributed_orders   integer,
    attributed_cents    integer,
    returning_orders    integer,
    returning_cents     integer,
    expired_orders      integer,
    expired_cents       integer,
    unattributed_orders integer,
    unattributed_cents  integer,
    -- Not assessed, or assessment failed. Never folded into any other bucket:
    -- this is the number that makes a broken attribution path visible.
    unknown_orders      integer,
    unknown_cents       integer,
    total_orders        integer,
    total_cents         integer
)
language sql
stable
security definer
set search_path = public
as $$
    with paid as (
        select o.attribution_basis as basis,
               (o.amount_total - coalesce(o.amount_refunded, 0)) as net
        from public.orders o
        where o.store_id = p_store_id
          and o.status in ('paid', 'fulfilled')
          and o.created_at >= now() - make_interval(days => greatest(p_days, 1))
    )
    select
        coalesce(count(*) filter (where basis = 'creative'), 0)::integer,
        coalesce(sum(net) filter (where basis = 'creative'), 0)::integer,
        coalesce(count(*) filter (where basis = 'returning'), 0)::integer,
        coalesce(sum(net) filter (where basis = 'returning'), 0)::integer,
        coalesce(count(*) filter (where basis = 'expired'), 0)::integer,
        coalesce(sum(net) filter (where basis = 'expired'), 0)::integer,
        coalesce(count(*) filter (where basis = 'none'), 0)::integer,
        coalesce(sum(net) filter (where basis = 'none'), 0)::integer,
        coalesce(count(*) filter (where basis = 'unknown'), 0)::integer,
        coalesce(sum(net) filter (where basis = 'unknown'), 0)::integer,
        coalesce(count(*), 0)::integer,
        coalesce(sum(net), 0)::integer
    from paid;
$$;

revoke execute on function public.attribution_coverage(uuid, integer) from public, anon;
grant execute on function public.attribution_coverage(uuid, integer) to authenticated, service_role;

-- ------------------------------------------------------------
-- attribute_order: 'unknown' is never a decided answer
--
-- Only the first-write-wins guard changes. It previously treated anything
-- other than 'none' as already decided; 'unknown' must remain re-attemptable,
-- or a transient failure would freeze an order as permanently un-assessed.
-- ------------------------------------------------------------
create or replace function public.attribute_order(p_order_id uuid, p_session_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_creative uuid;
    v_store    uuid;
    v_email    text;
    v_placed   timestamptz;
    v_existing public.attribution_basis;
    v_basis    public.attribution_basis;
begin
    select store_id, lower(btrim(customer_email)), created_at, attribution_basis
      into v_store, v_email, v_placed, v_existing
      from public.orders
     where id = p_order_id;

    if v_store is null then
        return null;
    end if;

    /*
     * First write wins for any DECIDED state (§8) — a Stripe retry must never
     * rewrite a decision the merchant has already read. 'unknown' is not a
     * decision, so a retry after a failure is allowed to settle it.
     */
    if v_existing is not null and v_existing not in ('none', 'unknown') then
        return (select creative_id from public.orders where id = p_order_id);
    end if;
    if v_existing = 'none' then
        return null;
    end if;

    if v_email is not null and length(v_email) > 0 and exists (
        select 1 from public.orders o
         where o.store_id = v_store
           and o.id <> p_order_id
           and lower(btrim(o.customer_email)) = v_email
           and o.status in ('paid', 'fulfilled', 'refunded')
           and o.created_at < v_placed
    ) then
        update public.orders
           set attribution_basis = 'returning'::public.attribution_basis,
               session_hash      = coalesce(p_session_hash, session_hash),
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        /*
         * No session at all. This IS a decided answer: the checkout carried no
         * commerce session, so there is no click to find. Distinct from never
         * having run — which leaves the row at 'unknown'.
         */
        update public.orders
           set attribution_basis = 'none'::public.attribution_basis,
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    select v.creative_id into v_creative
      from public.store_visits v
      join public.ad_creatives c on c.id = v.creative_id
     where v.session_hash = p_session_hash
       and v.store_id     = v_store
       and c.store_id     = v_store
       and v.is_bot       = false
       and v.created_at  >= v_placed - public.attribution_window()
       and v.created_at  <= v_placed
     order by v.created_at asc
     limit 1;

    if v_creative is not null then
        update public.orders
           set creative_id       = v_creative,
               session_hash      = p_session_hash,
               attribution_basis = 'creative'::public.attribution_basis,
               attributed_at     = now()
         where id = p_order_id;
        return v_creative;
    end if;

    -- 'expired' only for this store's own ad, clicked outside the window (§5).
    if exists (
        select 1
          from public.store_visits v
          join public.ad_creatives c on c.id = v.creative_id
         where v.session_hash = p_session_hash
           and v.store_id     = v_store
           and c.store_id     = v_store
           and v.is_bot       = false
    ) then
        v_basis := 'expired'::public.attribution_basis;
    else
        v_basis := 'none'::public.attribution_basis;
    end if;

    update public.orders
       set session_hash      = p_session_hash,
           attribution_basis = v_basis,
           attributed_at     = now()
     where id = p_order_id;

    return null;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;
