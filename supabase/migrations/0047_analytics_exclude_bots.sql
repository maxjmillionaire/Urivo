-- ------------------------------------------------------------
-- 0047 — "Visitors" must mean people
--
-- store_visits gained an is_bot column in 0039, and every attribution function
-- written since filters on it: attribute_order, the coverage report and the
-- creative rollups all count `v.is_bot = false`. The two functions the MERCHANT
-- actually reads did not, because they were written in 0017, two years of
-- migrations before the column existed.
--
-- So the product held two different definitions of "a visitor" at once, and the
-- dashboard used the wrong one. A crawler hitting a storefront raised
-- "Visitors today" and, because conversion is orders ÷ visitors, quietly pushed
-- the merchant's conversion rate DOWN. That is the number Urivo tells them to
-- steer by, on the screen it puts in front of them first — and it was being
-- diluted by traffic that was never going to buy anything.
--
-- Verified on a real database before this migration: three visits, one of them
-- flagged is_bot, returned visitors_today = 3 from both functions while the
-- attribution side counted 2.
--
-- Both functions are recreated verbatim apart from the predicate, so the shape,
-- the grants and the UTC day boundaries are unchanged.
-- ------------------------------------------------------------

create or replace function public.store_visit_summary(p_store_ids uuid[])
returns table (
    store_id uuid,
    visitors_today bigint,
    visitors_yesterday bigint,
    visitors_7d bigint,
    views_today bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with b as (select date_trunc('day', now()) as d0)
    select s.id,
        count(distinct v.session_hash) filter (where v.created_at >= b.d0),
        count(distinct v.session_hash) filter (where v.created_at >= b.d0 - interval '1 day' and v.created_at < b.d0),
        count(distinct v.session_hash) filter (where v.created_at >= b.d0 - interval '6 days'),
        count(*) filter (where v.created_at >= b.d0)
    from unnest(p_store_ids) as s(id)
    cross join b
    -- The predicate lives in the JOIN, not a WHERE: a store with only bot
    -- traffic must still return a row of zeroes rather than disappear from the
    -- dashboard entirely.
    left join public.store_visits v
           on v.store_id = s.id
          and v.is_bot = false
    group by s.id;
$$;

create or replace function public.dashboard_store_stats(p_store_ids uuid[])
returns table (
    store_id uuid,
    revenue_today_cents bigint,
    revenue_yesterday_cents bigint,
    revenue_7d_cents bigint,
    revenue_prev7d_cents bigint,
    revenue_total_cents bigint,
    orders_today bigint,
    orders_yesterday bigint,
    orders_7d bigint,
    orders_total bigint,
    visitors_today bigint,
    visitors_yesterday bigint,
    visitors_7d bigint,
    views_today bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with b as (select date_trunc('day', now()) as d0)
    select
        s.id,
        coalesce(o.revenue_today, 0),
        coalesce(o.revenue_yesterday, 0),
        coalesce(o.revenue_7d, 0),
        coalesce(o.revenue_prev7d, 0),
        coalesce(o.revenue_total, 0),
        coalesce(o.orders_today, 0),
        coalesce(o.orders_yesterday, 0),
        coalesce(o.orders_7d, 0),
        coalesce(o.orders_total, 0),
        coalesce(v.visitors_today, 0),
        coalesce(v.visitors_yesterday, 0),
        coalesce(v.visitors_7d, 0),
        coalesce(v.views_today, 0)
    from unnest(p_store_ids) as s(id)
    cross join b
    left join lateral (
        select
            sum(oo.amount_total) filter (where oo.created_at >= b.d0)                                                          as revenue_today,
            sum(oo.amount_total) filter (where oo.created_at >= b.d0 - interval '1 day' and oo.created_at < b.d0)              as revenue_yesterday,
            sum(oo.amount_total) filter (where oo.created_at >= b.d0 - interval '6 days')                                      as revenue_7d,
            sum(oo.amount_total) filter (where oo.created_at >= b.d0 - interval '13 days' and oo.created_at < b.d0 - interval '6 days') as revenue_prev7d,
            sum(oo.amount_total)                                                                                               as revenue_total,
            count(*) filter (where oo.created_at >= b.d0)                                                                      as orders_today,
            count(*) filter (where oo.created_at >= b.d0 - interval '1 day' and oo.created_at < b.d0)                          as orders_yesterday,
            count(*) filter (where oo.created_at >= b.d0 - interval '6 days')                                                  as orders_7d,
            count(*)                                                                                                           as orders_total
        from public.orders oo
        where oo.store_id = s.id and oo.status in ('paid', 'fulfilled')
    ) o on true
    left join lateral (
        select
            count(distinct vv.session_hash) filter (where vv.created_at >= b.d0)                                                     as visitors_today,
            count(distinct vv.session_hash) filter (where vv.created_at >= b.d0 - interval '1 day' and vv.created_at < b.d0)         as visitors_yesterday,
            count(distinct vv.session_hash) filter (where vv.created_at >= b.d0 - interval '6 days')                                 as visitors_7d,
            count(*) filter (where vv.created_at >= b.d0)                                                                            as views_today
        from public.store_visits vv
        where vv.store_id = s.id
          and vv.is_bot = false
    ) v on true;
$$;

revoke execute on function public.store_visit_summary(uuid[]) from public, anon;
revoke execute on function public.dashboard_store_stats(uuid[]) from public, anon;
grant execute on function public.store_visit_summary(uuid[]) to service_role;
grant execute on function public.dashboard_store_stats(uuid[]) to service_role;

comment on function public.dashboard_store_stats(uuid[]) is
    'Per-store sales + human traffic in one round-trip. Bots excluded (0047).';
comment on function public.store_visit_summary(uuid[]) is
    'Per-store human visitor counts. Bots excluded (0047).';
