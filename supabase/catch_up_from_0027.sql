-- ============================================================
-- URIVO — Database catch-up (migrations 0027–0028).
-- For a project that ALREADY has the earlier migrations applied.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- Use setup_all.sql instead on a brand-new, empty project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build -- --from 0027
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- 0027_first_sale_funnel.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0028_creator_payouts.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0028 — Creator payouts (closing the commission loop)
--
-- 0012 could record that a commission was OWED and that an individual referral
-- had been paid, but nothing could answer "what do I owe this creator right
-- now" or record the actual transfer. Commissions accumulated with no way to
-- settle them, which is the half of the growth engine that keeps a
-- distribution partner willing to keep promoting.
--
-- A payout is one real transfer to one creator, settling N referrals at once.
-- Each referral points back at the payout that settled it, so every euro is
-- traceable in both directions.
-- ------------------------------------------------------------

create table if not exists public.creator_payouts (
    id uuid primary key default gen_random_uuid(),
    creator_id uuid not null references public.creators (id) on delete cascade,
    amount_eur numeric(10, 2) not null check (amount_eur >= 0),
    referral_count integer not null check (referral_count > 0),
    -- How it was actually sent. Free text on purpose: this records reality,
    -- it does not move money.
    method text,
    -- Bank/PayPal reference so a creator query can be answered in one lookup.
    reference text,
    note text,
    paid_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists idx_creator_payouts_creator
    on public.creator_payouts (creator_id, paid_at desc);

-- Which payout settled each commission.
alter table public.referrals
    add column if not exists payout_id uuid references public.creator_payouts (id) on delete set null;

create index if not exists idx_referrals_payout on public.referrals (payout_id);

alter table public.creator_payouts enable row level security;
-- No policies: admin-only, reached through the service role.

-- ------------------------------------------------------------
-- What is owed, per creator, right now.
-- ------------------------------------------------------------
create or replace function public.creator_payout_summary()
returns table (
    creator_id uuid,
    creator_name text,
    creator_code text,
    owed_count integer,
    owed_eur numeric,
    paid_eur numeric,
    last_paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select
        c.id,
        c.name,
        c.code,
        count(r.id) filter (where r.commission_status = 'owed')::int      as owed_count,
        coalesce(sum(r.commission_amount_eur)
                 filter (where r.commission_status = 'owed'), 0)          as owed_eur,
        coalesce(sum(r.commission_amount_eur)
                 filter (where r.commission_status = 'paid'), 0)          as paid_eur,
        (select max(p.paid_at) from public.creator_payouts p where p.creator_id = c.id)
                                                                          as last_paid_at
    from public.creators c
    left join public.referrals r on r.creator_id = c.id
    group by c.id, c.name, c.code
    order by owed_eur desc, c.name;
$$;

revoke execute on function public.creator_payout_summary() from public, anon, authenticated;
grant execute on function public.creator_payout_summary() to service_role;

-- ------------------------------------------------------------
-- Settle everything currently owed to one creator, atomically.
--
-- Locks the owed rows first so two admins clicking at once cannot pay the same
-- commission twice — the amount is computed from the locked set, never from a
-- number the caller supplied.
-- ------------------------------------------------------------
create or replace function public.pay_out_creator(
    p_creator_id uuid,
    p_method text default null,
    p_reference text default null,
    p_note text default null
)
returns table (
    payout_id uuid,
    amount_eur numeric,
    referral_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ids uuid[];
    v_amount numeric;
    v_count integer;
    v_payout uuid;
begin
    select array_agg(id), coalesce(sum(commission_amount_eur), 0), count(*)
      into v_ids, v_amount, v_count
    from (
        select id, commission_amount_eur
        from public.referrals
        where creator_id = p_creator_id
          and commission_status = 'owed'
          and commission_paid = false
        for update
    ) owed;

    if v_count is null or v_count = 0 then
        raise exception 'NOTHING_OWED';
    end if;

    insert into public.creator_payouts (creator_id, amount_eur, referral_count, method, reference, note)
    values (p_creator_id, v_amount, v_count, p_method, p_reference, p_note)
    returning id into v_payout;

    update public.referrals
    set commission_status = 'paid',
        commission_paid = true,
        commission_paid_at = now(),
        payout_id = v_payout
    where id = any(v_ids);

    return query select v_payout, v_amount, v_count;
end $$;

revoke execute on function public.pay_out_creator(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pay_out_creator(uuid, text, text, text) to service_role;
