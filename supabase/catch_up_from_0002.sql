-- ============================================================
-- URIVO — Database catch-up (migrations 0002–0026).
-- For a project that ALREADY has the earlier migrations applied.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- Use setup_all.sql instead on a brand-new, empty project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build -- --from 0002
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- 0002_harden_functions.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- URIVO — Migration 0002: harden sensitive functions (Phase 3)
-- Run AFTER 0001. Supabase Dashboard → SQL Editor → paste → Run.
--
-- Make credit and store-generation logic server-authoritative
-- (spec 6.1 §1). These functions take a user_id parameter and run
-- as SECURITY DEFINER, so they must never be callable directly by
-- the browser (anon/authenticated) — only the server, via the
-- service role, may invoke them.
-- ============================================================

revoke execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer)
    from public, anon, authenticated;
revoke execute on function public.credit_balance(uuid)
    from public, anon, authenticated;

grant execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer)
    to service_role;
grant execute on function public.credit_balance(uuid)
    to service_role;


-- ─────────────────────────────────────────────────────────
-- 0003_product_images.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- 0003 — Product imagery
-- Adds object storage for AI-generated product photography and persists the
-- image URL through the atomic store-generation RPC.
-- ============================================================

-- 1. Public storage bucket for product images.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Public read; writes happen only via the service role (bypasses RLS).
drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images"
    on storage.objects for select
    using (bucket_id = 'product-images');

-- 2. Persist image_url through the atomic generation RPC.
create or replace function public.generate_store_atomic(
    p_user_id uuid,
    p_store_name text,
    p_subdomain text,
    p_theme_config jsonb,
    p_products jsonb,
    p_credit_cost integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_balance integer;
    v_store_id uuid;
begin
    if p_credit_cost <= 0 then
        raise exception 'INVALID_CREDIT_COST';
    end if;

    if exists (select 1 from public.reserved_subdomains where subdomain = p_subdomain) then
        raise exception 'SUBDOMAIN_RESERVED';
    end if;

    -- Serialize concurrent spends per user (row lock on profile)
    perform 1 from public.profiles where id = p_user_id for update;

    v_balance := public.credit_balance(p_user_id);
    if v_balance < p_credit_cost then
        raise exception 'INSUFFICIENT_CREDITS';
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, -p_credit_cost, 'Store generation: ' || p_subdomain, 'generation');

    insert into public.stores (user_id, store_name, subdomain, theme_config)
    values (p_user_id, p_store_name, p_subdomain, p_theme_config)
    returning id into v_store_id;

    insert into public.products (store_id, title, description, price_eur, image_url, inventory_count, position)
    select
        v_store_id,
        (elem ->> 'title')::text,
        coalesce((elem ->> 'description')::text, ''),
        (elem ->> 'price_eur')::numeric(10, 2),
        nullif(elem ->> 'image_url', ''),
        coalesce((elem ->> 'inventory_count')::integer, 100),
        ordinality - 1
    from jsonb_array_elements(p_products) with ordinality as t(elem, ordinality);

    insert into public.audit_logs (user_id, action, resource, resource_id, metadata)
    values (p_user_id, 'store_generation', 'store', v_store_id::text,
            jsonb_build_object('subdomain', p_subdomain, 'credit_cost', p_credit_cost));

    return jsonb_build_object(
        'store_id', v_store_id,
        'credits_remaining', v_balance - p_credit_cost
    );
end;
$$;


-- ─────────────────────────────────────────────────────────
-- 0004_product_logo.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- 0004 — Brand logo overlay
-- Per-product toggle for the store's logo overlay. The logo itself (URL +
-- placement/size/opacity) lives in stores.theme_config.logo; logo files reuse
-- the existing public product-images bucket under a logos/ prefix.
-- ============================================================

alter table public.products
    add column if not exists show_logo boolean not null default true;


-- ─────────────────────────────────────────────────────────
-- 0005_commerce.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- 0005_commerce — real orders for generated storefronts
-- ------------------------------------------------------------
-- Each store receives money through its OWN Stripe Connect account
-- (stripe_account_id); Urivo never pools merchant revenue. Orders are
-- created server-authoritatively from the Stripe webhook after payment,
-- never from the client. Money is stored in integer minor units (cents)
-- to match Stripe exactly.
-- ============================================================

-- Merchant payout account (Stripe Connect) + storefront currency.
alter table public.stores
    add column if not exists stripe_account_id text,
    add column if not exists stripe_charges_enabled boolean not null default false,
    add column if not exists currency text not null default 'eur'
        check (char_length(currency) = 3);

