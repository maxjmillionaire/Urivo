-- ============================================================
-- URIVO — Complete database setup (one-shot).
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It applies migrations 0001–0013 in order. Safe to run once on a fresh project.
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- 0001_init.sql
-- ─────────────────────────────────────────────────────────
-- ============================================================
-- URIVO — Initial schema (Phase 1)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Standards: spec 6.1 (tenant isolation, RLS, indexes),
--            spec 6.2 (credit ledger, atomicity, webhook dedup)
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES — one row per auth user, auto-provisioned
-- ------------------------------------------------------------
create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text unique not null,
    full_name text,
    plan text not null default 'free'
        check (plan in ('free', 'core', 'pro')),
    subscription_status text not null default 'none'
        check (subscription_status in ('none', 'active', 'past_due', 'cancelled')),
    price_type text not null default 'standard'
        check (price_type in ('standard', 'launch', 'creator')),
    stripe_customer_id text unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. CREDIT LEDGER — append-only; balance is derived (spec 6.2 §14)
-- ------------------------------------------------------------
create table public.credit_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    delta integer not null check (delta <> 0),
    reason text not null,
    source text not null default 'system'
        check (source in ('system', 'subscription', 'generation', 'admin', 'referral')),
    created_at timestamptz not null default now()
);

create index idx_credit_ledger_user_id on public.credit_ledger (user_id, created_at desc);

create or replace function public.credit_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(sum(delta), 0)::integer
    from public.credit_ledger
    where user_id = p_user_id;
$$;

-- ------------------------------------------------------------
-- 3. STORES — multi-tenant core
-- ------------------------------------------------------------
create table public.stores (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    store_name text not null check (char_length(store_name) between 2 and 80),
    subdomain text unique not null
        check (subdomain ~ '^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$'),
    theme_config jsonb not null default '{}'::jsonb,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_stores_user_id on public.stores (user_id);
create index idx_stores_subdomain on public.stores (subdomain);

-- Reserved subdomains can never be claimed by merchants
create table public.reserved_subdomains (
    subdomain text primary key
);
insert into public.reserved_subdomains (subdomain) values
    ('www'), ('app'), ('api'), ('admin'), ('dashboard'), ('mail'), ('status'),
    ('blog'), ('docs'), ('help'), ('support'), ('billing'), ('urivo'), ('staging');

-- ------------------------------------------------------------
-- 4. PRODUCTS
-- ------------------------------------------------------------
create table public.products (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 140),
    description text not null default '',
    price_eur numeric(10, 2) not null check (price_eur > 0),
    image_url text,
    inventory_count integer not null default 100 check (inventory_count >= 0),
    position integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_products_store_id on public.products (store_id, position);

-- ------------------------------------------------------------
-- 5. AUDIT LOG — immutable (spec 6.1 §9)
-- ------------------------------------------------------------
create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.profiles (id) on delete set null,
    action text not null,
    resource text not null,
    resource_id text,
    ip_address inet,
    user_agent text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index idx_audit_logs_user_id on public.audit_logs (user_id, created_at desc);

-- ------------------------------------------------------------
-- 6. STRIPE WEBHOOK EVENTS — exactly-once processing (spec 6.2 §12)
-- ------------------------------------------------------------
create table public.stripe_webhook_events (
    event_id text primary key,
    event_type text not null,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    processing_status text not null default 'received'
        check (processing_status in ('received', 'processed', 'failed', 'skipped')),
    error_message text
);

-- ------------------------------------------------------------
-- 7. updated_at maintenance
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger trg_profiles_updated_at before update on public.profiles
    for each row execute function public.set_updated_at();
create trigger trg_stores_updated_at before update on public.stores
    for each row execute function public.set_updated_at();
create trigger trg_products_updated_at before update on public.products
    for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 8. AUTO-PROVISIONING — signup creates profile + free credits
--    (spec 6.7: no manual setup, user lands in dashboard ready)
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

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 9. ATOMIC STORE GENERATION — deduct credits + create store +
--    products + audit in ONE transaction (spec 6.2 §19)
-- ------------------------------------------------------------
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

    insert into public.products (store_id, title, description, price_eur, inventory_count, position)
    select
        v_store_id,
        (elem ->> 'title')::text,
        coalesce((elem ->> 'description')::text, ''),
        (elem ->> 'price_eur')::numeric(10, 2),
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

-- ------------------------------------------------------------
-- 10. ROW LEVEL SECURITY — tenant isolation (spec 6.1 §5-6)
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.audit_logs enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.reserved_subdomains enable row level security;

create policy "profiles: own read" on public.profiles
    for select using (auth.uid() = id);
create policy "profiles: own update" on public.profiles
    for update using (auth.uid() = id);

create policy "credit_ledger: own read" on public.credit_ledger
    for select using (auth.uid() = user_id);

create policy "stores: own all" on public.stores
    for all using (auth.uid() = user_id);
create policy "stores: public storefront read" on public.stores
    for select using (is_active = true);

create policy "products: owner write" on public.products
    for all using (
        exists (select 1 from public.stores s
                where s.id = store_id and s.user_id = auth.uid())
    );
create policy "products: public storefront read" on public.products
    for select using (
        exists (select 1 from public.stores s
                where s.id = store_id and s.is_active = true)
    );

create policy "audit_logs: own read" on public.audit_logs
    for select using (auth.uid() = user_id);

-- stripe_webhook_events + reserved_subdomains: service-role only (no policies)


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


-- ============================================================
-- 0009_ai_usage_ledger.sql
-- ============================================================
create table public.ai_usage_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    feature text not null check (feature in (
        'storeGeneration', 'askMessage', 'storeEdit',
        'marketResearch', 'adStudio', 'productImage'
    )),
    credits integer not null default 0 check (credits >= 0),
    input_tokens integer not null default 0 check (input_tokens >= 0),
    output_tokens integer not null default 0 check (output_tokens >= 0),
    images integer not null default 0 check (images >= 0),
    model text,
    anthropic_cost_usd numeric(12, 6) not null default 0 check (anthropic_cost_usd >= 0),
    image_cost_usd numeric(12, 6) not null default 0 check (image_cost_usd >= 0),
    total_cost_usd numeric(12, 6) not null default 0 check (total_cost_usd >= 0),
    request_id text,
    created_at timestamptz not null default now()
);

create index idx_ai_usage_user on public.ai_usage_ledger (user_id, created_at desc);
create index idx_ai_usage_feature on public.ai_usage_ledger (feature, created_at desc);

alter table public.ai_usage_ledger enable row level security;

create policy "ai_usage_ledger: own read" on public.ai_usage_ledger
    for select using (user_id = auth.uid());

-- ============================================================
-- 0010_welcome_credits_20.sql — (welcome amount already 20 above; trigger
-- body identical to 0001 aside from the amount, so nothing to re-apply here.)
-- ============================================================


-- ============================================================
-- 0011_finance_reporting.sql
-- ============================================================
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


-- ============================================================
-- 0012_referrals.sql
-- ============================================================
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


-- ============================================================
-- 0013_referral_presentment_currency.sql
-- ============================================================
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
