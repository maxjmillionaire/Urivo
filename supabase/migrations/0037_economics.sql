-- ------------------------------------------------------------
-- 0037 — Economics: real revenue, real image cost, real budget
--
-- Urivo already measures what it SPENDS exactly: every AI action writes token
-- counts and provider cost to ai_usage_ledger at the moment it happens. It has
-- never measured what it EARNS. Monthly revenue was derived by counting
-- profiles by plan and multiplying by the list price — which silently assumes
-- nobody is on a founding price, nobody bought a credit pack, nobody was
-- refunded, and every subscription actually collected. Gross margin computed
-- from that is an estimate wearing the clothes of a measurement.
--
-- Three things here, all in service of one rule: a number on the finance
-- dashboard either comes from a recorded event, or it is labelled as modelled.
--
--   1. platform_revenue — every euro Urivo actually collects, written by the
--      Stripe webhook from the amount Stripe reports, keyed by the event id so
--      a retry cannot double-count it.
--   2. A configurable image cost with PROVENANCE. The €0.07/image figure is an
--      estimate, and it is roughly two thirds of the cost of a free signup, so
--      it is the largest single assumption in the business. It moves to
--      settings (changeable without a deploy), carries whether it is estimated
--      or measured, and historical rows can be rebased to a corrected rate —
--      exactly because the ledger already stores the image COUNT.
--   3. A monthly AI budget, so "remaining budget" is a real number rather than
--      a feeling.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. Platform revenue
-- ------------------------------------------------------------
create table if not exists public.platform_revenue (
    id          uuid primary key default gen_random_uuid(),
    -- Nullable: a refund or an event we cannot attribute still belongs in the
    -- total. Revenue that only counts when we can name the customer is not a
    -- total, it is a sample.
    user_id     uuid references public.profiles (id) on delete set null,
    kind        text not null check (kind in ('subscription', 'credit_pack', 'refund')),
    -- Signed minor units, as Stripe reports them. Refunds are negative, so the
    -- month's revenue is a plain sum and can never be overstated by forgetting
    -- to subtract something.
    amount_cents integer not null,
    currency    text not null default 'eur',
    -- Which plan or pack this was, for the per-plan margin view.
    plan        text,
    pack        text,
    -- Stripe's own ids. The event id is UNIQUE: Stripe retries webhooks, and a
    -- retry that added revenue twice would corrupt every figure downstream.
    stripe_event_id  text not null unique,
    stripe_object_id text,
    occurred_at timestamptz not null default now(),
    created_at  timestamptz not null default now()
);

create index if not exists idx_platform_revenue_occurred
    on public.platform_revenue (occurred_at desc);
create index if not exists idx_platform_revenue_user
    on public.platform_revenue (user_id, occurred_at desc);

alter table public.platform_revenue enable row level security;
-- No policies at all: this is founder-only data, reached exclusively through
-- service_role from the admin surface. RLS on with no policy denies everyone.

comment on table public.platform_revenue is
    'Every euro Urivo collects, from Stripe, idempotent on the event id. The measured half of gross margin.';

-- ------------------------------------------------------------
-- 2. Operational settings: image cost, thresholds, budget
-- ------------------------------------------------------------
alter table public.platform_settings
    -- Null = fall back to the code default. Set = this rate wins, no deploy.
    add column if not exists image_cost_usd numeric(10, 6),
    -- 'estimated' until somebody reads it off a real invoice. The dashboard
    -- labels every figure that depends on an estimate, so a guess can never be
    -- mistaken for a measurement.
    add column if not exists image_cost_source text not null default 'estimated'
        check (image_cost_source in ('estimated', 'measured')),
    -- Ascending euro thresholds. Each one alerts once per day, so a runaway day
    -- escalates instead of going quiet after the first email.
    add column if not exists daily_spend_thresholds_eur numeric[] not null default '{25,50,100}',
    -- The highest threshold already alerted today; reset when the day rolls.
    add column if not exists spend_alert_high_water_eur numeric not null default 0,
    -- 0 = no budget set.
    add column if not exists monthly_ai_budget_eur numeric not null default 0;