-- Orders --------------------------------------------------------
create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores (id) on delete cascade,
    stripe_session_id text unique,
    stripe_payment_intent text,
    customer_email text,
    customer_name text,
    amount_subtotal integer not null default 0 check (amount_subtotal >= 0), -- cents
    amount_total integer not null default 0 check (amount_total >= 0),       -- cents
    currency text not null default 'eur',
    status text not null default 'pending'
        check (status in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_orders_store_id on public.orders (store_id, created_at desc);
create index if not exists idx_orders_session on public.orders (stripe_session_id);

-- Order line items — product details are SNAPSHOTTED so an order stays
-- accurate even if the product is later edited or deleted.
create table if not exists public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders (id) on delete cascade,
    product_id uuid references public.products (id) on delete set null,
    title text not null,
    unit_amount integer not null check (unit_amount >= 0), -- cents
    quantity integer not null check (quantity > 0),
    line_total integer not null check (line_total >= 0),   -- cents
    created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order_id on public.order_items (order_id);

-- Keep updated_at fresh on orders.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_orders_touch on public.orders;
create trigger trg_orders_touch
    before update on public.orders
    for each row execute function public.touch_updated_at();

-- Row level security -------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Merchants read their own store's orders. Inserts/updates happen only via
-- the service role (Stripe webhook) — no client write policy exists, so RLS
-- denies all client writes by default.
create policy "orders: owner read" on public.orders
    for select using (
        exists (select 1 from public.stores s
                where s.id = store_id and s.user_id = auth.uid())
    );

create policy "order_items: owner read" on public.order_items
    for select using (
        exists (
            select 1 from public.orders o
            join public.stores s on s.id = o.store_id
            where o.id = order_id and s.user_id = auth.uid()
        )
    );


-- ─────────────────────────────────────────────────────────
-- 0006_welcome_email.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- 0006_welcome_email — track the one-time welcome email
-- ------------------------------------------------------------
-- welcomed_at is set atomically the first time a user reaches the
-- dashboard, guaranteeing exactly one welcome email regardless of
-- how they signed up (email, OAuth, confirmation link).
-- ============================================================
alter table public.profiles
    add column if not exists welcomed_at timestamptz;


-- ─────────────────────────────────────────────────────────
-- 0007_profile_settings.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- 0007_profile_settings — account preferences
-- ------------------------------------------------------------
-- Marketing/product-update email opt-in, editable from Settings.
-- Defaults to true (users opt out); the welcome + transactional
-- emails are transactional and unaffected by this flag.
-- ============================================================
alter table public.profiles
    add column if not exists marketing_opt_in boolean not null default true;


-- ─────────────────────────────────────────────────────────
-- 0008_spend_credits.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0008 — Generic credit spend (server-authoritative)
--
-- Store generation has its own atomic RPC (generate_store_atomic). Every OTHER
-- AI action that costs credits — Ask Urivo messages, market research, ad plans,
-- product imagery — deducts through this one primitive, so the balance can
-- never go negative and the rule lives in exactly one place (spec 6.2 §14/§19).
--
-- Locks the profile row, verifies the balance, appends a negative ledger entry,
-- and returns the new balance. Raises INSUFFICIENT_CREDITS if the caller can't
-- afford the action. SECURITY DEFINER + revoked from client roles, so it is
-- only ever reachable from the service role in our API layer.
-- ------------------------------------------------------------

create or replace function public.spend_credits(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_source text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_balance integer;
begin
    if p_amount is null or p_amount <= 0 then
        raise exception 'INVALID_AMOUNT';
    end if;

    -- Serialize concurrent spends per user (row lock on the profile).
    perform 1 from public.profiles where id = p_user_id for update;

    v_balance := public.credit_balance(p_user_id);
    if v_balance < p_amount then
        raise exception 'INSUFFICIENT_CREDITS';
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, -p_amount, p_reason, coalesce(p_source, 'ai'));

    return v_balance - p_amount;
end;
$$;

-- Only the service role may spend credits (never the browser). Mirror the
-- pattern in 0002: revoke the default PUBLIC grant, then grant to service_role
-- explicitly (our API layer calls this with the service-role key). Without the
-- grant, every spend would fail with "permission denied for function".
revoke execute on function public.spend_credits(uuid, integer, text, text)
    from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text, text)
    to service_role;

-- ------------------------------------------------------------
-- Widen the credit_ledger.source vocabulary for the new economy.
-- The original CHECK only allowed system/subscription/generation/admin/referral;
-- the credit-costs overhaul introduces per-action sources (ask, research, ads,
-- image), a generic 'ai' fallback, and 'credit_pack' for one-time top-ups.
-- Without this, every AI charge and every pack grant would fail the constraint.
-- ------------------------------------------------------------
alter table public.credit_ledger drop constraint if exists credit_ledger_source_check;
alter table public.credit_ledger add constraint credit_ledger_source_check
    check (source in (
        'system', 'subscription', 'generation', 'admin', 'referral',
        'ai', 'ask', 'research', 'ads', 'image', 'credit_pack'
    ));


-- ─────────────────────────────────────────────────────────
-- 0009_ai_usage_ledger.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0009 — AI usage ledger (real per-action cost, not estimates)
--
-- The credit_ledger records what a user was CHARGED (credits). This table
-- records what an action actually COST US: the real input/output tokens off the
-- provider response, the images generated, and the money that translates to.
-- Together they answer, exactly, "this user cost us €4.82 this month" and "this
-- feature earns/loses margin" — the foundation of the finance system.
--
-- Append-only, one row per AI action. Written by the API layer (service role)
-- via lib/finance/ledger.ts. Costs are stored in USD (provider-native) so a
-- later FX revision never corrupts history; EUR is derived at read time.
-- ------------------------------------------------------------

create table public.ai_usage_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    -- Which product surface produced the spend.
    feature text not null check (feature in (
        'storeGeneration', 'askMessage', 'storeEdit',
        'marketResearch', 'adStudio', 'productImage'
    )),
    -- What the user was charged for it (mirror of the credit_ledger delta).
    credits integer not null default 0 check (credits >= 0),
    -- Real provider usage.
    input_tokens integer not null default 0 check (input_tokens >= 0),
    output_tokens integer not null default 0 check (output_tokens >= 0),
    images integer not null default 0 check (images >= 0),
    model text,
    -- Real money (USD, provider-native). Derived from usage × price at write time
    -- so the number is fixed even if list prices later change.
    anthropic_cost_usd numeric(12, 6) not null default 0 check (anthropic_cost_usd >= 0),
    image_cost_usd numeric(12, 6) not null default 0 check (image_cost_usd >= 0),
    total_cost_usd numeric(12, 6) not null default 0 check (total_cost_usd >= 0),
    -- Correlates with application logs / captureException for tracing.
    request_id text,
    created_at timestamptz not null default now()
);

-- Per-user rollups ("what did this user cost us this month") and per-feature
-- rollups ("which feature costs most") are the two hot query shapes.
create index idx_ai_usage_user on public.ai_usage_ledger (user_id, created_at desc);
create index idx_ai_usage_feature on public.ai_usage_ledger (feature, created_at desc);

alter table public.ai_usage_ledger enable row level security;

-- A user may read their OWN cost history (transparency); no client may write it —
-- inserts happen only through the service role in the API layer, same trust
-- model as credit_ledger.
create policy "ai_usage_ledger: own read" on public.ai_usage_ledger
    for select using (user_id = auth.uid());


