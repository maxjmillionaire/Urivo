-- ------------------------------------------------------------
-- 0012 — Creator referral system (attribution + commission)
--
-- A scalable affiliate system, built now so Stripe (Phase 2) plugs into the
-- existing structure without schema changes. Codes, not links: a customer types
-- a creator's code (e.g. MAX10) at checkout.
--
-- Business rules (final, CEO):
--   • During the launch offer: the code gives NO extra discount (the customer
--     already has the launch price) — it is used purely for attribution +
--     commission tracking.
--   • After the launch offer: the code gives 10% off the FIRST purchase.
--   • The creator earns 25% commission on the customer's FIRST successful
--     payment only — no recurring commission.
--
-- Money columns are EUR (net). Stripe later calls the service layer to set
-- first_payment_* and the commission; nothing here presumes Stripe.
-- ------------------------------------------------------------

-- One row per creator/affiliate. A creator may or may not be a platform user.
create table public.creators (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.profiles (id) on delete set null,
    name text not null check (char_length(name) between 1 and 120),
    email text,
    -- The referral code the customer types. Stored uppercase, globally unique.
    code text unique not null
        check (code = upper(code) and char_length(code) between 3 and 24),
    -- Commission on the first successful payment (0.25 = 25%). Per-creator so
    -- special deals are possible without code changes.
    commission_rate numeric(5, 4) not null default 0.25 check (commission_rate >= 0 and commission_rate <= 1),
    status text not null default 'active' check (status in ('active', 'inactive')),
    created_at timestamptz not null default now()
);

create index idx_creators_code on public.creators (code);
create index idx_creators_user on public.creators (user_id);

-- One row per referred customer (first-touch: a customer is attributed once).
-- Permanently stores everything the CEO listed: creator, code, customer, first
-- payment status, commission status, commission-paid flag.
create table public.referrals (
    id uuid primary key default gen_random_uuid(),
    creator_id uuid not null references public.creators (id) on delete cascade,
    code text not null,
    customer_id uuid not null references public.profiles (id) on delete cascade,
    -- Discount the customer actually received via the code (0 during launch,
    -- 0.10 post-launch first purchase).
    discount_rate numeric(5, 4) not null default 0 check (discount_rate >= 0 and discount_rate <= 1),
    -- First payment lifecycle (Stripe sets this in Phase 2).
    first_payment_status text not null default 'pending'
        check (first_payment_status in ('pending', 'paid', 'failed')),
    first_payment_at timestamptz,
    first_payment_amount_eur numeric(10, 2),
    -- Commission lifecycle.
    commission_status text not null default 'pending'
        check (commission_status in ('pending', 'owed', 'paid', 'void')),
    commission_amount_eur numeric(10, 2) not null default 0 check (commission_amount_eur >= 0),
    commission_paid boolean not null default false,
    commission_paid_at timestamptz,
    created_at timestamptz not null default now(),
    -- First-touch attribution: one creator per customer, forever.
    unique (customer_id)
);

create index idx_referrals_creator on public.referrals (creator_id, created_at desc);
create index idx_referrals_commission on public.referrals (commission_status);

-- Both tables are internal. RLS on, no client policies → reachable only via the
-- service role in the admin-gated API layer (same trust model as the ledgers).
alter table public.creators enable row level security;
alter table public.referrals enable row level security;

-- ------------------------------------------------------------
-- Reporting RPCs (server-side aggregation; service-role only).
-- ------------------------------------------------------------

-- Whole-program overview for the admin dashboard.
create or replace function public.referral_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'total_creators', (select count(*) from public.creators),
        'active_creators', (select count(*) from public.creators where status = 'active'),
        'total_referrals', (select count(*) from public.referrals),
        'first_payments', (select count(*) from public.referrals where first_payment_status = 'paid'),
        'commissions_owed_eur', (select coalesce(sum(commission_amount_eur), 0)
            from public.referrals where commission_status = 'owed'),
        'commissions_paid_eur', (select coalesce(sum(commission_amount_eur), 0)
            from public.referrals where commission_paid = true),
        'referral_revenue_eur', (select coalesce(sum(first_payment_amount_eur), 0)
            from public.referrals where first_payment_status = 'paid'),
        'conversion_pct', (
            select case when count(*) > 0
                then round(100.0 * count(*) filter (where first_payment_status = 'paid') / count(*), 1)
                else 0 end
            from public.referrals
        )
    );
$$;

-- Leaderboard: best-performing creators.
create or replace function public.referral_top_creators(p_limit integer)
returns table (
    creator_id uuid,
    name text,
    code text,
    customers bigint,
    first_payments bigint,
    commission_owed_eur numeric,
    commission_paid_eur numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select c.id, c.name, c.code,
           count(r.id) as customers,
           count(r.id) filter (where r.first_payment_status = 'paid') as first_payments,
           coalesce(sum(r.commission_amount_eur) filter (where r.commission_status = 'owed'), 0) as commission_owed_eur,
           coalesce(sum(r.commission_amount_eur) filter (where r.commission_paid = true), 0) as commission_paid_eur
    from public.creators c
    left join public.referrals r on r.creator_id = c.id
    group by c.id, c.name, c.code
    order by count(r.id) filter (where r.first_payment_status = 'paid') desc, count(r.id) desc
    limit greatest(p_limit, 1);
$$;

revoke execute on function public.referral_overview() from public, anon, authenticated;
revoke execute on function public.referral_top_creators(integer) from public, anon, authenticated;
grant execute on function public.referral_overview() to service_role;
grant execute on function public.referral_top_creators(integer) to service_role;