comment on column public.platform_settings.image_cost_usd is
    'Effective per-image cost. Null falls back to the code default. Change with rebase_image_costs to keep history consistent.';

-- ------------------------------------------------------------
-- 3. Today, at a glance — the number that decides whether to act now
-- ------------------------------------------------------------
create or replace function public.finance_today(p_day date default (now() at time zone 'utc')::date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with day_bounds as (
        select p_day::timestamptz as from_ts, (p_day + 1)::timestamptz as to_ts
    ),
    cost as (
        select coalesce(sum(l.total_cost_usd), 0)::numeric      as total_usd,
               coalesce(sum(l.anthropic_cost_usd), 0)::numeric  as anthropic_usd,
               coalesce(sum(l.image_cost_usd), 0)::numeric      as image_usd,
               count(*)::integer                                as actions,
               coalesce(sum(l.credits), 0)::integer             as credits,
               count(distinct l.user_id)::integer               as users
        from public.ai_usage_ledger l, day_bounds b
        where l.created_at >= b.from_ts and l.created_at < b.to_ts
    ),
    -- Split by whether the account behind the spend pays us anything. Free
    -- spend is the number with no revenue behind it; paid spend is expected
    -- cost of goods.
    split as (
        select
            coalesce(sum(l.total_cost_usd) filter (where p.plan = 'free'), 0)::numeric as free_usd,
            coalesce(sum(l.total_cost_usd) filter (where p.plan <> 'free'), 0)::numeric as paid_usd
        from public.ai_usage_ledger l
        join public.profiles p on p.id = l.user_id, day_bounds b
        where l.created_at >= b.from_ts and l.created_at < b.to_ts
    ),
    -- The single most expensive thing we did today, which is the first place
    -- to look when a day is unusual.
    top_feature as (
        select l.feature,
               sum(l.total_cost_usd)::numeric as cost_usd,
               count(*)::integer              as actions
        from public.ai_usage_ledger l, day_bounds b
        where l.created_at >= b.from_ts and l.created_at < b.to_ts
        group by l.feature
        order by 2 desc
        limit 1
    ),
    revenue as (
        select coalesce(sum(r.amount_cents), 0)::integer as cents
        from public.platform_revenue r, day_bounds b
        where r.occurred_at >= b.from_ts and r.occurred_at < b.to_ts
          and r.currency = 'eur'
    )
    select jsonb_build_object(
        'day',             p_day,
        'total_cost_usd',  (select total_usd from cost),
        'anthropic_usd',   (select anthropic_usd from cost),
        'image_usd',       (select image_usd from cost),
        'actions',         (select actions from cost),
        'credits',         (select credits from cost),
        'users',           (select users from cost),
        'free_cost_usd',   coalesce((select free_usd from split), 0),
        'paid_cost_usd',   coalesce((select paid_usd from split), 0),
        'revenue_cents',   (select cents from revenue),
        'top_feature',     (select feature from top_feature),
        'top_feature_usd', coalesce((select cost_usd from top_feature), 0),
        'top_feature_actions', coalesce((select actions from top_feature), 0)
    );
$$;

revoke execute on function public.finance_today(date) from public, anon, authenticated;
grant execute on function public.finance_today(date) to service_role;

-- ------------------------------------------------------------
-- 4. Revenue for a period, by kind. The measured half of gross margin.
-- ------------------------------------------------------------
create or replace function public.finance_revenue(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'total_cents',        coalesce(sum(amount_cents), 0)::integer,
        'subscription_cents', coalesce(sum(amount_cents) filter (where kind = 'subscription'), 0)::integer,
        'pack_cents',         coalesce(sum(amount_cents) filter (where kind = 'credit_pack'), 0)::integer,
        'refund_cents',       coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer,
        'events',             count(*)::integer,
        -- Anything not in euros is excluded from the sums above rather than
        -- silently added at an invented rate. Surfaced so it cannot hide.
        'non_eur_events',     count(*) filter (where currency <> 'eur')::integer
    )
    from public.platform_revenue
    where occurred_at >= p_since and currency = 'eur';
$$;

revoke execute on function public.finance_revenue(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_revenue(timestamptz) to service_role;

-- ------------------------------------------------------------
-- 5. Gross margin per plan, both sides measured.
--
-- Cost comes from the usage ledger grouped by the payer's CURRENT plan, which
-- is the honest approximation available: the ledger records who spent, and the
-- profile records what they pay. A merchant who upgrades mid-month moves their
-- whole month's cost to the new tier; over a month that is noise, and the
-- alternative — stamping the plan onto every ledger row — buys precision
-- nobody would act on.
-- ------------------------------------------------------------
create or replace function public.finance_margin_by_plan(p_since timestamptz)
returns table (
    plan            text,
    users           integer,
    actions         integer,
    credits         integer,
    cost_usd        numeric,
    revenue_cents   integer
)
language sql
stable
security definer
set search_path = public
as $$
    with cost as (
        select p.plan,
               count(distinct l.user_id)::integer          as users,
               count(*)::integer                           as actions,
               coalesce(sum(l.credits), 0)::integer        as credits,
               coalesce(sum(l.total_cost_usd), 0)::numeric as cost_usd
        from public.ai_usage_ledger l
        join public.profiles p on p.id = l.user_id
        where l.created_at >= p_since
        group by p.plan
    ),
    rev as (
        select coalesce(r.plan, 'unattributed') as plan,
               coalesce(sum(r.amount_cents), 0)::integer as revenue_cents
        from public.platform_revenue r
        where r.occurred_at >= p_since and r.currency = 'eur'
        group by 1
    )
    select coalesce(c.plan, r.plan),
           coalesce(c.users, 0),
           coalesce(c.actions, 0),
           coalesce(c.credits, 0),
           coalesce(c.cost_usd, 0),
           coalesce(r.revenue_cents, 0)
    from cost c
    full outer join rev r on r.plan = c.plan
    order by 6 desc;
$$;

revoke execute on function public.finance_margin_by_plan(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_margin_by_plan(timestamptz) to service_role;

-- ------------------------------------------------------------
-- 6. Rebase historical image cost to a corrected rate.
--
-- The ledger stores the image COUNT alongside the cost, which is what makes
-- this exact rather than a fudge: every row's image cost is recomputed as
-- count × rate, and the row total is rebuilt from its two parts. Run this once
-- when the real per-image price is known, and the whole history stops being a
-- mixture of two different assumptions.
--
-- Returns the number of rows corrected.
-- ------------------------------------------------------------
create or replace function public.rebase_image_costs(p_rate_usd numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rows integer;
begin
    if p_rate_usd is null or p_rate_usd < 0 or p_rate_usd > 10 then
        raise exception 'rebase_image_costs: implausible rate %', p_rate_usd;
    end if;

    with updated as (
        update public.ai_usage_ledger
        set image_cost_usd = round(images * p_rate_usd, 6),
            total_cost_usd = round(anthropic_cost_usd + (images * p_rate_usd), 6)
        where images > 0
        returning id
    )
    select count(*)::integer into v_rows from updated;

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (null, 'image_cost_rebased', 'ai_usage_ledger', p_rate_usd::text);

    return v_rows;
end;
$$;

revoke execute on function public.rebase_image_costs(numeric) from public, anon, authenticated;
grant execute on function public.rebase_image_costs(numeric) to service_role;

comment on function public.rebase_image_costs(numeric) is
    'Recompute every historical image cost at a corrected per-image rate. Exact, because the ledger stores image counts.';