-- ─────────────────────────────────────────────────────────
-- 0010_welcome_credits_20.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0010 — Free-tier welcome credits: 15 → 20
--
-- Signup credits are granted by the handle_new_user trigger (migration 0001),
-- not from application code, so the plan-config change in lib/plans.ts must be
-- mirrored here or new signups would still receive 15. Redefine the function so
-- every user created from now on gets 20 (Free = 2 stores). Existing users are
-- unaffected; their balance is historical and correct.
--
-- Everything else in the function is preserved verbatim from 0001 — only the
-- welcome-credit amount changes.
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', null)
    );

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (new.id, 20, 'Free tier welcome credits', 'system');

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (new.id, 'signup', 'profile', new.id::text);

    return new;
end;
$$;


-- ─────────────────────────────────────────────────────────
-- 0011_finance_reporting.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0011 — Finance reporting RPCs (server-side aggregation)
--
-- The admin finance dashboard reads aggregates, not rows. Aggregating in
-- Postgres (rather than pulling the ledger into the app) keeps the dashboard
-- fast and bounded as ai_usage_ledger grows into the millions. All functions
-- are SECURITY DEFINER and reachable only from the service role — the API layer
-- gates them behind an admin check before ever calling.
-- ------------------------------------------------------------

-- Whole-business cost overview since a cutoff (typically the month start).
create or replace function public.finance_overview(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'since', p_since,
        'action_count', (select count(*) from public.ai_usage_ledger where created_at >= p_since),
        'total_cost_usd', (select coalesce(sum(total_cost_usd), 0) from public.ai_usage_ledger where created_at >= p_since),
        'anthropic_cost_usd', (select coalesce(sum(anthropic_cost_usd), 0) from public.ai_usage_ledger where created_at >= p_since),
        'image_cost_usd', (select coalesce(sum(image_cost_usd), 0) from public.ai_usage_ledger where created_at >= p_since),
        'input_tokens', (select coalesce(sum(input_tokens), 0) from public.ai_usage_ledger where created_at >= p_since),
        'output_tokens', (select coalesce(sum(output_tokens), 0) from public.ai_usage_ledger where created_at >= p_since),
        'images', (select coalesce(sum(images), 0) from public.ai_usage_ledger where created_at >= p_since),
        'active_users', (select count(distinct user_id) from public.ai_usage_ledger where created_at >= p_since),
        'by_feature', (
            select coalesce(jsonb_agg(f order by f.cost_usd desc), '[]'::jsonb) from (
                select feature,
                       count(*) as actions,
                       coalesce(sum(credits), 0) as credits,
                       coalesce(sum(total_cost_usd), 0) as cost_usd,
                       coalesce(sum(input_tokens), 0) as input_tokens,
                       coalesce(sum(output_tokens), 0) as output_tokens,
                       coalesce(sum(images), 0) as images
                from public.ai_usage_ledger
                where created_at >= p_since
                group by feature
            ) f
        ),
        'credits_burned', (select coalesce(-sum(delta), 0) from public.credit_ledger where delta < 0 and created_at >= p_since),
        'credits_granted', (select coalesce(sum(delta), 0) from public.credit_ledger where delta > 0 and created_at >= p_since)
    );
$$;

