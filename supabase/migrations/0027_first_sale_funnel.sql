-- ------------------------------------------------------------
-- 0027 — First-sale instrumentation
--
-- The metric the business is steered by: what share of merchants make a real
-- sale after publishing, and how long it takes them. Everything downstream —
-- churn, LTV, word of mouth, whether the product works at all — is decided by
-- this number, and it was previously unmeasurable: stores carried is_active
-- (a boolean) with no record of WHEN they first went live.
--
-- published_at records the FIRST time a store goes live and is never reset.
-- Unpublishing and republishing does not restart the clock — the question is
-- "how long from a merchant first opening their doors to their first sale",
-- and a later toggle doesn't change when the doors first opened.
-- ------------------------------------------------------------

alter table public.stores
    add column if not exists published_at timestamptz;

comment on column public.stores.published_at is
    'First time this store went live. Set once, never reset. Basis for the first-sale funnel.';

-- Backfill: stores already live are treated as published when they were created,
-- which is true for every store generated on a plan that can publish.
update public.stores
set published_at = created_at
where is_active = true and published_at is null;

create index if not exists idx_stores_published_at
    on public.stores (published_at)
    where published_at is not null;

-- ------------------------------------------------------------
-- Stamp published_at in the database rather than the API layer, so it is
-- recorded no matter which path publishes a store — the theme editor, the
-- generation pipeline, an admin fix, or a manual SQL update.
-- ------------------------------------------------------------
create or replace function public.stamp_published_at()
returns trigger
language plpgsql
as $$
begin
    if new.is_active and new.published_at is null then
        new.published_at := now();
    end if;
    return new;
end $$;

drop trigger if exists trg_stores_stamp_published_at on public.stores;
create trigger trg_stores_stamp_published_at
    before insert or update of is_active on public.stores
    for each row
    execute function public.stamp_published_at();

-- ------------------------------------------------------------
-- The funnel itself. One row: how many merchants opened, how many sold, how
-- fast. Counted on PAID or FULFILLED orders only — a pending checkout is not
-- a sale.
-- ------------------------------------------------------------
create or replace function public.first_sale_funnel(p_since timestamptz default '-infinity')
returns table (
    stores_published integer,
    stores_with_sale integer,
    first_sale_rate numeric,
    sold_within_7d integer,
    sold_within_30d integer,
    sold_within_90d integer,
    rate_within_30d numeric,
    median_days_to_first_sale numeric,
    avg_days_to_first_sale numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with published as (
        select id, published_at
        from public.stores
        where published_at is not null and published_at >= p_since
    ),
    first_sale as (
        select p.id,
               p.published_at,
               min(o.created_at) as first_order_at
        from published p
        left join public.orders o
               on o.store_id = p.id
              and o.status in ('paid', 'fulfilled')
        group by p.id, p.published_at
    ),
    timed as (
        select *,
               case when first_order_at is not null
                    then extract(epoch from (first_order_at - published_at)) / 86400.0
               end as days_to_first_sale
        from first_sale
    )
    select
        count(*)::int                                                              as stores_published,
        count(first_order_at)::int                                                 as stores_with_sale,
        round(100.0 * count(first_order_at) / nullif(count(*), 0), 1)              as first_sale_rate,
        count(*) filter (where days_to_first_sale <= 7)::int                       as sold_within_7d,
        count(*) filter (where days_to_first_sale <= 30)::int                      as sold_within_30d,
        count(*) filter (where days_to_first_sale <= 90)::int                      as sold_within_90d,
        round(100.0 * count(*) filter (where days_to_first_sale <= 30)
              / nullif(count(*), 0), 1)                                            as rate_within_30d,
        round(percentile_cont(0.5) within group (order by days_to_first_sale)::numeric, 1)
                                                                                   as median_days_to_first_sale,
        round(avg(days_to_first_sale)::numeric, 1)                                 as avg_days_to_first_sale
    from timed;
$$;

revoke execute on function public.first_sale_funnel(timestamptz) from public, anon, authenticated;
grant execute on function public.first_sale_funnel(timestamptz) to service_role;

-- ------------------------------------------------------------
-- The same question by publish cohort. A single blended rate hides whether the
-- product is getting better or worse — the cohort curve is what tells you
-- whether a change actually worked.
-- ------------------------------------------------------------
create or replace function public.first_sale_cohorts(p_weeks integer default 12)
returns table (
    cohort_week date,
    stores_published integer,
    stores_with_sale integer,
    first_sale_rate numeric,
    median_days_to_first_sale numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with published as (
        select id,
               published_at,
               date_trunc('week', published_at)::date as cohort_week
        from public.stores
        where published_at is not null
          and published_at >= now() - (p_weeks || ' weeks')::interval
    ),
    timed as (
        select p.cohort_week,
               min(o.created_at) as first_order_at,
               p.published_at,
               case when min(o.created_at) is not null
                    then extract(epoch from (min(o.created_at) - p.published_at)) / 86400.0
               end as days_to_first_sale
        from published p
        left join public.orders o
               on o.store_id = p.id
              and o.status in ('paid', 'fulfilled')
        group by p.id, p.cohort_week, p.published_at
    )
    select
        cohort_week,
        count(*)::int                                                   as stores_published,
        count(first_order_at)::int                                      as stores_with_sale,
        round(100.0 * count(first_order_at) / nullif(count(*), 0), 1)   as first_sale_rate,
        round(percentile_cont(0.5) within group (order by days_to_first_sale)::numeric, 1)
                                                                        as median_days_to_first_sale
    from timed
    group by cohort_week
    order by cohort_week desc;
$$;

revoke execute on function public.first_sale_cohorts(integer) from public, anon, authenticated;
grant execute on function public.first_sale_cohorts(integer) to service_role;
