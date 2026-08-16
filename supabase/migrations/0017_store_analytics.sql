-- ------------------------------------------------------------
-- 0017 — Storefront analytics (visitors + conversion)
--
-- The Executive Command Center needs two numbers the platform did not yet
-- measure: how many people VISIT a storefront, and what fraction of them BUY
-- (conversion). This adds a lightweight, cookieless, anonymised pageview log
-- and two aggregate RPCs the dashboard reads.
--
--   • store_visits          — one row per storefront pageview (anonymised)
--   • store_visit_summary   — per-store distinct-visitor windows (today/yesterday/7d)
--   • dashboard_store_stats — per-store sales + traffic in one query (the KPI engine)
--
-- Privacy by design (DSGVO): we store a random per-session id (from the
-- browser's sessionStorage, NOT a cookie and NOT derived from IP), a coarse
-- device class and the referrer host only. No IP, no user agent string, no PII.
-- Writes happen through the service role (the /api/track beacon); owners read
-- only their own stores' rows.
-- ------------------------------------------------------------

create table public.store_visits (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores (id) on delete cascade,
    session_hash text not null,                       -- anonymous per-session id (no PII)
    path text,
    referrer_host text,
    device text not null default 'unknown'
        check (device in ('mobile', 'tablet', 'desktop', 'unknown')),
    created_at timestamptz not null default now()
);

create index idx_store_visits_store_time on public.store_visits (store_id, created_at desc);
create index idx_store_visits_session on public.store_visits (store_id, session_hash);

alter table public.store_visits enable row level security;

-- Owners read their own stores' traffic; nobody writes from a client role
-- (the beacon inserts via the service role, which bypasses RLS).
create policy "store_visits: owner read" on public.store_visits
    for select using (
        exists (
            select 1 from public.stores s
            where s.id = store_visits.store_id and s.user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- Per-store distinct-visitor windows. Distinct counting belongs in SQL so we
-- never ship raw visit rows to the app. UTC day boundaries (documented).
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
    left join public.store_visits v on v.store_id = s.id
    group by s.id;
$$;

-- ------------------------------------------------------------
-- The KPI engine: per-store sales + traffic in a single round-trip. Revenue
-- counts paid + fulfilled orders (refunded/cancelled excluded). All money in
-- cents. UTC day boundaries.
-- ------------------------------------------------------------
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
        coalesce(o.revenue_today_cents, 0),
        coalesce(o.revenue_yesterday_cents, 0),
        coalesce(o.revenue_7d_cents, 0),
        coalesce(o.revenue_prev7d_cents, 0),
        coalesce(o.revenue_total_cents, 0),
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
            sum(ord.amount_total) filter (where paid and ord.created_at >= b.d0)                                                    as revenue_today_cents,
            sum(ord.amount_total) filter (where paid and ord.created_at >= b.d0 - interval '1 day' and ord.created_at < b.d0)        as revenue_yesterday_cents,
            sum(ord.amount_total) filter (where paid and ord.created_at >= b.d0 - interval '6 days')                                 as revenue_7d_cents,
            sum(ord.amount_total) filter (where paid and ord.created_at >= b.d0 - interval '13 days' and ord.created_at < b.d0 - interval '6 days') as revenue_prev7d_cents,
            sum(ord.amount_total) filter (where paid)                                                                                as revenue_total_cents,
            count(*) filter (where paid and ord.created_at >= b.d0)                                                                  as orders_today,
            count(*) filter (where paid and ord.created_at >= b.d0 - interval '1 day' and ord.created_at < b.d0)                     as orders_yesterday,
            count(*) filter (where paid and ord.created_at >= b.d0 - interval '6 days')                                              as orders_7d,
            count(*) filter (where paid)                                                                                             as orders_total
        from (
            select amount_total, created_at, (status in ('paid', 'fulfilled')) as paid
            from public.orders where store_id = s.id
        ) ord
    ) o on true
    left join lateral (
        select
            count(distinct vv.session_hash) filter (where vv.created_at >= b.d0)                                                     as visitors_today,
            count(distinct vv.session_hash) filter (where vv.created_at >= b.d0 - interval '1 day' and vv.created_at < b.d0)         as visitors_yesterday,
            count(distinct vv.session_hash) filter (where vv.created_at >= b.d0 - interval '6 days')                                 as visitors_7d,
            count(*) filter (where vv.created_at >= b.d0)                                                                            as views_today
        from public.store_visits vv where vv.store_id = s.id
    ) v on true;
$$;

revoke execute on function public.store_visit_summary(uuid[]) from public, anon, authenticated;
revoke execute on function public.dashboard_store_stats(uuid[]) from public, anon, authenticated;
grant execute on function public.store_visit_summary(uuid[]) to service_role;
grant execute on function public.dashboard_store_stats(uuid[]) to service_role;