-- The costliest users since a cutoff — "who is costing us the most, exactly".
create or replace function public.finance_top_users(p_since timestamptz, p_limit integer)
returns table (user_id uuid, email text, actions bigint, credits bigint, cost_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
    select u.user_id, p.email, u.actions, u.credits, u.cost_usd
    from (
        select user_id,
               count(*) as actions,
               coalesce(sum(credits), 0)::bigint as credits,
               coalesce(sum(total_cost_usd), 0) as cost_usd
        from public.ai_usage_ledger
        where created_at >= p_since
        group by user_id
    ) u
    join public.profiles p on p.id = u.user_id
    order by u.cost_usd desc
    limit greatest(p_limit, 1);
$$;

-- Subscriber distribution by plan + status — the revenue-side proxy until Stripe.
create or replace function public.finance_plan_distribution()
returns table (plan text, subscription_status text, users bigint)
language sql
stable
security definer
set search_path = public
as $$
    select plan, subscription_status, count(*)::bigint
    from public.profiles
    group by plan, subscription_status;
$$;

-- Reporting is service-role only (the API layer admin-gates before calling).
revoke execute on function public.finance_overview(timestamptz) from public, anon, authenticated;
revoke execute on function public.finance_top_users(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.finance_plan_distribution() from public, anon, authenticated;
grant execute on function public.finance_overview(timestamptz) to service_role;
grant execute on function public.finance_top_users(timestamptz, integer) to service_role;
grant execute on function public.finance_plan_distribution() to service_role;


-- ─────────────────────────────────────────────────────────
-- 0012_referrals.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0013_referral_presentment_currency.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0013 — Multi-currency readiness for referral payments
--
-- EUR stays the accounting currency: referrals.first_payment_amount_eur and
-- commission_amount_eur remain the normalised accounting truth. These two
-- nullable columns let us ALSO record what the customer actually paid in their
-- local checkout currency (Stripe presentment) once multi-currency checkout
-- ships in Phase 2 — added now so that ships without a schema change.
--
--   first_payment_currency          — ISO 4217 code the customer was charged in
--   first_payment_presentment_amount — the amount in that currency
--
-- Until Phase 2 both are simply null (or 'EUR'), and all accounting continues
-- to run off the *_eur columns unchanged.
-- ------------------------------------------------------------

alter table public.referrals
    add column if not exists first_payment_currency text
        check (first_payment_currency is null or char_length(first_payment_currency) = 3),
    add column if not exists first_payment_presentment_amount numeric(12, 2)
        check (first_payment_presentment_amount is null or first_payment_presentment_amount >= 0);


-- ─────────────────────────────────────────────────────────
-- 0014_suppliers.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0014 — Supplier Integration Layer
--
-- Two tables back the provider-agnostic sourcing layer:
--   • supplier_connections — a user's link to a provider (AutoDS, CJ, …). Holds
--     credentials, so it is SERVICE-ROLE ONLY (RLS on, no client policies); the
--     API layer surfaces connection status, never the secrets.
--   • product_sources — maps an imported Urivo product back to its supplier
--     origin (external ids + cost), which powers inventory / price / order sync.
--
-- Nothing here is provider-specific: `provider` is a label, credentials are
-- opaque jsonb handed to the matching provider by lib/suppliers.
-- ------------------------------------------------------------

create table public.supplier_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    provider text not null check (provider in (
        'autods', 'cj', 'zendrop', 'dsers', 'spocket', 'printful', 'printify'
    )),
    label text not null default '',
    -- Provider-specific credentials (api key / oauth tokens). Sensitive:
    -- reachable only via the service role. (Encrypt at rest with pgcrypto/Vault
    -- before storing real production keys — tracked as a hardening step.)
    credentials jsonb not null default '{}'::jsonb,
    status text not null default 'active' check (status in ('active', 'disconnected', 'error')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, provider)
);

create index idx_supplier_connections_user on public.supplier_connections (user_id);

-- Links a Urivo product to the supplier item it was imported from.
create table public.product_sources (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references public.products (id) on delete cascade,
    store_id uuid not null references public.stores (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    provider text not null check (provider in (
        'autods', 'cj', 'zendrop', 'dsers', 'spocket', 'printful', 'printify'
    )),
    external_product_id text not null,
    external_variant_id text,
    -- Cost the merchant pays the supplier, normalised to EUR (the accounting
    -- currency), plus the original for the record.
    supplier_cost_eur numeric(10, 2),
    supplier_currency text,
    supplier_cost_original numeric(10, 2),
    source_url text,
    sync_status text not null default 'synced'
        check (sync_status in ('synced', 'stale', 'out_of_stock', 'error')),
    last_synced_at timestamptz,
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (product_id)
);

create index idx_product_sources_store on public.product_sources (store_id);
create index idx_product_sources_lookup on public.product_sources (provider, external_product_id);

alter table public.supplier_connections enable row level security;
alter table public.product_sources enable row level security;

-- supplier_connections: no client policies → credentials reachable only by the
-- service role (same trust model as the ledgers).
-- product_sources: an owner may read their own mapping (no secrets there);
-- writes happen via the service role in the import pipeline.
create policy "product_sources: own read" on public.product_sources
    for select using (user_id = auth.uid());

create trigger trg_supplier_connections_updated_at before update on public.supplier_connections
    for each row execute function public.set_updated_at();
create trigger trg_product_sources_updated_at before update on public.product_sources
    for each row execute function public.set_updated_at();


-- ─────────────────────────────────────────────────────────
-- 0015_merchant_intelligence.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0015 — Merchant Intelligence
--
-- The strategic data asset. Because many merchants import the SAME supplier
-- products, Urivo can aggregate real outcomes ACROSS the platform per product —
-- something no single merchant, and no competitor without the install base, can
-- see. Over time these measured outcomes take over the Urivo Score (see
-- lib/suppliers/scoring.ts: the learnedWeight blend).
--
--   • product_outcomes      — append-only anonymised event log (audit + recompute)
--   • product_intelligence  — per (provider, external_product_id) rolling aggregate
--
-- Both are INTERNAL (service-role only, no client policies). Only aggregate,
-- non-identifying signals ever reach a user, via the scoring layer.
-- ------------------------------------------------------------

create table public.product_outcomes (
    id uuid primary key default gen_random_uuid(),
    provider text not null check (provider in (
        'autods', 'cj', 'zendrop', 'dsers', 'spocket', 'printful', 'printify'
    )),
    external_product_id text not null,
    category text,
    niche text,
    event_type text not null check (event_type in (
        'import', 'impression', 'order', 'refund', 'removal', 'repeat'
    )),
    value_cents integer not null default 0,
    -- Kept for internal integrity/dedup only; never exposed. Aggregates are
    -- anonymous by construction.
    store_id uuid references public.stores (id) on delete set null,
    created_at timestamptz not null default now()
);

create index idx_product_outcomes_lookup on public.product_outcomes (provider, external_product_id, created_at desc);

create table public.product_intelligence (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    external_product_id text not null,
    category text,
    imports bigint not null default 0,
    impressions bigint not null default 0,
    orders bigint not null default 0,
    refunds bigint not null default 0,
    removals bigint not null default 0,
    repeat_orders bigint not null default 0,
    revenue_cents bigint not null default 0,
    updated_at timestamptz not null default now(),
    unique (provider, external_product_id)
);

alter table public.product_outcomes enable row level security;
alter table public.product_intelligence enable row level security;
-- No client policies: intelligence is internal. Reached only via the service
-- role, and surfaced to users solely as aggregate signals in the score.

-- Atomic: append the event AND roll it into the aggregate in one call.
create or replace function public.record_product_outcome(
    p_provider text,
    p_external_id text,
    p_category text,
    p_niche text,
    p_event text,
    p_value_cents integer,
    p_store_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.product_outcomes
        (provider, external_product_id, category, niche, event_type, value_cents, store_id)
    values
        (p_provider, p_external_id, p_category, p_niche, p_event, coalesce(p_value_cents, 0), p_store_id);

    insert into public.product_intelligence (provider, external_product_id, category)
    values (p_provider, p_external_id, p_category)
    on conflict (provider, external_product_id)
        do update set category = coalesce(excluded.category, product_intelligence.category);

    update public.product_intelligence set
        imports       = imports       + (case when p_event = 'import'     then 1 else 0 end),
        impressions   = impressions   + (case when p_event = 'impression' then 1 else 0 end),
        orders        = orders        + (case when p_event = 'order'      then 1 else 0 end),
        refunds       = refunds       + (case when p_event = 'refund'     then 1 else 0 end),
        removals      = removals      + (case when p_event = 'removal'    then 1 else 0 end),
        repeat_orders = repeat_orders + (case when p_event = 'repeat'     then 1 else 0 end),
        revenue_cents = revenue_cents + (case when p_event = 'order'      then coalesce(p_value_cents, 0) else 0 end),
        updated_at = now()
    where provider = p_provider and external_product_id = p_external_id;
end;
$$;

revoke execute on function public.record_product_outcome(text, text, text, text, text, integer, uuid)
    from public, anon, authenticated;
grant execute on function public.record_product_outcome(text, text, text, text, text, integer, uuid)
    to service_role;


-- ─────────────────────────────────────────────────────────
-- 0016_decision_intelligence.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0016 — Decision Intelligence (the self-improving layer)
--
-- product_intelligence (0015) learns which PRODUCTS perform. This learns which
-- DECISIONS perform. Every AI choice — pricing strategy, hero selection, copy
-- style, selection threshold — is logged as an experiment (a policy + the arm
-- chosen). When a store produces outcomes (orders, refunds, repeats, removals,
-- revenue), they are attributed to EVERY decision that shaped that store, so we
-- learn which strategies consistently outperform per niche. That turns Urivo
-- from a recommendation engine into a policy that improves itself.
--
--   • ai_decisions          — one row per decision made (the experiment log)
--   • decision_performance  — per (policy, arm, niche) rolling outcome aggregate
--
-- Internal (service-role only). Surfaced to users only as better defaults.
-- ------------------------------------------------------------

create table public.ai_decisions (
    id uuid primary key default gen_random_uuid(),
    store_id uuid references public.stores (id) on delete cascade,
    user_id uuid references public.profiles (id) on delete set null,
    policy text not null check (policy in (
        'pricing', 'selection', 'hero', 'copy_style', 'collection', 'catalogue'
    )),
    arm text not null,
    niche text not null default '',
    context jsonb,
    created_at timestamptz not null default now()
);

create index idx_ai_decisions_store on public.ai_decisions (store_id);
create index idx_ai_decisions_policy on public.ai_decisions (policy, niche);

create table public.decision_performance (
    id uuid primary key default gen_random_uuid(),
    policy text not null,
    arm text not null,
    niche text not null default '',
    stores bigint not null default 0, -- how many times this arm was chosen (sample)
    impressions bigint not null default 0,
    orders bigint not null default 0,
    refunds bigint not null default 0,
    removals bigint not null default 0,
    repeat_orders bigint not null default 0,
    revenue_cents bigint not null default 0,
    updated_at timestamptz not null default now(),
    unique (policy, arm, niche)
);

alter table public.ai_decisions enable row level security;
alter table public.decision_performance enable row level security;
-- Internal: no client policies; reached only via the service role.

-- Log one decision (an experiment arm) AND bump its sample counter.
create or replace function public.record_ai_decision(
    p_store_id uuid,
    p_user_id uuid,
    p_policy text,
    p_arm text,
    p_niche text,
    p_context jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_niche text := coalesce(p_niche, '');
begin
    insert into public.ai_decisions (store_id, user_id, policy, arm, niche, context)
    values (p_store_id, p_user_id, p_policy, p_arm, v_niche, p_context);

    insert into public.decision_performance (policy, arm, niche, stores)
    values (p_policy, p_arm, v_niche, 1)
    on conflict (policy, arm, niche)
        do update set stores = decision_performance.stores + 1, updated_at = now();
end;
$$;

-- Attribute a store-level outcome to EVERY decision that shaped that store.
create or replace function public.attribute_store_outcome(
    p_store_id uuid,
    p_event text,
    p_value_cents integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.decision_performance dp set
        impressions   = dp.impressions   + (case when p_event = 'impression' then 1 else 0 end),
        orders        = dp.orders        + (case when p_event = 'order'      then 1 else 0 end),
        refunds       = dp.refunds       + (case when p_event = 'refund'     then 1 else 0 end),
        removals      = dp.removals      + (case when p_event = 'removal'    then 1 else 0 end),
        repeat_orders = dp.repeat_orders + (case when p_event = 'repeat'     then 1 else 0 end),
        revenue_cents = dp.revenue_cents + (case when p_event = 'order'      then coalesce(p_value_cents, 0) else 0 end),
        updated_at = now()
    from public.ai_decisions d
    where d.store_id = p_store_id
      and dp.policy = d.policy and dp.arm = d.arm and dp.niche = d.niche;
end;
$$;

revoke execute on function public.record_ai_decision(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.attribute_store_outcome(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.record_ai_decision(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.attribute_store_outcome(uuid, text, integer) to service_role;


-- ─────────────────────────────────────────────────────────
-- 0017_store_analytics.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0018_subscription_lifecycle.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0018 — Subscription lifecycle
--
-- The platform's Stripe subscription webhook needs to persist two facts the
-- profile did not yet carry: WHICH subscription a customer holds (so a later
-- subscription.updated / .deleted event maps back to the right person even if
-- the customer id race-created a second row) and WHEN the current paid period
-- ends (so the billing surface can show "renews on …" and management flows can
-- reason about cancel-at-period-end without a round-trip to Stripe).
--
-- stripe_customer_id already exists (0001). This only adds the subscription id
-- and the period boundary. Both are nullable — Free users have neither.
-- ------------------------------------------------------------

alter table public.profiles
    add column if not exists stripe_subscription_id text,
    add column if not exists current_period_end timestamptz;

-- Webhook lookups resolve a subscription event → the owning profile by either
-- the customer id (already unique-indexed) or the subscription id.
create index if not exists idx_profiles_stripe_subscription
    on public.profiles (stripe_subscription_id);


-- ─────────────────────────────────────────────────────────
-- 0019_signup_guardrails.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0019 — Signup guardrails (free-tier cost control, part 1)
--
-- THE RISK: the 20 welcome credits (0010) were granted by handle_new_user on
-- INSERT into auth.users — i.e. the instant an account row exists, BEFORE the
-- email is confirmed. A store generation costs exactly 20 credits, so every
-- unverified signup converted directly into one full generation (two large
-- model calls + a catalogue + product images) with no payment on file. One
-- viral moment could mean tens of thousands of free generations and zero
-- revenue — the viral scenario and the insolvency scenario were the same event.
--
-- THIS MIGRATION closes the door in the database (the authoritative place):
--   1. Welcome credits are granted only once the email is CONFIRMED (or at
--      creation for already-verified OAuth signups) — never for an unconfirmed
--      account.
--   2. Disposable / abuse email domains receive NO welcome credits at all.
--
-- Credits are never mutated or deleted here; the grant simply doesn't happen
-- until the account earns it. Existing users are unaffected.
-- ------------------------------------------------------------

-- ── Disposable-domain blocklist ────────────────────────────────────────────
-- Data-driven so the founder can extend it without a deploy (service-role only:
-- RLS on, no policies, exactly like stripe_webhook_events / reserved_subdomains).
create table if not exists public.blocked_email_domains (
    domain     text primary key,           -- lowercased host, no '@'
    reason     text,
    created_at timestamptz not null default now()
);

alter table public.blocked_email_domains enable row level security;

-- A pragmatic starter set of well-known disposable providers. Extend at runtime.
insert into public.blocked_email_domains (domain, reason) values
    ('mailinator.com', 'disposable'),
    ('guerrillamail.com', 'disposable'),
    ('guerrillamail.info', 'disposable'),
    ('sharklasers.com', 'disposable'),
    ('grr.la', 'disposable'),
    ('10minutemail.com', 'disposable'),
    ('10minutemail.net', 'disposable'),
    ('temp-mail.org', 'disposable'),
    ('tempmail.com', 'disposable'),
    ('tempmailo.com', 'disposable'),
    ('throwawaymail.com', 'disposable'),
    ('getnada.com', 'disposable'),
    ('maildrop.cc', 'disposable'),
    ('mohmal.com', 'disposable'),
    ('yopmail.com', 'disposable'),
    ('yopmail.net', 'disposable'),
    ('dispostable.com', 'disposable'),
    ('trashmail.com', 'disposable'),
    ('trashmail.de', 'disposable'),
    ('fakeinbox.com', 'disposable'),
    ('mailnesia.com', 'disposable'),
    ('mintemail.com', 'disposable'),
    ('spamgourmet.com', 'disposable'),
    ('mailcatch.com', 'disposable'),
    ('emailondeck.com', 'disposable'),
    ('tempinbox.com', 'disposable'),
    ('moakt.com', 'disposable'),
    ('luxusmail.org', 'disposable'),
    ('mailpoof.com', 'disposable'),
    ('inboxkitten.com', 'disposable'),
    ('temp-mail.io', 'disposable'),
    ('burnermail.io', 'disposable'),
    ('33mail.com', 'disposable'),
    ('anonaddy.com', 'disposable'),
    ('mailinator.net', 'disposable'),
    ('discard.email', 'disposable'),
    ('einrot.com', 'disposable'),
    ('spam4.me', 'disposable'),
    ('tmail.ws', 'disposable'),
    ('vomoto.com', 'disposable')
on conflict (domain) do nothing;

-- Is this email's domain on the blocklist? (case-insensitive on the host part)
create or replace function public.is_email_domain_blocked(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.blocked_email_domains
        where domain = lower(split_part(coalesce(p_email, ''), '@', 2))
    );
$$;

-- ── One-time welcome grant ─────────────────────────────────────────────────
-- Grants the 20 welcome credits at most once per user, and never for a blocked
-- domain. Idempotent: the ledger reason is the guard, so a re-run is a no-op.
create or replace function public.grant_welcome_credits(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_email_domain_blocked(p_email) then
        -- Disposable address → no free generation. Recorded for visibility.
        insert into public.audit_logs (user_id, action, resource, resource_id)
        values (p_user_id, 'welcome_credits_withheld', 'profile', p_user_id::text);
        return;
    end if;

    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and reason = 'Free tier welcome credits'
    ) then
        return; -- already granted
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, 20, 'Free tier welcome credits', 'system');
end;
$$;

-- ── Rework signup provisioning ─────────────────────────────────────────────
-- Profile + audit still happen on INSERT (the app needs the profile row), but
-- credits are now granted ONLY when the account is already verified at creation
-- (OAuth, or a project with email-confirmation disabled). Unconfirmed
-- email/password signups get their credits later, from the confirmation trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', null)
    );

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (new.id, 'signup', 'profile', new.id::text);

    if new.email_confirmed_at is not null then
        perform public.grant_welcome_credits(new.id, new.email);
    end if;

    return new;
end;
$$;

-- Grant on confirmation: fires when email_confirmed_at goes null → not-null.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.email_confirmed_at is null and new.email_confirmed_at is not null then
        perform public.grant_welcome_credits(new.id, new.email);
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
    after update on auth.users
    for each row execute function public.handle_user_confirmed();


-- ─────────────────────────────────────────────────────────
-- 0020_platform_settings.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0020 — Platform settings (free-tier cost control, part 2)
--
-- A single-row, server-authoritative control panel the founder can change
-- WITHOUT a deploy — the levers you reach for at 3am when inference spend is
-- running away:
--
--   * free_generations_enabled   — the KILL SWITCH. When false, free accounts
--                                  cannot generate; paying accounts are never
--                                  affected. Independent of any daily cap.
--   * free_daily_generation_cap  — optional global ceiling on free generations
--                                  per 24h (0 = no cap). The number is a founder
--                                  decision; the column exists so it can be set
--                                  from the admin UI later without a migration.
--   * daily_free_spend_alert_usd — threshold for the spend-alert email.
--   * spend_alert_last_sent_on   — idempotency so the alert fires at most once
--                                  per day.
--
-- Service-role only (RLS on, no policies), like the other operational tables.
-- ------------------------------------------------------------

create table if not exists public.platform_settings (
    -- Single-row guarantee: the PK can only ever be true.
    id                          boolean primary key default true check (id),
    free_generations_enabled    boolean not null default true,
    free_daily_generation_cap   integer not null default 0 check (free_daily_generation_cap >= 0),
    daily_free_spend_alert_usd  numeric(10, 2) not null default 50 check (daily_free_spend_alert_usd >= 0),
    spend_alert_last_sent_on    date,
    updated_at                  timestamptz not null default now()
);

-- Seed the single row.
insert into public.platform_settings (id) values (true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
-- No policies → readable/writable only by the service role.

-- ── Daily inference spend, split by account type ───────────────────────────
-- Feeds the spend-alert (2.5). Free-account spend is the number that can run
-- away with no revenue behind it; paid spend is expected cost of goods — the
-- two are reported separately because only one of them is a problem.
create or replace function public.platform_daily_spend(p_day date)
returns table (free_usd numeric, paid_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
    select
        coalesce(sum(u.total_cost_usd) filter (where p.plan = 'free'), 0)::numeric  as free_usd,
        coalesce(sum(u.total_cost_usd) filter (where p.plan <> 'free'), 0)::numeric as paid_usd
    from public.ai_usage_ledger u
    join public.profiles p on p.id = u.user_id
    where u.created_at >= p_day::timestamptz
      and u.created_at <  (p_day + 1)::timestamptz;
$$;

revoke execute on function public.platform_daily_spend(date) from public, anon, authenticated;
grant execute on function public.platform_daily_spend(date) to service_role;


-- ─────────────────────────────────────────────────────────
-- 0021_cost_per_action.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0021 — Cost-per-action reporting (part 5.2)
--
-- The current credit table looks intuited, not measured: a store generation is
-- priced at 20 credits and an edit at 1 (a 20:1 ratio), but a generation is two
-- large model calls plus a full catalogue plus product images — plausibly
-- 30–50× the tokens of a single edit. This RPC derives the REAL cost per action
-- type, broken down by model, straight from the usage ledger, so the founder can
-- see the gap between measured cost and current pricing and reprice on data.
--
-- Reporting only — it changes no pricing. Service-role only.
-- ------------------------------------------------------------

create or replace function public.finance_cost_per_action(p_since timestamptz)
returns table (
    feature        text,
    model          text,
    actions        bigint,
    credits        bigint,
    input_tokens   bigint,
    output_tokens  bigint,
    images         bigint,
    total_cost_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select
        u.feature,
        coalesce(u.model, 'unknown')                as model,
        count(*)::bigint                            as actions,
        coalesce(sum(u.credits), 0)::bigint         as credits,
        coalesce(sum(u.input_tokens), 0)::bigint    as input_tokens,
        coalesce(sum(u.output_tokens), 0)::bigint   as output_tokens,
        coalesce(sum(u.images), 0)::bigint          as images,
        coalesce(sum(u.total_cost_usd), 0)::numeric as total_cost_usd
    from public.ai_usage_ledger u
    where u.created_at >= p_since
    group by u.feature, coalesce(u.model, 'unknown')
    order by coalesce(sum(u.total_cost_usd), 0) desc;
$$;

revoke execute on function public.finance_cost_per_action(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_cost_per_action(timestamptz) to service_role;


-- ─────────────────────────────────────────────────────────
-- 0022_credit_expiry.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0022 — Credit expiry (monthly plan credits are use-it-or-lose-it)
--
-- THE RISK: monthly subscription credits never expired, so unspent credits
-- rolled over forever — an unbounded liability a user could cash in during the
-- worst possible month. Policy: PLAN (monthly) credits expire at the end of the
-- billing period they were granted for; PURCHASED (pack) credits, welcome
-- credits, referral and admin grants NEVER expire.
--
-- Implementation is append-only and non-destructive: no row is ever mutated or
-- deleted. Grants simply carry an `expires_at`; the balance is derived FIFO so
-- that spends consume the SOONEST-expiring credits first (user-favourable — you
-- spend plan credits before they lapse, and your permanent credits are the last
-- to be touched). An expired lot's unspent remainder is dropped from the
-- balance by the derivation. Backward-compatible: with no expires_at anywhere,
-- the FIFO result is exactly sum(delta), so existing balances are unchanged.
-- ------------------------------------------------------------

alter table public.credit_ledger
    add column if not exists expires_at timestamptz;

-- Balance, expiry-aware. Both spenders (spend_credits, generate_store_atomic)
-- call this, so display and spending share one authoritative definition.
create or replace function public.credit_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    with
    spent as (
        select coalesce(sum(-delta), 0)::bigint as total
        from public.credit_ledger
        where user_id = p_user_id and delta < 0
    ),
    lots as (
        -- Positive entries are grant "lots". Order so spends are attributed to
        -- the soonest-expiring lot first; permanent lots (null) are consumed last.
        select
            delta::bigint as amount,
            expires_at,
            coalesce(sum(delta) over (
                order by (expires_at is null), expires_at, created_at, id
                rows between unbounded preceding and 1 preceding
            ), 0)::bigint as prev_cum
        from public.credit_ledger
        where user_id = p_user_id and delta > 0
    )
    select coalesce(sum(
        case
            -- Expired lot: whatever the FIFO spend didn't consume is forfeited.
            when l.expires_at is not null and l.expires_at <= now() then 0
            -- Otherwise: this lot's amount minus the share of spend that reached it.
            else greatest(0, l.amount - greatest(0, s.total - l.prev_cum))
        end
    ), 0)::integer
    from lots l cross join spent s;
$$;

-- Soonest upcoming expiry + how many credits expire (for honest UI surfacing).
create or replace function public.credit_expiry_summary(p_user_id uuid)
returns table (amount integer, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    with
    spent as (
        select coalesce(sum(-delta), 0)::bigint as total
        from public.credit_ledger
        where user_id = p_user_id and delta < 0
    ),
    lots as (
        select
            delta::bigint as amount,
            expires_at,
            coalesce(sum(delta) over (
                order by (expires_at is null), expires_at, created_at, id
                rows between unbounded preceding and 1 preceding
            ), 0)::bigint as prev_cum
        from public.credit_ledger
        where user_id = p_user_id and delta > 0
    ),
    remaining as (
        select
            l.expires_at,
            greatest(0, l.amount - greatest(0, s.total - l.prev_cum)) as rem
        from lots l cross join spent s
        where l.expires_at is not null and l.expires_at > now()
    )
    select sum(rem)::integer as amount, min(expires_at) as expires_at
    from remaining
    having sum(rem) > 0;
$$;

revoke execute on function public.credit_expiry_summary(uuid) from public, anon, authenticated;
grant execute on function public.credit_expiry_summary(uuid) to service_role;


-- ─────────────────────────────────────────────────────────
-- 0023_founding_members.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0023 — Founding members (first 50 get a lifetime price)
--
-- Launch mechanic: the first N signups (default 50) are "founding members" and
-- lock a lifetime price (Founder €29 / Pro €149) instead of the standard
-- €49 / €199. A SIGNUP burns a spot (not a payment) — the founder's decision —
-- so the price is reserved the moment an account is created and honoured
-- whenever that person subscribes. After the cap, new signups pay standard.
--
-- No public counter (deliberately — a ticking "spots left" widget cheapens a
-- premium brand); the founder tracks the cohort privately on the admin surface.
-- ------------------------------------------------------------

-- Cap + running count live on the single platform_settings row (0020).
alter table public.platform_settings
    add column if not exists founding_cap     integer not null default 50 check (founding_cap >= 0),
    add column if not exists founding_claimed integer not null default 0  check (founding_claimed >= 0);

-- Allow the new price tier tag.
alter table public.profiles drop constraint if exists profiles_price_type_check;
alter table public.profiles
    add constraint profiles_price_type_check
    check (price_type in ('standard', 'launch', 'creator', 'founding'));

-- Redefine signup provisioning to atomically claim a founding spot. Preserves
-- all of 0019's behaviour (profile + audit + verified-only welcome credits) and
-- adds the founding claim. The conditional UPDATE on the single settings row
-- serializes concurrent signups, so the cap can never be exceeded.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_founding boolean := false;
begin
    -- Claim a spot iff any remain (row lock on the one settings row = atomic).
    update public.platform_settings
       set founding_claimed = founding_claimed + 1, updated_at = now()
     where id = true and founding_claimed < founding_cap;
    if found then
        v_founding := true;
    end if;

    insert into public.profiles (id, email, full_name, price_type)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', null),
        case when v_founding then 'founding' else 'standard' end
    );

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (new.id, 'signup', 'profile', new.id::text);

    if new.email_confirmed_at is not null then
        perform public.grant_welcome_credits(new.id, new.email);
    end if;

    return new;
end;
$$;


-- ─────────────────────────────────────────────────────────
-- 0024_notifications.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0024 — Merchant notifications (the nervous system)
--
-- Urivo captured order/visit/health DATA but never told the merchant when
-- anything HAPPENED — most glaringly, it never told them they made a SALE.
-- This is the event spine every future notification hangs on: a new order, a
-- first-sale milestone, a low credit balance, a refund, a chargeback, a store
-- going live — one durable, per-merchant feed the dashboard bell reads and
-- future channels (email, push) mirror.
--
-- Service-role only (RLS on, no policies): the app authorises the signed-in
-- user, then reads/writes their own rows through the service role with an
-- explicit user_id filter — the pattern used by the other operational tables.
-- ------------------------------------------------------------

create table public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    -- Event type: 'order', 'first_sale', 'milestone', 'credits_low',
    -- 'credits_expiring', 'refund', 'chargeback', 'payment_failed', 'store_live',
    -- 'system', … (open vocabulary; the UI maps kind → icon/colour).
    kind       text not null,
    title      text not null,
    body       text,
    -- Deep link into the product (e.g. /dashboard/stores/<id>/orders).
    href       text,
    severity   text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
    metadata   jsonb not null default '{}',
    read_at    timestamptz,
    created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications (user_id, created_at desc);
create index idx_notifications_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
-- No policies → service-role only.


-- ─────────────────────────────────────────────────────────
-- 0025_weekly_digest.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0026_connect_accounts.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0026 — Stripe Connect payout accounts (per merchant, not per store)
--
-- Founder decision: ONE connected account per user. A merchant onboards once
-- and every store they own sells through that account. This matches how
-- merchants think ("my business gets paid"), avoids re-onboarding for each new
-- store, and keeps Stripe's own identity verification to a single pass.
--
-- The account therefore lives on profiles, which becomes the single source of
-- truth. stores.stripe_account_id / stripe_charges_enabled (added in 0005, when
-- the model was per-store) are backfilled from here and left in place, but
-- nothing reads them any more — see the comments at the bottom.
--
-- Urivo never holds merchant money: charges are created directly on the
-- merchant's connected account.
-- ------------------------------------------------------------

alter table public.profiles
    -- The Stripe connected account (acct_...). Null until the merchant starts onboarding.
    add column if not exists stripe_account_id text,
    -- Stripe's own verdicts, mirrored from the account object. Never inferred locally.
    add column if not exists stripe_charges_enabled boolean not null default false,
    add column if not exists stripe_payouts_enabled boolean not null default false,
    add column if not exists stripe_details_submitted boolean not null default false,
    -- When we last reconciled the mirror with Stripe (onboarding return or webhook).
    add column if not exists stripe_account_updated_at timestamptz;

-- One profile per connected account.
create unique index if not exists profiles_stripe_account_id_key
    on public.profiles (stripe_account_id)
    where stripe_account_id is not null;

-- ------------------------------------------------------------
-- Backfill: carry any per-store account up to its owner.
-- Pre-launch this is a no-op, but it makes the migration correct rather than
-- merely convenient. If one owner somehow had several accounts, the earliest
-- store wins — deterministic, and the merchant re-onboards once either way.
-- ------------------------------------------------------------
update public.profiles p
set stripe_account_id      = s.stripe_account_id,
    stripe_charges_enabled = s.stripe_charges_enabled,
    stripe_account_updated_at = now()
from (
    select distinct on (user_id)
           user_id, stripe_account_id, stripe_charges_enabled
    from public.stores
    where stripe_account_id is not null
    order by user_id, created_at asc
) s
where s.user_id = p.id
  and p.stripe_account_id is null;

comment on column public.profiles.stripe_account_id is
    'Stripe Connect account for this merchant. Source of truth for storefront payouts.';
comment on column public.stores.stripe_account_id is
    'DEPRECATED (0026): payout accounts are per-user. Read profiles.stripe_account_id.';
comment on column public.stores.stripe_charges_enabled is
    'DEPRECATED (0026): payout accounts are per-user. Read profiles.stripe_charges_enabled.';

-- ------------------------------------------------------------
-- Storefront checkout runs as the service role and needs the owner's payout
-- state for a store it is about to charge on. One function keeps that lookup in
-- the database rather than joining across two tables in the API layer.
-- ------------------------------------------------------------
create or replace function public.store_payout_account(p_store_id uuid)
returns table (
    stripe_account_id text,
    charges_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select p.stripe_account_id, p.stripe_charges_enabled
    from public.stores s
    join public.profiles p on p.id = s.user_id
    where s.id = p_store_id;
$$;

revoke execute on function public.store_payout_account(uuid) from public, anon, authenticated;
grant execute on function public.store_payout_account(uuid) to service_role;
