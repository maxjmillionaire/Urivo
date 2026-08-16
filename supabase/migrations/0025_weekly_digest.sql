-- ------------------------------------------------------------
-- 0025 — Weekly business digest (server-side aggregation)
--
-- The weekly merchant digest reads one aggregated row per active merchant
-- instead of fanning out N queries per user. Aggregating in Postgres keeps the
-- weekly job a single bounded round-trip as the tenant base grows.
--
-- Audience: merchants with at least one store (the digest is a *business*
-- summary — an account with no store gets onboarding nudges elsewhere, not a
-- digest). All numbers are platform-owned signals; order/revenue figures read
-- existing rows and degrade to zero cleanly before the first sale.
--
-- SECURITY DEFINER, reachable only from the service role — the cron route gates
-- it behind a shared secret before ever calling.
-- ------------------------------------------------------------

create or replace function public.weekly_digest_data()
returns table (
    user_id uuid,
    email text,
    full_name text,
    credit_balance integer,
    credits_expiring_amount integer,
    credits_expiring_at timestamptz,
    stores_total integer,
    stores_live integer,
    stores_new integer,
    products_total integer,
    orders_week integer,
    revenue_week_cents bigint,
    orders_total integer,
    revenue_total_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with since as (select now() - interval '7 days' as ts)
    select
        p.id                                             as user_id,
        p.email,
        p.full_name,
        public.credit_balance(p.id)                      as credit_balance,
        coalesce(ce.amount, 0)                           as credits_expiring_amount,
        ce.expires_at                                    as credits_expiring_at,
        s.stores_total,
        s.stores_live,
        s.stores_new,
        coalesce(pr.products_total, 0)                   as products_total,
        coalesce(o.orders_week, 0)                       as orders_week,
        coalesce(o.revenue_week_cents, 0)                as revenue_week_cents,
        coalesce(o.orders_total, 0)                      as orders_total,
        coalesce(o.revenue_total_cents, 0)               as revenue_total_cents
    from public.profiles p
    -- Store counts (also the audience gate: inner join drops storeless accounts).
    join lateral (
        select
            count(*)::int                                                   as stores_total,
            count(*) filter (where st.is_active)::int                       as stores_live,
            count(*) filter (where st.created_at >= (select ts from since))::int as stores_new
        from public.stores st
        where st.user_id = p.id
    ) s on s.stores_total > 0
    -- Product count across the merchant's stores.
    left join lateral (
        select count(*)::int as products_total
        from public.products prd
        join public.stores st2 on st2.id = prd.store_id
        where st2.user_id = p.id
    ) pr on true
    -- Order + revenue rollup (paid or fulfilled), this week and lifetime.
    left join lateral (
        select
            count(*) filter (
                where ord.status in ('paid', 'fulfilled')
                  and ord.created_at >= (select ts from since)
            )::int as orders_week,
            coalesce(sum(ord.amount_total) filter (
                where ord.status in ('paid', 'fulfilled')
                  and ord.created_at >= (select ts from since)
            ), 0)::bigint as revenue_week_cents,
            count(*) filter (
                where ord.status in ('paid', 'fulfilled')
            )::int as orders_total,
            coalesce(sum(ord.amount_total) filter (
                where ord.status in ('paid', 'fulfilled')
            ), 0)::bigint as revenue_total_cents
        from public.orders ord
        join public.stores st3 on st3.id = ord.store_id
        where st3.user_id = p.id
    ) o on true
    -- Soonest upcoming plan-credit expiry (use-it-or-lose-it), if any.
    left join lateral (
        select amount, expires_at
        from public.credit_expiry_summary(p.id)
        limit 1
    ) ce on true
    order by revenue_week_cents desc, stores_total desc;
$$;

revoke execute on function public.weekly_digest_data() from public, anon, authenticated;
grant execute on function public.weekly_digest_data() to service_role;
