-- ============================================================
-- URIVO — Complete database setup (one-shot).
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It applies migrations 0001–0051 in order. Safe to run once on a fresh project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build
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
    values (new.id, 15, 'Free tier welcome credits', 'system');

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


-- ─────────────────────────────────────────────────────────
-- 0029_store_subscribers.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0029 — Storefront email capture
--
-- Every generated store rendered a newsletter form whose Subscribe button did
-- nothing: no request, no confirmation, no error. A dead control on the second
-- most-clicked element of a storefront costs more trust than having no form.
--
-- It is wired here rather than removed because of what it is worth. Before a
-- merchant's first sale their traffic is their only asset, and an email address
-- is the only part of a visit that survives the visit. A store with no orders
-- and 40 subscribers is a business; a store with no orders and no list is not.
-- ------------------------------------------------------------

create table if not exists public.store_subscribers (
    id          uuid primary key default gen_random_uuid(),
    store_id    uuid not null references public.stores (id) on delete cascade,
    email       text not null,
    -- Where on the storefront they subscribed, for the merchant's own reporting.
    source      text not null default 'storefront',
    -- Soft delete: an unsubscribe must not free the address to be re-added
    -- silently by the same form, and the merchant needs the audit trail.
    unsubscribed_at timestamptz,
    created_at  timestamptz not null default now(),

    constraint store_subscribers_email_check check (position('@' in email) > 1),
    -- One address per store. A shopper pressing Subscribe twice is not two
    -- subscribers, and this is what makes the insert safely idempotent.
    constraint store_subscribers_unique unique (store_id, email)
);

create index if not exists idx_store_subscribers_store
    on public.store_subscribers (store_id, created_at desc);

alter table public.store_subscribers enable row level security;

-- Postgres has no `create policy if not exists`, so each policy is dropped
-- first. Without this a re-run fails with 42710 and the whole catch-up
-- script rolls back — which is exactly what happened in production.

-- The merchant reads and manages their own stores' lists. Nobody else can read
-- them at all: a subscriber list is the merchant's asset and contains PII.
drop policy if exists "store_subscribers: owner read" on public.store_subscribers;
create policy "store_subscribers: owner read" on public.store_subscribers
    for select using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_subscribers: owner update" on public.store_subscribers;
create policy "store_subscribers: owner update" on public.store_subscribers
    for update using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_subscribers: owner delete" on public.store_subscribers;
create policy "store_subscribers: owner delete" on public.store_subscribers
    for delete using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

-- No INSERT policy: shoppers are anonymous and must never be able to write to
-- this table directly, or a scraper could enumerate and pollute every list.
-- Subscriptions go through the RPC below, which runs as the definer and only
-- ever accepts an address for a store that is actually live.

-- ------------------------------------------------------------
-- Subscribe. Idempotent by design: pressing the button twice, or returning a
-- week later, is a no-op rather than an error the shopper has to interpret.
-- Re-subscribing after an unsubscribe clears the flag, which is what the
-- shopper means when they type their address in again.
-- ------------------------------------------------------------
create or replace function public.subscribe_to_store(
    p_subdomain text,
    p_email     text,
    p_source    text default 'storefront'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_store_id uuid;
    v_email    text := lower(btrim(p_email));
begin
    if v_email is null or position('@' in v_email) < 2 or length(v_email) > 254 then
        return false;
    end if;

    -- Only a LIVE store accepts subscribers. A draft is not public, so an
    -- address arriving for one did not come from a real storefront visit.
    select id into v_store_id
    from public.stores
    where subdomain = lower(btrim(p_subdomain)) and is_active = true;

    if v_store_id is null then
        return false;
    end if;

    insert into public.store_subscribers (store_id, email, source)
    values (v_store_id, v_email, coalesce(nullif(btrim(p_source), ''), 'storefront'))
    on conflict (store_id, email)
    do update set unsubscribed_at = null;

    return true;
end $$;

-- Anonymous shoppers need this one, and only this one.
revoke execute on function public.subscribe_to_store(text, text, text) from public;
grant execute on function public.subscribe_to_store(text, text, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- How many people a merchant has captured, per store. Owner-scoped through
-- RLS on the underlying table, so it needs no privilege of its own.
-- ------------------------------------------------------------
create or replace function public.store_subscriber_counts(p_user_id uuid)
returns table (store_id uuid, subscribers bigint)
language sql
stable
security definer
set search_path = public
as $$
    select sub.store_id, count(*)::bigint
    from public.store_subscribers sub
    join public.stores s on s.id = sub.store_id
    where s.user_id = p_user_id and sub.unsubscribed_at is null
    group by sub.store_id;
$$;

revoke execute on function public.store_subscriber_counts(uuid) from public, anon;
grant execute on function public.store_subscriber_counts(uuid) to authenticated, service_role;

comment on table public.store_subscribers is
    'Storefront email captures. The merchant''s pre-first-sale asset; PII, owner-read only.';


-- ─────────────────────────────────────────────────────────
-- 0030_live_store_capacity.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0030 — Live store capacity
--
-- Credits meter CREATING a store. Nothing metered RUNNING one, so a €49 plan
-- could keep fifty storefronts live forever and an agency had no reason to ever
-- climb the ladder. Capacity is the product's natural unit: Urivo makes stores,
-- so "how many can you run" is what a tier should sell.
--
-- Deliberately generous where it matters. A merchant's FIRST SALE — the metric
-- the business is steered by — needs exactly one live store, so the cap never
-- touches the path that decides whether someone succeeds. It binds only on the
-- portfolio operator, who is by definition already past it.
--
-- Enforced here rather than in the API because a count-then-write in
-- application code is a race: two publishes landing together would both read
-- "2 live" and both proceed. This locks the merchant's rows first, so the cap
-- holds under any amount of concurrency.
-- ------------------------------------------------------------

create or replace function public.publish_store(
    p_store_id uuid,
    -- NULL means unlimited (Pro). The caller passes the plan's capacity; the
    -- plan table lives in the app, the enforcement lives here.
    p_max_live integer default null
)
returns table (published boolean, live_count integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_is_live boolean;
    v_live    integer;
begin
    -- Lock every store this merchant owns, so a concurrent publish waits here
    -- rather than racing the count below.
    select s.user_id, s.is_active into v_user_id, v_is_live
    from public.stores s
    where s.id = p_store_id
    for update;

    if v_user_id is null then
        return query select false, 0, 'NOT_FOUND'::text;
        return;
    end if;

    -- Already live: publishing again is a no-op, never a cap failure.
    if v_is_live then
        select count(*)::integer into v_live
        from public.stores where user_id = v_user_id and is_active = true;
        return query select true, v_live, 'ALREADY_LIVE'::text;
        return;
    end if;

    select count(*)::integer into v_live
    from public.stores
    where user_id = v_user_id and is_active = true
    for update;

    if p_max_live is not null and v_live >= p_max_live then
        return query select false, v_live, 'AT_CAPACITY'::text;
        return;
    end if;

    -- published_at is stamped by the 0027 trigger, once and never reset.
    update public.stores set is_active = true, updated_at = now() where id = p_store_id;

    return query select true, v_live + 1, 'PUBLISHED'::text;
end $$;

revoke execute on function public.publish_store(uuid, integer) from public, anon;
grant execute on function public.publish_store(uuid, integer) to service_role;

comment on function public.publish_store(uuid, integer) is
    'Atomically take a store live within the plan''s live-store capacity. NULL capacity = unlimited.';


-- ─────────────────────────────────────────────────────────
-- 0031_custom_domains.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0031 — Custom domains
--
-- A merchant on their own brand's domain is the difference between owning a
-- business and renting a subdomain, and it is the clearest reason to stay
-- subscribed. Available on Founder and Pro.
--
-- The hostname is UNIQUE ACROSS THE PLATFORM, not per store. Two merchants
-- claiming the same domain is not a conflict to resolve later — it is a
-- hijack, and the constraint is the only thing that makes verification
-- meaningful.
-- ------------------------------------------------------------

create table if not exists public.store_domains (
    id           uuid primary key default gen_random_uuid(),
    store_id     uuid not null references public.stores (id) on delete cascade,
    -- Always stored lower-cased and punycode; the app normalises before writing.
    hostname     text not null,
    status       text not null default 'pending'
        check (status in ('pending', 'verifying', 'active', 'failed', 'removed')),
    -- The provider's own id for this hostname (Cloudflare custom hostname,
    -- Vercel domain, …) so the record can be reconciled or deleted later.
    provider     text not null default 'cloudflare',
    provider_id  text,
    -- What the merchant must add at their registrar, as returned by the
    -- provider. Rendered verbatim in the setup screen — never reconstructed,
    -- because a DNS instruction we invented is a support ticket we caused.
    dns_records  jsonb not null default '[]'::jsonb,
    -- Why verification failed, in the provider's words, for the setup screen.
    last_error   text,
    verified_at  timestamptz,
    checked_at   timestamptz,
    created_at   timestamptz not null default now(),

    -- A hostname is a name, not a URL: no scheme, no path, no port, at least
    -- one dot. Apex domains are accepted by the schema; the app decides policy.
    constraint store_domains_hostname_shape check (
        hostname = lower(hostname)
        and hostname !~ '[/:? ]'
        and position('.' in hostname) > 0
        and length(hostname) between 4 and 253
    )
);

-- The whole point: one hostname, one store, platform-wide.
create unique index if not exists idx_store_domains_hostname
    on public.store_domains (hostname)
    where status <> 'removed';

create index if not exists idx_store_domains_store on public.store_domains (store_id);
-- The request path: resolve an incoming Host header to a live store, fast.
create index if not exists idx_store_domains_active
    on public.store_domains (hostname)
    where status = 'active';

alter table public.store_domains enable row level security;

-- Dropped first for the same reason as 0029: policies have no IF NOT EXISTS.

drop policy if exists "store_domains: owner read" on public.store_domains;
create policy "store_domains: owner read" on public.store_domains
    for select using (
        exists (
            select 1 from public.stores s
            where s.id = store_domains.store_id and s.user_id = auth.uid()
        )
    );

-- No insert/update/delete policies: every write goes through the API, which
-- checks the plan, calls the DNS provider and keeps the two in step. A row
-- written directly would claim a hostname the provider has never heard of.

-- ------------------------------------------------------------
-- Resolve an incoming Host header to its store. Definer + anon-executable
-- because the storefront serves anonymous shoppers, and deliberately narrow:
-- it returns a subdomain and nothing else, so it can never become a way to
-- enumerate the platform's domains.
-- ------------------------------------------------------------
create or replace function public.store_for_domain(p_hostname text)
returns table (store_id uuid, subdomain text)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, s.subdomain
    from public.store_domains d
    join public.stores s on s.id = d.store_id
    where d.hostname = lower(btrim(p_hostname))
      and d.status = 'active'
      and s.is_active = true
    limit 1;
$$;

revoke execute on function public.store_for_domain(text) from public;
grant execute on function public.store_for_domain(text) to anon, authenticated, service_role;

comment on table public.store_domains is
    'Merchant-owned hostnames pointing at a Urivo storefront. Unique platform-wide.';


-- ─────────────────────────────────────────────────────────
-- 0032_image_provenance.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0032 — Image provenance
--
-- From 2 August 2026, Article 50 of the EU AI Act requires AI-generated
-- content to be disclosed. Urivo generates product photography, so its stores
-- carry that obligation — and the merchant, not Urivo, is the one publishing.
--
-- The obligation cannot be met with a blanket notice. A merchant who replaced
-- our imagery with their own photographs would then be declaring real work to
-- be synthetic, which is a false statement in the other direction and hands a
-- competitor an easy complaint. So provenance is recorded PER IMAGE, at the
-- moment the image is set, and the storefront discloses only what is true.
-- ------------------------------------------------------------

alter table public.products
    add column if not exists image_source text
        check (image_source is null or image_source in ('ai', 'uploaded', 'supplier', 'placeholder'));

comment on column public.products.image_source is
    'Where image_url came from. Drives the AI disclosure on the storefront (EU AI Act Art. 50). NULL = unknown provenance, disclosed conservatively.';

-- Backfill. Every image Urivo has produced so far came out of the generation
-- pipeline and lives in our own storage bucket; anything else is unknown and
-- stays NULL, which the storefront treats conservatively rather than silently
-- claiming a photograph is real.
update public.products
set image_source = 'ai'
where image_source is null
  and image_url is not null
  and image_url like '%/storage/v1/object/public/%';

-- ------------------------------------------------------------
-- Does this store publish any AI-generated imagery right now?
--
-- One question, answered in one place, so the storefront never has to decide
-- the legal case per render — and so a store whose photos were all replaced
-- stops disclosing automatically.
-- ------------------------------------------------------------
create or replace function public.store_has_ai_imagery(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.products
        where store_id = p_store_id
          and image_url is not null
          -- NULL provenance counts: an image we cannot vouch for is disclosed,
          -- never quietly presented as a photograph.
          and (image_source is null or image_source in ('ai', 'placeholder'))
    );
$$;

revoke execute on function public.store_has_ai_imagery(uuid) from public;
grant execute on function public.store_has_ai_imagery(uuid) to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────
-- 0033_order_volume.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0033 — Order volume
--
-- Urivo takes NO percentage of a merchant's sales. A take rate would tax the
-- merchants who succeed — the ones who become the case studies, the referrals
-- and the reason anyone else signs up — and it would hand a merchant doing
-- €50k a month a standing reason to migrate somewhere that takes nothing.
--
-- Volume moves a merchant up a TIER instead. The difference matters: a tier is
-- capped and predictable, so a merchant at €5k a month pays 4% of revenue and a
-- merchant at €50k pays 0.4%. Success gets cheaper, not more expensive. Nobody
-- churns over a plan; people churn over a percentage.
--
-- THE ONE INVARIANT: this may never block a sale. Refusing a merchant's
-- customer to force an upgrade would take money out of their pocket, which is
-- strictly worse than the take rate we declined to charge. This function only
-- COUNTS; nothing on the checkout path reads it.
-- ------------------------------------------------------------

create or replace function public.monthly_paid_orders(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.orders o
    join public.stores s on s.id = o.store_id
    where s.user_id = p_user_id
      -- Paid and fulfilled both count; a fulfilled order was paid for.
      -- Refunded and cancelled do not: a merchant is not charged a tier for a
      -- sale that came back.
      and o.status in ('paid', 'fulfilled')
      -- Calendar month, so the allowance resets on a date the merchant can
      -- predict rather than on a rolling window they have to reason about.
      and o.created_at >= date_trunc('month', now());
$$;

revoke execute on function public.monthly_paid_orders(uuid) from public, anon;
grant execute on function public.monthly_paid_orders(uuid) to authenticated, service_role;

comment on function public.monthly_paid_orders(uuid) is
    'Paid orders this calendar month across a merchant''s stores. Drives the plan tier prompt. Never consulted on the checkout path.';


-- ─────────────────────────────────────────────────────────
-- 0034_welcome_credits_25.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0034 — Free-tier welcome credits: 20 → 25
--
-- The pricing table promised "25 welcome AI credits" while the database granted
-- 20. A new account therefore read a number on the front page, counted its
-- balance, and found the first promise Urivo ever made to it was false — on the
-- free tier, which is the top of the entire funnel.
--
-- 25 is the deliberate figure, not a round-up: generating a store costs 20, so
-- 25 leaves five credits over. Those five are the only reason a free user ever
-- talks to the assistant, and the assistant is what sells Pro. Twenty credits
-- buys the store and nothing else — the user meets the product exactly once.
--
-- Since 0019 this function is the ONLY place the amount is written (the signup
-- trigger and the confirmation trigger both delegate here), so redefining it is
-- the whole change. Existing users are unaffected: their balance is history and
-- history is correct.
-- ------------------------------------------------------------

create or replace function public.grant_welcome_credits(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Mirrored by PLANS.free.signupCredits in lib/plans.ts. A test reads this
    -- line and fails if the two ever drift again, because they already did:
    -- the number lived in three places and disagreed with itself in two.
    v_welcome_credits constant integer := 25;
begin
    if public.is_email_domain_blocked(p_email) then
        -- Disposable address → no free generation. Recorded for visibility.
        insert into public.audit_logs (user_id, action, resource, resource_id)
        values (p_user_id, 'welcome_credits_withheld', 'profile', p_user_id::text);
        return;
    end if;

    -- The ledger reason is the idempotency guard: granted at most once per
    -- user, so a re-run — or a confirmation trigger firing twice — is a no-op.
    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and reason = 'Free tier welcome credits'
    ) then
        return;
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, v_welcome_credits, 'Free tier welcome credits', 'system');
end;
$$;

comment on function public.grant_welcome_credits(uuid, text) is
    'One-time free-tier grant. Amount mirrors PLANS.free.signupCredits; guarded by the ledger reason.';


-- ─────────────────────────────────────────────────────────
-- 0035_comped_access.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0035 — Comped access (testers, partners, support recovery)
--
-- There was no way to give somebody a real plan without charging them. That
-- makes the pre-launch test phase impossible: a tester cannot exercise the
-- assistant, multiple live stores or the Evolution Lab from the free tier, and
-- asking them to put a card in to do you a favour is not a test, it is a sale
-- with extra steps.
--
-- It also has a second use that outlives the launch. When something goes wrong
-- for a paying customer, the fastest apology is access, not a refund — and
-- issuing it by hand-editing a profile row is how a support gesture turns into
-- a billing incident.
--
-- TWO RULES.
--
-- 1. A COMP MAY NEVER TOUCH A PAYING CUSTOMER. Overwriting the plan of somebody
--    with a live Stripe subscription would silently desynchronise Urivo from
--    Stripe, and the webhook would fight the admin panel over the same column.
--    grant refuses; expiry skips them.
--
-- 2. A COMP MUST END BY ITSELF. Access granted "for a few days" that quietly
--    becomes permanent is indistinguishable from a pricing leak. Every grant
--    carries an expiry, and expiry does not depend on anyone remembering.
--
-- The plan column stays the single truth: a comp WRITES the real plan rather
-- than adding a parallel notion of entitlement, so every gate, dashboard and
-- billing screen in the product keeps working with no knowledge of comps.
-- ------------------------------------------------------------

alter table public.profiles
    -- Non-null = access was granted, not bought, and ends at this moment.
    add column if not exists comped_until timestamptz,
    -- Why, in the admin's words: 'launch tester', 'refund for the 12 Aug outage'.
    add column if not exists comp_reason  text;

-- Expiry sweeps look for the few rows that are comped, never scan the table.
create index if not exists idx_profiles_comped_until
    on public.profiles (comped_until)
    where comped_until is not null;

comment on column public.profiles.comped_until is
    'When granted (not purchased) access ends. Null for normal accounts. Never set for a Stripe subscriber.';

-- ------------------------------------------------------------
-- Grant. Service-role only: it is reached through an admin API route that has
-- already checked the caller is on the ADMIN_EMAILS allow-list.
--
-- Returns a row rather than raising, because every refusal here is an ordinary
-- outcome an admin needs to read ("that address has a subscription", "no such
-- user") and not an error worth a stack trace.
-- ------------------------------------------------------------
create or replace function public.grant_comped_access(
    p_email   text,
    p_plan    text,
    p_days    integer,
    p_credits integer default 0,
    p_reason  text default 'tester'
)
returns table (granted boolean, reason text, user_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile  public.profiles%rowtype;
    v_expires  timestamptz;
begin
    if p_plan not in ('free', 'core', 'pro') then
        return query select false, 'INVALID_PLAN'::text, null::uuid, null::timestamptz;
        return;
    end if;

    -- An unbounded comp is the leak this function exists to prevent, and a
    -- year-long one is the same leak with a slower fuse.
    if p_days is null or p_days < 1 or p_days > 365 then
        return query select false, 'INVALID_DURATION'::text, null::uuid, null::timestamptz;
        return;
    end if;

    if p_credits is null or p_credits < 0 or p_credits > 5000 then
        return query select false, 'INVALID_CREDITS'::text, null::uuid, null::timestamptz;
        return;
    end if;

    select * into v_profile
    from public.profiles
    where email = lower(btrim(p_email))
    for update;

    if v_profile.id is null then
        -- Deliberately not an invitation system: the person signs up normally,
        -- then gets upgraded. Creating auth users from here would bypass email
        -- confirmation, the disposable-domain blocklist and the signup throttle.
        return query select false, 'NO_SUCH_USER'::text, null::uuid, null::timestamptz;
        return;
    end if;

    -- Rule 1.
    if v_profile.stripe_subscription_id is not null
       or v_profile.subscription_status = 'active' then
        return query select false, 'HAS_SUBSCRIPTION'::text, v_profile.id, null::timestamptz;
        return;
    end if;

    -- Re-granting extends from now rather than stacking, so running the same
    -- command twice cannot quietly double someone's access.
    v_expires := now() + make_interval(days => p_days);

    update public.profiles
    set plan         = p_plan,
        comped_until = v_expires,
        comp_reason  = nullif(btrim(p_reason), ''),
        updated_at   = now()
    where id = v_profile.id;

    if p_credits > 0 then
        insert into public.credit_ledger (user_id, delta, reason, source)
        values (v_profile.id, p_credits, 'Comped access credits', 'system');
    end if;

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (v_profile.id, 'comped_access_granted', 'profile', v_profile.id::text);

    return query select true, 'OK'::text, v_profile.id, v_expires;
end;
$$;

revoke execute on function public.grant_comped_access(text, text, integer, integer, text)
    from public, anon, authenticated;
grant execute on function public.grant_comped_access(text, text, integer, integer, text)
    to service_role;

-- ------------------------------------------------------------
-- Revoke early — a tester who drops out, or a comp granted to the wrong
-- address. Drops them to free immediately; never touches a subscriber.
-- ------------------------------------------------------------
create or replace function public.revoke_comped_access(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    update public.profiles
    set plan         = 'free',
        comped_until = null,
        comp_reason  = null,
        updated_at   = now()
    where email = lower(btrim(p_email))
      and comped_until is not null
      and stripe_subscription_id is null
      and subscription_status <> 'active'
    returning id into v_id;

    if v_id is not null then
        insert into public.audit_logs (user_id, action, resource, resource_id)
        values (v_id, 'comped_access_revoked', 'profile', v_id::text);
    end if;

    return v_id is not null;
end;
$$;

revoke execute on function public.revoke_comped_access(text) from public, anon, authenticated;
grant execute on function public.revoke_comped_access(text) to service_role;

-- ------------------------------------------------------------
-- Rule 2, enforced. Idempotent and cheap enough to call opportunistically from
-- the application, which is exactly how it is called: expiry that depends on a
-- scheduler somebody has to configure is expiry that will not happen during a
-- four-day test phase.
--
-- A comped user who subscribed in the meantime keeps their plan — Stripe owns
-- it now — and merely loses the marker.
-- ------------------------------------------------------------
create or replace function public.expire_comped_access()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_expired integer;
begin
    with downgraded as (
        update public.profiles
        set plan         = 'free',
            comped_until = null,
            comp_reason  = null,
            updated_at   = now()
        where comped_until is not null
          and comped_until < now()
          and stripe_subscription_id is null
          and subscription_status <> 'active'
        returning id
    )
    select count(*)::integer into v_expired from downgraded;

    -- They started paying during the comp: the marker is stale, the plan is not.
    update public.profiles
    set comped_until = null,
        comp_reason  = null
    where comped_until is not null
      and (stripe_subscription_id is not null or subscription_status = 'active');

    return v_expired;
end;
$$;

revoke execute on function public.expire_comped_access() from public, anon, authenticated;
grant execute on function public.expire_comped_access() to service_role;

-- ------------------------------------------------------------
-- Who currently has granted access, for the admin screen.
-- ------------------------------------------------------------
create or replace function public.comped_accounts()
returns table (
    email        text,
    full_name    text,
    plan         text,
    comp_reason  text,
    comped_until timestamptz,
    credits      integer,
    stores       integer
)
language sql
stable
security definer
set search_path = public
as $$
    select p.email,
           p.full_name,
           p.plan,
           p.comp_reason,
           p.comped_until,
           coalesce((select sum(l.delta)::integer from public.credit_ledger l where l.user_id = p.id), 0),
           (select count(*)::integer from public.stores s where s.user_id = p.id)
    from public.profiles p
    where p.comped_until is not null
    order by p.comped_until asc;
$$;

revoke execute on function public.comped_accounts() from public, anon, authenticated;
grant execute on function public.comped_accounts() to service_role;


-- ─────────────────────────────────────────────────────────
-- 0036_feedback.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0036 — In-product feedback
--
-- The test phase before launch produces exactly one asset: what the testers
-- tell us. Collected in a chat thread it arrives as "the store thing didn't
-- work" with no page, no store, no browser and no time — and by the time
-- anyone asks, the tester has moved on and cannot remember either.
--
-- Captured from inside the product it arrives with the route, the store, the
-- plan and the viewport already attached, because the application knows all
-- four at the moment the button is pressed and the person does not have to be
-- asked for any of them.
--
-- This is deliberately not a support inbox. It is a funnel instrument: the
-- North Star is the share of merchants who reach a first real sale, and the
-- only way to learn where that path breaks is to record where people were
-- standing when it broke.
-- ------------------------------------------------------------

create table if not exists public.feedback (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    -- Denormalised on purpose: feedback must survive the account being deleted
    -- long enough to be acted on, and an admin reading the list needs to know
    -- who it was without a join to a row that may be gone.
    email      text not null,
    kind       text not null default 'bug'
        check (kind in ('bug', 'confusing', 'idea', 'praise')),
    message    text not null,
    -- Where they were. The single most valuable field in the table.
    route      text,
    store_id   uuid references public.stores (id) on delete set null,
    -- Plan at the time of writing; a complaint about credits means something
    -- different on Free than on Pro, and the plan may change before anyone reads it.
    plan       text,
    -- Viewport, user agent, screen size — whatever the client can state about
    -- itself. Free-form because the useful fields change faster than a schema.
    context    jsonb not null default '{}'::jsonb,
    resolved_at timestamptz,
    admin_note  text,
    created_at timestamptz not null default now(),

    constraint feedback_message_length check (length(btrim(message)) between 3 and 4000)
);

create index if not exists idx_feedback_created on public.feedback (created_at desc);
create index if not exists idx_feedback_open
    on public.feedback (created_at desc)
    where resolved_at is null;
create index if not exists idx_feedback_user on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

-- Postgres has no `create policy if not exists`; dropping first keeps a re-run
-- of the catch-up script from failing with 42710 and rolling everything back.
drop policy if exists "feedback: author read" on public.feedback;
create policy "feedback: author read" on public.feedback
    for select using (user_id = auth.uid());

-- No insert policy: submissions go through the RPC below, which stamps the
-- email and plan from the server's own view of the account. A client-supplied
-- plan on a bug report about plan gating is worth nothing.

-- ------------------------------------------------------------
-- Submit. Definer, and executable by any signed-in user.
-- ------------------------------------------------------------
create or replace function public.submit_feedback(
    p_message  text,
    p_kind     text default 'bug',
    p_route    text default null,
    p_store_id uuid default null,
    p_context  jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user    uuid := auth.uid();
    v_email   text;
    v_plan    text;
    v_recent  integer;
begin
    if v_user is null then
        return false;
    end if;

    if p_message is null or length(btrim(p_message)) < 3 then
        return false;
    end if;

    select email, plan into v_email, v_plan from public.profiles where id = v_user;
    if v_email is null then
        return false;
    end if;

    -- A stuck send button retrying, or somebody bored. Twenty an hour is far
    -- more than an honest tester needs and far less than a nuisance.
    select count(*)::integer into v_recent
    from public.feedback
    where user_id = v_user and created_at > now() - interval '1 hour';
    if v_recent >= 20 then
        return false;
    end if;

    insert into public.feedback (user_id, email, kind, message, route, store_id, plan, context)
    values (
        v_user,
        v_email,
        case when p_kind in ('bug', 'confusing', 'idea', 'praise') then p_kind else 'bug' end,
        left(btrim(p_message), 4000),
        left(coalesce(p_route, ''), 500),
        -- Only accept a store the sender actually owns, so the field cannot be
        -- used to probe which store ids exist.
        (select s.id from public.stores s where s.id = p_store_id and s.user_id = v_user),
        v_plan,
        coalesce(p_context, '{}'::jsonb)
    );

    return true;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.submit_feedback(text, text, text, uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- The admin inbox. Newest first, open items first — during a test phase the
-- only question is "what is still broken".
-- ------------------------------------------------------------
create or replace function public.feedback_inbox(p_limit integer default 100)
returns table (
    id          uuid,
    email       text,
    kind        text,
    message     text,
    route       text,
    plan        text,
    store_name  text,
    context     jsonb,
    resolved_at timestamptz,
    created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select f.id, f.email, f.kind, f.message, f.route, f.plan,
           s.store_name, f.context, f.resolved_at, f.created_at
    from public.feedback f
    left join public.stores s on s.id = f.store_id
    order by (f.resolved_at is null) desc, f.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke execute on function public.feedback_inbox(integer) from public, anon, authenticated;
grant execute on function public.feedback_inbox(integer) to service_role;

create or replace function public.resolve_feedback(p_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    update public.feedback
    set resolved_at = case when resolved_at is null then now() else null end,
        admin_note  = coalesce(nullif(btrim(p_note), ''), admin_note)
    where id = p_id
    returning id into v_id;
    return v_id is not null;
end;
$$;

revoke execute on function public.resolve_feedback(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_feedback(uuid, text) to service_role;

comment on table public.feedback is
    'In-product feedback with the route, store and plan attached. Funnel instrument, not a support inbox.';


-- ─────────────────────────────────────────────────────────
-- 0037_economics.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0038_ad_attribution.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0038 — Ad attribution: which ad actually made money
--
-- Ad Studio generated ads and forgot them. The plan came back as JSON, the
-- merchant copied it into Meta, and nothing in Urivo ever learned whether a
-- single one of those ads worked. The second run for a store knew nothing
-- about the first. That is a generator, not a marketing system, and nobody
-- abandons their existing tools for a generator — ad copy is the one thing
-- every AI writes for free.
--
-- THE ADVANTAGE URIVO HAS AND NOBODY ELSE DOES. Attribution is normally hard:
-- the ad platform owns the click, the shop owns the sale, and stitching them
-- together needs a pixel that iOS and ad blockers quietly break — Meta's own
-- reporting routinely loses a third of conversions this way. Urivo owns BOTH
-- ENDS in one database. The storefront that receives the click and the order
-- that closes the sale are two rows here. No pixel, no third party, no
-- guessing: the join is exact, server-side, and cannot be blocked.
--
-- Three pieces:
--   1. ad_creatives — a generated ad becomes a real object with an id, so
--      there is something to attribute TO.
--   2. store_visits gains the creative that sent the visitor.
--   3. orders gain the visit's session, which is what turns "this ad got
--      clicks" into "this ad made €258".
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The ads themselves
-- ------------------------------------------------------------
create table if not exists public.ad_creatives (
    id          uuid primary key default gen_random_uuid(),
    store_id    uuid not null references public.stores (id) on delete cascade,
    -- Groups the 5–8 creatives produced by one "Generate ads" click, so a run
    -- can be compared against the run before it.
    run_id      uuid not null,
    platform    text not null,
    format      text not null default '',
    angle       text not null default '',
    headline    text not null,
    primary_text text not null default '',
    cta         text not null default '',
    -- Set when the merchant marks an ad as actually running. Ads that were
    -- generated and never used must not drag down the averages the next
    -- generation reads.
    launched_at timestamptz,
    archived_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists idx_ad_creatives_store on public.ad_creatives (store_id, created_at desc);
create index if not exists idx_ad_creatives_run on public.ad_creatives (run_id);

alter table public.ad_creatives enable row level security;

drop policy if exists "ad_creatives: owner read" on public.ad_creatives;
create policy "ad_creatives: owner read" on public.ad_creatives
    for select using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

drop policy if exists "ad_creatives: owner update" on public.ad_creatives;
create policy "ad_creatives: owner update" on public.ad_creatives
    for update using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

-- No insert policy: creatives are written by the generation route under
-- service_role, immediately after the model returns them. A client-written
-- creative would be an ad nobody generated, attributed to traffic nobody sent.

comment on table public.ad_creatives is
    'Generated ads, persisted so their traffic and revenue can be attributed back to them.';

-- ------------------------------------------------------------
-- 2. Which ad sent this visit
--
-- The link arrives as ?uc=<creative id> on the storefront URL. Stored as a
-- plain uuid with ON DELETE SET NULL: deleting an ad must never delete the
-- traffic history that proves what it did.
-- ------------------------------------------------------------
alter table public.store_visits
    add column if not exists creative_id uuid references public.ad_creatives (id) on delete set null,
    -- Free-text UTM campaign, for traffic Urivo did not generate the ad for
    -- (a merchant's own newsletter, an influencer link). Kept separate from
    -- creative_id so "our ads" and "everything else" never blur together.
    add column if not exists utm_campaign text,
    add column if not exists utm_source text;

create index if not exists idx_store_visits_creative
    on public.store_visits (creative_id, created_at desc)
    where creative_id is not null;

-- ------------------------------------------------------------
-- 3. Which visit became this order
--
-- The session hash is the same anonymous per-session id the visit beacon
-- already sends — no cookie, no PII, no new tracking. It is simply carried
-- through checkout so the sale can be joined back to the click.
--
-- first_touch_creative is denormalised onto the order deliberately: a visit
-- row can be pruned or a creative deleted, and the revenue attribution must
-- survive both. Reconstructing it later from a join that no longer resolves
-- is how attribution silently rots.
-- ------------------------------------------------------------
alter table public.orders
    add column if not exists session_hash text,
    add column if not exists creative_id uuid references public.ad_creatives (id) on delete set null;

create index if not exists idx_orders_creative
    on public.orders (creative_id)
    where creative_id is not null;

-- ------------------------------------------------------------
-- Performance per creative. THE function that closes the loop: what the
-- merchant sees, and what the next generation is told.
--
-- Clicks are distinct sessions, not raw pageviews — a visitor who reloads
-- four times is one click, and counting otherwise would make every ad look
-- four times better than it is.
-- ------------------------------------------------------------
create or replace function public.ad_performance(p_store_id uuid)
returns table (
    creative_id   uuid,
    run_id        uuid,
    platform      text,
    headline      text,
    angle         text,
    launched_at   timestamptz,
    clicks        integer,
    orders        integer,
    revenue_cents integer,
    created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select c.id,
           c.run_id,
           c.platform,
           c.headline,
           c.angle,
           c.launched_at,
           coalesce((
               select count(distinct v.session_hash)::integer
               from public.store_visits v
               where v.creative_id = c.id
           ), 0),
           coalesce((
               select count(*)::integer
               from public.orders o
               where o.creative_id = c.id and o.status in ('paid', 'fulfilled')
           ), 0),
           coalesce((
               select sum(o.amount_total)::integer
               from public.orders o
               where o.creative_id = c.id and o.status in ('paid', 'fulfilled')
           ), 0),
           c.created_at
    from public.ad_creatives c
    where c.store_id = p_store_id
      and c.archived_at is null
    order by c.created_at desc;
$$;

revoke execute on function public.ad_performance(uuid) from public, anon;
grant execute on function public.ad_performance(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- Attribute an order to the ad that earned it.
--
-- FIRST TOUCH, not last: the ad that introduced the brand is the one that did
-- the work, and last-touch would hand every sale to whatever retargeting ad
-- happened to be shown before checkout. Definer + service_role because it is
-- called from the Stripe webhook, which has no user session.
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
begin
    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        return null;
    end if;

    select store_id into v_store from public.orders where id = p_order_id;
    if v_store is null then
        return null;
    end if;

    -- The earliest visit in this session that carried a creative.
    select v.creative_id into v_creative
    from public.store_visits v
    where v.session_hash = p_session_hash
      and v.store_id = v_store
      and v.creative_id is not null
    order by v.created_at asc
    limit 1;

    update public.orders
    set session_hash = p_session_hash,
        creative_id  = v_creative
    where id = p_order_id;

    return v_creative;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;

comment on function public.ad_performance(uuid) is
    'Clicks, orders and revenue per generated ad. Exact rather than pixel-based: Urivo owns both the click and the sale.';


-- ─────────────────────────────────────────────────────────
-- 0039_attribution_model.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0039 — The attribution model (specifications/10-attribution.md)
--
-- 0038 built the chain: click -> visit -> order. This makes it correct.
--
-- What was wrong, in order of how much money it moves:
--
--   1. NO WINDOW. The session lived in sessionStorage, so attribution ended
--      when the browser tab closed. Every considered purchase — click today,
--      buy tomorrow — was reported as zero next to the ad that caused it. A
--      measurement system that silently under-reports makes merchants switch
--      off ads that were working. §3
--
--   2. NOT IDEMPOTENT. attribute_order overwrote on every call, and Stripe
--      delivers webhooks at least once. A retry could rewrite a decision the
--      merchant had already read. §8
--
--   3. NO OWNERSHIP CHECK. A ?uc= belonging to another store attributed
--      happily. Copy a competitor's tracked link, and their ad takes credit
--      for your sale. §5
--
--   4. REPEAT PURCHASES CREDITED. One good ad quietly absorbed a year of
--      loyal revenue and looked unbeatable, after which every budget decision
--      ran against a number that was mostly not about advertising. §6
--
-- The architectural rule this preserves: every click stays a row, and the
-- attribution rule is applied when the report is read. Changing to last-touch
-- or time-decay later is a query change, not a migration, and not a year of
-- history thrown away. §4
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. Bot traffic never enters the numbers
--
-- Excluded from BOTH sides of every ratio: counting a crawler in the
-- denominator depresses conversion exactly as counting it in the numerator
-- inflates clicks. Stored rather than dropped so a merchant asking "where did
-- my visitor go" gets an answer instead of a shrug. §13
-- ------------------------------------------------------------
alter table public.store_visits
    add column if not exists is_bot boolean not null default false,
    add column if not exists bot_reason text;

-- Every read of real traffic filters on this, so it leads the index.
create index if not exists idx_store_visits_human
    on public.store_visits (store_id, created_at desc)
    where is_bot = false;

comment on column public.store_visits.is_bot is
    'Automated client (crawler, link unfurler, monitor). Excluded from every metric on both sides of the ratio.';

-- ------------------------------------------------------------
-- 2. How an order was attributed, recorded with the decision
--
-- The basis is as important as the answer. "Attributed to nothing" and
-- "deliberately excluded because this is a returning customer" are different
-- facts, and a dashboard that cannot tell them apart cannot be honest. §14
-- ------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_type where typname = 'attribution_basis') then
        create type public.attribution_basis as enum (
            'creative',   -- joined to a specific ad inside the window
            'returning',  -- known customer; excluded from ad attribution by rule
            'expired',    -- a tracked click exists, but outside the window
            'none'        -- direct, organic, or no tracked click at all
        );
    end if;
end $$;

alter table public.orders
    add column if not exists attribution_basis public.attribution_basis not null default 'none',
    add column if not exists attributed_at timestamptz;

comment on column public.orders.attribution_basis is
    'Why this order carries the creative it carries — or why it carries none. See specifications/10-attribution.md.';

-- ------------------------------------------------------------
-- 3. The window, in one place
--
-- A policy, not a constant scattered through the code. Changing it changes
-- reporting; it never requires a migration, because the raw click events are
-- retained independently of it. §3
-- ------------------------------------------------------------
create or replace function public.attribution_window()
returns interval
language sql
immutable
as $$ select interval '7 days' $$;

comment on function public.attribution_window() is
    'Click-to-paid-order window. 7 days: long enough for a considered purchase, short enough that the commerce session stays defensible as cart continuity.';

-- ------------------------------------------------------------
-- 4. Attribute an order — the whole model in one function
--
-- Order of the checks is the order of the rules, and each one is a decision
-- the merchant can be shown rather than a silent skip.
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
    v_had_click boolean;
begin
    select store_id, lower(btrim(customer_email)), created_at, attribution_basis
      into v_store, v_email, v_placed, v_existing
      from public.orders
     where id = p_order_id;

    if v_store is null then
        return null;
    end if;

    /*
     * FIRST WRITE WINS. Stripe retries on any non-2xx and may deliver out of
     * order; without this a retry could rewrite a decision the merchant has
     * already read. A number that changes after it has been seen is worse
     * than one that is slightly conservative. §8
     */
    if v_existing <> 'none' then
        return (select creative_id from public.orders where id = p_order_id);
    end if;

    /*
     * RETURNING CUSTOMERS ARE NOT AD ACQUISITIONS. Checked before the session
     * lookup, because a returning customer who clicks an ad is still a
     * returning customer — crediting the ad would let it absorb loyal revenue
     * indefinitely and look unbeatable. Ad Studio measures acquisition; this
     * revenue is reported separately. §6
     */
    if v_email is not null and length(v_email) > 0 and exists (
        select 1 from public.orders o
         where o.store_id = v_store
           and o.id <> p_order_id
           and lower(btrim(o.customer_email)) = v_email
           and o.status in ('paid', 'fulfilled', 'refunded')
           and o.created_at < v_placed
    ) then
        update public.orders
           set attribution_basis = 'returning',
               session_hash      = coalesce(p_session_hash, session_hash),
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        update public.orders set attribution_basis = 'none', attributed_at = now() where id = p_order_id;
        return null;
    end if;

    /*
     * FIRST TOUCH inside the window. Last touch would hand nearly every sale
     * to whatever retargeting ad ran immediately before checkout — the most
     * common way a small budget drifts toward the channel that did least. §4
     *
     * The creative must belong to THIS store: a tracked link copied from
     * somewhere else must never take credit here. §5
     *
     * Bots are excluded at the source, so a crawler that followed the link
     * cannot become the first touch. §13
     */
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
               attribution_basis = 'creative',
               attributed_at     = now()
         where id = p_order_id;
        return v_creative;
    end if;

    /*
     * A tracked click exists but fell outside the window. Distinct from "no
     * ad involved at all" — the merchant should see that their window is what
     * cost them the credit, not conclude the ad did nothing. §12
     */
    select exists (
        select 1 from public.store_visits v
         where v.session_hash = p_session_hash
           and v.store_id     = v_store
           and v.creative_id is not null
           and v.is_bot       = false
    ) into v_had_click;

    update public.orders
       set session_hash      = p_session_hash,
           attribution_basis = case when v_had_click then 'expired' else 'none' end,
           attributed_at     = now()
     where id = p_order_id;

    return null;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;

-- ------------------------------------------------------------
-- 5. Performance per creative — net of refunds, humans only
--
-- Revenue must match money the merchant actually kept, or it will be used to
-- justify spend against income that was returned. An ad showing orders with
-- near-zero revenue is a real signal: usually the wrong buyer. §10
-- ------------------------------------------------------------

-- Declared before the function that reads it: PostgreSQL parses a SQL-language
-- body at creation time, so a column added afterwards would fail the migration.
alter table public.orders
    add column if not exists amount_refunded integer not null default 0
        check (amount_refunded >= 0);

create or replace function public.ad_performance(p_store_id uuid)
returns table (
    creative_id   uuid,
    run_id        uuid,
    platform      text,
    headline      text,
    angle         text,
    launched_at   timestamptz,
    clicks        integer,
    orders        integer,
    revenue_cents integer,
    created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select c.id,
           c.run_id,
           c.platform,
           c.headline,
           c.angle,
           c.launched_at,
           coalesce((
               -- Distinct sessions, never pageviews: a visitor who reloads
               -- four times is one click. Bots are not visitors at all.
               select count(distinct v.session_hash)::integer
               from public.store_visits v
               where v.creative_id = c.id and v.is_bot = false
           ), 0),
           coalesce((
               select count(*)::integer
               from public.orders o
               where o.creative_id = c.id
                 and o.attribution_basis = 'creative'
                 and o.status in ('paid', 'fulfilled')
           ), 0),
           coalesce((
               select sum(o.amount_total - coalesce(o.amount_refunded, 0))::integer
               from public.orders o
               where o.creative_id = c.id
                 and o.attribution_basis = 'creative'
                 and o.status in ('paid', 'fulfilled')
           ), 0),
           c.created_at
    from public.ad_creatives c
    where c.store_id = p_store_id
      and c.archived_at is null
    order by c.created_at desc;
$$;

revoke execute on function public.ad_performance(uuid) from public, anon;
grant execute on function public.ad_performance(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Retention — a period that only exists in a document is not a period
--
-- Click events outlive the 7-day window by a wide margin on purpose, so a
-- webhook delayed by hours or days still attributes correctly. That headroom
-- is the concrete advantage of holding the window on the server rather than on
-- a device that may have cleared its storage. §11
-- ------------------------------------------------------------
create or replace function public.expire_click_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer;
begin
    delete from public.store_visits
     where created_at < now() - interval '90 days';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end $$;

revoke execute on function public.expire_click_events() from public, anon, authenticated;
grant execute on function public.expire_click_events() to service_role;

comment on function public.expire_click_events() is
    'Deletes click events past the 90-day retention window. Run daily.';


-- ─────────────────────────────────────────────────────────
-- 0040_attribution_coverage.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0040 — Attribution coverage (specifications/10-attribution.md §14)
--
-- The number that makes every other number trustworthy.
--
-- A merchant shown "€258 from your ads" concludes their ads produced €258.
-- Shown "€258 attributed · €340 not attributable · 43% coverage" they reason
-- correctly — and they can see that the gap is mostly returning customers, or
-- mostly people who bought without ever clicking a tracked link, which are
-- entirely different problems with entirely different fixes.
--
-- No advertising platform reports its own blind spots. That is the point.
--
-- The invariant this exists to make checkable (§16.4): attributed and
-- not-attributable revenue must sum to total paid revenue. No euro may fall
-- between the two buckets — a coverage figure that quietly loses revenue is
-- worse than no coverage figure, because it looks like arithmetic.
-- ------------------------------------------------------------

create or replace function public.attribution_coverage(p_store_id uuid, p_days integer default 30)
returns table (
    -- Joined to a specific ad inside the window.
    attributed_orders   integer,
    attributed_cents    integer,
    -- Known customer. Deliberately excluded from ad attribution (§6) — this is
    -- retention revenue, and reporting it as an ad result would let one good ad
    -- absorb a year of loyalty and look unbeatable.
    returning_orders    integer,
    returning_cents     integer,
    -- A tracked click exists, but outside the 7-day window. Distinct from "no
    -- ad involved": the merchant should see that the window cost them the
    -- credit, not conclude the ad did nothing.
    expired_orders      integer,
    expired_cents       integer,
    -- Direct, organic, cross-device, or an ad launched without a tracked link.
    unattributed_orders integer,
    unattributed_cents  integer,
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
               -- Net of refunds everywhere, so coverage is computed on money
               -- the merchant actually kept (§10).
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
        /*
         * 'none' is named explicitly rather than caught by an else-branch. If a
         * future basis is added and this function is not updated, its revenue
         * must go MISSING from a bucket — loudly breaking the sum invariant —
         * rather than being silently absorbed into "direct" and misreported as
         * traffic the merchant never bought.
         */
        coalesce(count(*) filter (where basis = 'none'), 0)::integer,
        coalesce(sum(net) filter (where basis = 'none'), 0)::integer,
        coalesce(count(*), 0)::integer,
        coalesce(sum(net), 0)::integer
    from paid;
$$;

revoke execute on function public.attribution_coverage(uuid, integer) from public, anon;
grant execute on function public.attribution_coverage(uuid, integer) to authenticated, service_role;

comment on function public.attribution_coverage(uuid, integer) is
    'Attributed vs not-attributable revenue for a store, split by reason. The buckets must sum to the total — see specifications/10-attribution.md §16.4.';


-- ─────────────────────────────────────────────────────────
-- 0041_fix_attribution_basis_cast.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0041 — Fix: attribute_order raised on every unattributed order
--
-- 0039 ended with:
--
--     attribution_basis = case when v_had_click then 'expired' else 'none' end
--
-- The CASE yields `text`; the column is an enum. PostgreSQL refuses the
-- assignment with 42804 rather than coercing it, so EVERY order that reached
-- the final branch — all direct traffic, and every click that fell outside the
-- window — raised instead of being labelled.
--
-- It failed silently, which is the worst part. attribute_order is called
-- best-effort from the Stripe webhook so an order is never lost to an
-- attribution problem, and that same safety net swallowed the exception. The
-- orders then kept the column default, 'none', which is the correct answer for
-- direct traffic and the WRONG answer for an expired click — the two became
-- indistinguishable, which is precisely the distinction §12 exists to draw.
-- Nothing logged, nothing broke, and the coverage split would have quietly
-- under-reported the "outside the window" bucket forever.
--
-- Found by checking the RPC's HTTP status in an end-to-end run rather than
-- only reading the row afterwards: the row looked plausible, and the response
-- was a 400.
--
-- Also stamped: session_hash and attributed_at on these orders, which the
-- raised statement never wrote.
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

    -- First write wins: a Stripe retry must never rewrite a decision the
    -- merchant has already read (§8).
    if v_existing <> 'none' then
        return (select creative_id from public.orders where id = p_order_id);
    end if;

    -- A returning customer is not an ad acquisition, even when they clicked
    -- one. Checked first, so a good ad cannot absorb loyal revenue (§6).
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
        update public.orders
           set attribution_basis = 'none'::public.attribution_basis,
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    -- First touch inside the window, this store's own ad, humans only
    -- (§4, §5, §13).
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

    /*
     * Resolved into a typed variable rather than cast inline. The inline CASE
     * is what broke: it is easy to write, easy to read, and silently produces
     * `text` where an enum is required.
     *
     * 'expired' rather than 'none' when a tracked click exists but fell outside
     * the window — the merchant should see that the window cost them the
     * credit, not conclude the ad did nothing (§12).
     */
    if exists (
        select 1 from public.store_visits v
         where v.session_hash = p_session_hash
           and v.store_id     = v_store
           and v.creative_id is not null
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


-- ─────────────────────────────────────────────────────────
-- 0042_expired_requires_own_ad.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0042 — 'expired' must mean OUR ad, not any ad
--
-- 0041 decided between 'expired' and 'none' with:
--
--     exists (select 1 from store_visits v
--              where v.session_hash = ... and v.store_id = v_store
--                and v.creative_id is not null and v.is_bot = false)
--
-- The attribution query one block above joins ad_creatives and requires the
-- creative to belong to this store (§5). This check does not — so a visit
-- carrying ANOTHER store's creative id counts as "there was a click", and the
-- order is labelled 'expired'.
--
-- The number stays right and the sentence goes wrong, which is the harder
-- failure to notice. 'expired' tells the merchant their 7-day window cost them
-- the credit and invites them to think about consideration cycles — when in
-- fact the link was never theirs. Somebody pasted a tracked URL copied from
-- elsewhere, and the honest label is 'none'.
--
-- Caught because the end-to-end run prints the basis next to every assertion.
-- The assertion itself only checked that no creative was credited, which was
-- true; the label beside it was wrong. Checking the value without checking the
-- word for it is how a misleading dashboard passes its own tests.
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

    -- First write wins: a Stripe retry must never rewrite a decision the
    -- merchant has already read (§8).
    if v_existing <> 'none' then
        return (select creative_id from public.orders where id = p_order_id);
    end if;

    -- A returning customer is not an ad acquisition, even when they clicked
    -- one. Checked first, so a good ad cannot absorb loyal revenue (§6).
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
        update public.orders
           set attribution_basis = 'none'::public.attribution_basis,
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    -- First touch inside the window, this store's own ad, humans only
    -- (§4, §5, §13).
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

    /*
     * 'expired' only when one of THIS store's own ads was clicked outside the
     * window — the same ownership join as the attribution query above, minus
     * the time bound. Without the join, a tracked link copied from another
     * store would be reported to this merchant as their own window expiring.
     */
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


-- ─────────────────────────────────────────────────────────
-- 0043_attribution_unknown.sql
-- ─────────────────────────────────────────────────────────
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
/*
 * Dropped first, not replaced. `create or replace` cannot change a function's
 * OUT parameters, and adding the two unknown_* columns changes the returned
 * row type — PostgreSQL rejects it with 42P13. Grants are re-issued below,
 * because a drop takes them with it.
 */
drop function if exists public.attribution_coverage(uuid, integer);

create function public.attribution_coverage(p_store_id uuid, p_days integer default 30)
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


-- ─────────────────────────────────────────────────────────
-- 0044_click_retention.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0044 — Click-event retention (specifications/10-attribution.md §11)
--
-- A retention period that exists only in a document is not a retention period.
--
-- 0039 shipped expire_click_events as a bare DELETE. It was never scheduled,
-- so nothing was ever deleted, and it deleted indiscriminately — which matters
-- more than it sounds:
--
--   A visit still referenced by an order is EVIDENCE. orders.creative_id is
--   denormalised so revenue attribution survives, but the visit row is the
--   record of how that decision was reached. Deleting it while the order still
--   points at the ad leaves an attribution nobody can audit — and for a refund
--   dispute or a tax question, "the system says so" is not an answer.
--
-- So retention is selective: visits are deleted once they are past the window
-- AND no order depends on them. Everything else is kept and counted, so the
-- job can report what it declined to remove rather than staying silent.
-- ------------------------------------------------------------

create or replace function public.expire_click_events(p_days integer default 90)
returns table (deleted integer, retained_for_orders integer, cutoff timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cutoff  timestamptz := now() - make_interval(days => greatest(p_days, 1));
    v_deleted integer := 0;
    v_kept    integer := 0;
begin
    /*
     * Kept despite being old: the session is named by an order, so this row is
     * the audit trail for a financial record. Counted first so the number is
     * reported even when nothing is deleted.
     */
    select count(*)::integer into v_kept
      from public.store_visits v
     where v.created_at < v_cutoff
       and exists (
           select 1 from public.orders o
            where o.session_hash = v.session_hash
              and o.store_id     = v.store_id
       );

    delete from public.store_visits v
     where v.created_at < v_cutoff
       and not exists (
           select 1 from public.orders o
            where o.session_hash = v.session_hash
              and o.store_id     = v.store_id
       );
    get diagnostics v_deleted = row_count;

    /*
     * Idempotent by construction: the predicate is a property of the rows, not
     * of a cursor or a run log. A second run in the same minute deletes nothing
     * because nothing matches any more.
     */
    return query select v_deleted, v_kept, v_cutoff;
end $$;

revoke execute on function public.expire_click_events(integer) from public, anon, authenticated;
grant execute on function public.expire_click_events(integer) to service_role;

comment on function public.expire_click_events(integer) is
    'Deletes click events past the retention window, except those still referenced by an order. Idempotent; returns what it removed and what it kept.';

-- The old zero-argument form would otherwise linger and shadow the new one.
drop function if exists public.expire_click_events();


-- ─────────────────────────────────────────────────────────
-- 0045_column_privileges.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0045 — Column privileges: stop a logged-in user writing their own entitlement
--
-- Row Level Security answers "which ROWS may this user touch". It has nothing
-- to say about which COLUMNS. Every policy here was written correctly against
-- that question — `auth.uid() = id`, `auth.uid() = user_id` — and every one of
-- them was still wide open, because owning the row was enough.
--
-- The anon key ships to the browser by design; a signed-in user holds a real
-- `authenticated` session against PostgREST. So both of these ran, from a
-- console, against a correct policy:
--
--     supabase.from('profiles').update({ plan: 'pro',
--                                        subscription_status: 'active' })
--             .eq('id', myId)                       -- → Pro, for free, forever
--
--     supabase.from('stores').update({ is_active: true })
--             .eq('user_id', myId)                  -- → every store live, on Free
--
-- The second one bypassed `publish_store` entirely — the function that holds the
-- live-store cap under a lock, and the reason capacity was believed to be
-- enforced in the database rather than in application code. A cap is only a cap
-- if the column behind it cannot be written directly.
--
-- The fix is the privilege system, not another policy: REVOKE the blanket
-- UPDATE and grant back only the columns a user is genuinely allowed to set
-- about themselves. Everything that decides money, access or capacity is now
-- writable exclusively by `service_role` — which is where the webhook, the
-- admin RPCs and `publish_store` already write from.
--
-- RLS still applies on top: these grants say WHICH COLUMNS, the policies still
-- say WHICH ROWS. A user needs both, and now has exactly both.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- PROFILES — a user may edit their display name and their email preference.
-- Nothing else: plan, subscription_status, price_type, comped_until and every
-- stripe_* column are set by the Stripe webhook or an admin RPC.
--
-- INSERT is the `handle_new_user` trigger's job (security definer) and DELETE
-- happens through account deletion on auth.users, so neither is granted here.
-- ------------------------------------------------------------
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, marketing_opt_in) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- STORES — a user may rename their store and restyle it.
--
-- is_active is deliberately absent: publishing is a paid capability and a
-- capacity decision, so it belongs to `publish_store` alone. published_at is
-- first-sale instrumentation and must never be reset by hand. user_id would be
-- an ownership transfer. The stripe_* columns on this table are the deprecated
-- per-store Connect fields (superseded by profiles in 0026) and are nobody's to
-- write.
--
-- INSERT is revoked outright: stores are created by `generate_store_atomic`
-- (security definer), which is also what charges the credits for one. A user
-- who could INSERT directly would mint stores for free — and, since is_active
-- DEFAULTS TO TRUE, mint them already live.
--
-- DELETE stays: a merchant may delete their own store, and the policy scopes it
-- to rows they own.
-- ------------------------------------------------------------
revoke insert, update on public.stores from anon, authenticated;
grant update (store_name, theme_config) on public.stores to authenticated;

-- ------------------------------------------------------------
-- The remaining owner-writable tables (products, ad_creatives,
-- store_subscribers) carry a merchant's own content. Every column on them is
-- theirs to set, and none of them decides entitlement, capacity or money, so
-- their grants are left as they are.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Make the fix VERIFIABLE from the deployed application.
--
-- A missing GRANT is invisible in a way a missing table is not: every screen
-- works, every RPC answers, and the only symptom is that anyone can write
-- themselves a plan. The preflight already refuses to launch over a missing
-- function, so this reports the privilege state as a function and the deploy
-- check reads it — a database that predates this migration now fails preflight
-- loudly instead of running open.
-- ------------------------------------------------------------
create or replace function public.entitlement_columns_locked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not (
         has_column_privilege('authenticated', 'public.profiles', 'plan',                   'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'subscription_status',    'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'comped_until',           'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'price_type',             'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'stripe_subscription_id', 'UPDATE')
      or has_column_privilege('authenticated', 'public.stores',   'is_active',              'UPDATE')
      or has_column_privilege('authenticated', 'public.stores',   'user_id',                'UPDATE')
      or has_column_privilege('anon',          'public.profiles', 'plan',                   'UPDATE')
      or has_column_privilege('anon',          'public.stores',   'is_active',              'UPDATE')
    );
$$;

revoke execute on function public.entitlement_columns_locked() from public, anon, authenticated;
grant execute on function public.entitlement_columns_locked() to service_role;

comment on function public.entitlement_columns_locked() is
    'True when plan, subscription and publish columns are service-role-only. Read by /api/health?deep=1.';


-- ─────────────────────────────────────────────────────────
-- 0046_fix_publish_store_lock.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0046 — publish_store could never publish a store
--
-- 0030 meant to lock the merchant's rows before counting them:
--
--     select count(*)::integer into v_live
--     from public.stores
--     where user_id = v_user_id and is_active = true
--     for update;                                  -- ← invalid
--
-- PostgreSQL refuses that outright: "FOR UPDATE is not allowed with aggregate
-- functions". It is not a slow path or an edge case — the statement raises
-- every time control reaches it, which is every publish of a store that is not
-- already live. The API turned that into a 500 and told the merchant to try
-- again, which never helped.
--
-- It stayed hidden because almost nothing reaches it in a first run: a
-- generated store is created with is_active DEFAULT TRUE, so a merchant's first
-- store is born live without publish_store ever being asked. The function only
-- runs when someone pauses a store and takes it live again, or takes a second
-- one live — so the capacity cap that Founder and Pro are sold on was also the
-- one path nobody exercised.
--
-- The lock and the count have to be two statements. Row locks are taken over
-- the merchant's stores first — a concurrent publish blocks there — and the
-- count runs afterwards, so the cap still holds under concurrency exactly as
-- 0030 intended.
-- ------------------------------------------------------------

create or replace function public.publish_store(
    p_store_id uuid,
    -- NULL means unlimited (Pro). The caller passes the plan's capacity; the
    -- plan table lives in the app, the enforcement lives here.
    p_max_live integer default null
)
returns table (published boolean, live_count integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_is_live boolean;
    v_live    integer;
begin
    select s.user_id, s.is_active into v_user_id, v_is_live
    from public.stores s
    where s.id = p_store_id
    for update;

    if v_user_id is null then
        return query select false, 0, 'NOT_FOUND'::text;
        return;
    end if;

    -- Already live: publishing again is a no-op, never a cap failure.
    if v_is_live then
        select count(*)::integer into v_live
        from public.stores where user_id = v_user_id and is_active = true;
        return query select true, v_live, 'ALREADY_LIVE'::text;
        return;
    end if;

    -- Lock every store this merchant owns, so a concurrent publish waits here
    -- rather than racing the count. Separate from the count on purpose: a row
    -- lock and an aggregate cannot be the same statement.
    perform 1 from public.stores where user_id = v_user_id for update;

    select count(*)::integer into v_live
    from public.stores
    where user_id = v_user_id and is_active = true;

    if p_max_live is not null and v_live >= p_max_live then
        return query select false, v_live, 'AT_CAPACITY'::text;
        return;
    end if;

    -- published_at is stamped by the 0027 trigger, once and never reset.
    update public.stores set is_active = true, updated_at = now() where id = p_store_id;

    return query select true, v_live + 1, 'PUBLISHED'::text;
end $$;

revoke execute on function public.publish_store(uuid, integer) from public, anon, authenticated;
grant execute on function public.publish_store(uuid, integer) to service_role;

comment on function public.publish_store(uuid, integer) is
    'Atomically take a store live within the plan''s live-store capacity. NULL capacity = unlimited.';


-- ─────────────────────────────────────────────────────────
-- 0047_analytics_exclude_bots.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0048_founding_release_on_delete.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0048 — A deleted founding member releases their spot
--
-- 0023 claims a Founding 50 spot when an account is created and nothing ever
-- gave one back. `founding_claimed` is a denormalised counter, so the moment a
-- founding account is deleted the counter and reality disagree — permanently,
-- and silently, because nothing reads the two against each other.
--
-- It had already happened. On the live database the counter stood at 10 while
-- exactly ONE profile carried price_type = 'founding': nine spots were held by
-- accounts that no longer existed, so the offer would have closed after 41 real
-- merchants instead of 50. Nobody would have noticed — the cap simply arrives
-- early, and the landing page correctly stops advertising a price it can no
-- longer honour.
--
-- The business rule does not change: exactly the first 50 eligible merchants
-- get launch pricing. This makes the counter able to say so truthfully.
--
-- Concurrency: the release is a conditional UPDATE on the SAME single settings
-- row the claim in 0023 locks, so a claim and a release can never interleave —
-- Postgres serialises them on that row. `greatest(..., 0)` keeps the counter
-- off the floor even if a spot is somehow released twice, which the table's
-- own `founding_claimed >= 0` check would otherwise turn into a failed delete.
-- ------------------------------------------------------------

create or replace function public.release_founding_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.platform_settings
       set founding_claimed = greatest(founding_claimed - 1, 0),
           updated_at = now()
     where id = true;
    return old;
end;
$$;

-- Row trigger with a WHEN clause: a non-founding delete never reaches the
-- function at all, so "deleting a standard account leaves the count alone" is a
-- structural property rather than a branch someone could later edit away.
--
-- AFTER DELETE, so the spot is only returned once the row is really gone. Fires
-- for a direct delete and for the cascade from auth.users, which is how an
-- account is actually removed.
drop trigger if exists trg_release_founding_slot on public.profiles;
create trigger trg_release_founding_slot
    after delete on public.profiles
    for each row
    when (old.price_type = 'founding')
    execute function public.release_founding_slot();

-- ------------------------------------------------------------
-- Reconcile the counter with reality, once.
--
-- The trigger prevents future drift; it cannot undo the drift already there.
-- Derived from the profiles table rather than written as a literal, so this is
-- correct on the live database, on a fresh provision from setup_all.sql (where
-- it evaluates to 0), and on any restored copy.
-- ------------------------------------------------------------
update public.platform_settings
   set founding_claimed = least(
           (select count(*) from public.profiles where price_type = 'founding'),
           founding_cap
       ),
       updated_at = now()
 where id = true;


-- ─────────────────────────────────────────────────────────
-- 0049_source_origin_country.sql
-- ─────────────────────────────────────────────────────────
-- Origin country on a product's supplier source.
--
-- The EU's €150 duty exemption ended on 1 July 2026. A parcel entering the EU
-- now carries a flat customs charge per line item — €3, rising to €5 once the
-- handling fee joins it on 1 November 2026 — and on the low-cost goods that
-- dropshipping runs on, that charge is not a rounding error, it is the margin.
-- An €8 product sold at €24 is 67% before duty and 46% after.
--
-- The dashboard computes each merchant's average margin as (price - cost)/price
-- straight from this table, so without knowing where the goods ship FROM it
-- cannot tell an EU-sourced product (no customs line at all) from an import.
-- It has therefore been reporting the pre-July number to every merchant.
--
-- Nullable on purpose, and null is NOT read as "domestic": lib/finance/
-- import-duty.ts treats unknown origin as an import, because under-stating cost
-- sells at a loss the merchant discovers after the ad spend, while over-stating
-- it costs a little volume. Those are not symmetric mistakes.

alter table public.product_sources
  add column if not exists ships_from_country text;

comment on column public.product_sources.ships_from_country is
  'ISO-3166-1 alpha-2 origin of the goods. Drives EU import duty in margin '
  'calculations (lib/finance/import-duty.ts). NULL = unknown, which is treated '
  'as a non-EU import rather than as domestic.';

-- Two characters, upper case, or nothing. A malformed code would silently fall
-- through the EU-membership check and be treated as an import, which is the
-- safe direction but hides the data problem rather than surfacing it.
alter table public.product_sources
  drop constraint if exists product_sources_ships_from_country_iso2;

alter table public.product_sources
  add constraint product_sources_ships_from_country_iso2
  check (ships_from_country is null or ships_from_country ~ '^[A-Z]{2}$');


-- ─────────────────────────────────────────────────────────
-- 0050_gpsr_product_safety.sql
-- ─────────────────────────────────────────────────────────
-- GPSR product safety information (Regulation (EU) 2023/988).
--
-- The General Product Safety Regulation has applied since 13 December 2024, and
-- 2026 is its enforcement year: Safety Gate recorded 4,671 alerts in 2025, the
-- highest ever and 13% up on the year before, and market surveillance
-- authorities now have the powers to order a listing taken down.
--
-- Article 19 requires every distance-selling offer — which is what a generated
-- Urivo storefront is — to show, before the sale:
--
--   * the manufacturer's name, postal address and electronic address
--   * for goods made outside the EU, the EU "responsible person" and theirs
--   * the product's identifying details (type, batch or serial)
--   * any warnings or safety information
--
-- Urivo generates listings, so it generates the surface these belong on. The
-- fields are nullable because Urivo cannot invent them: a merchant who does not
-- know their manufacturer's registered address must be shown that the listing is
-- incomplete, not handed a plausible-looking address the AI made up. That is the
-- same rule the storefront already applies to shipping terms and eco claims —
-- the platform never authors a statement the merchant is legally bound by.
--
-- Every column here is the merchant's own content and none decides entitlement,
-- capacity or money, so the products grants are left as migration 0045 set them.

alter table public.products
  add column if not exists manufacturer_name text,
  add column if not exists manufacturer_address text,
  add column if not exists manufacturer_email text,
  add column if not exists eu_responsible_name text,
  add column if not exists eu_responsible_address text,
  add column if not exists eu_responsible_email text,
  add column if not exists product_identifier text,
  add column if not exists safety_warnings text;

comment on column public.products.manufacturer_name is
  'GPSR Art. 19: manufacturer name or registered trademark. NULL = the merchant '
  'has not supplied it; the listing is incomplete and says so.';
comment on column public.products.eu_responsible_name is
  'GPSR Art. 16: the EU-established responsible person, required when the '
  'manufacturer is outside the EU. NULL is only correct for EU-made goods.';
comment on column public.products.product_identifier is
  'GPSR Art. 19: type, batch or serial number identifying the specific product.';
comment on column public.products.safety_warnings is
  'GPSR Art. 19: warnings and safety information shown before purchase.';

-- Length ceilings only. No format checks and no NOT NULL: a constraint that
-- rejects a merchant's real, oddly-formatted manufacturer address would push
-- them to type something false, which is worse than an empty field.
alter table public.products
  drop constraint if exists products_gpsr_lengths;

alter table public.products
  add constraint products_gpsr_lengths check (
    coalesce(char_length(manufacturer_name), 0) <= 200
    and coalesce(char_length(manufacturer_address), 0) <= 500
    and coalesce(char_length(manufacturer_email), 0) <= 320
    and coalesce(char_length(eu_responsible_name), 0) <= 200
    and coalesce(char_length(eu_responsible_address), 0) <= 500
    and coalesce(char_length(eu_responsible_email), 0) <= 320
    and coalesce(char_length(product_identifier), 0) <= 140
    and coalesce(char_length(safety_warnings), 0) <= 2000
  );


-- ─────────────────────────────────────────────────────────
-- 0051_ledger_duration.sql
-- ─────────────────────────────────────────────────────────
-- How long an AI action actually took.
--
-- The landing page tells every visitor that Urivo generates a storefront "in
-- under a minute". Nothing in this codebase measures that, and nothing ever
-- has — so the claim could not be verified before it was made, and could not
-- be checked afterwards either. A performance promise on the page a customer
-- buys from is a statement of fact; it needs a number behind it.
--
-- The ledger already records what each action cost in tokens, images and
-- money. Wall-clock duration belongs in the same row: it is measured at the
-- same moment, by the same code, about the same action, and it makes the
-- marketing claim answerable with a query rather than an opinion.
--
-- Nullable, because rows written before this migration have no duration and
-- guessing one would be worse than admitting the gap.

alter table public.ai_usage_ledger
  add column if not exists duration_ms integer
    check (duration_ms is null or duration_ms >= 0);

comment on column public.ai_usage_ledger.duration_ms is
  'Wall-clock milliseconds the action took end to end, including image '
  'generation. NULL for rows written before migration 0051. This is the column '
  'that answers whether "in under a minute" is true.';

-- Answering the question is one query, so it lives here rather than in a
-- README where it would go stale:
--
--   select
--     percentile_cont(0.5) within group (order by duration_ms) / 1000.0 as p50_s,
--     percentile_cont(0.95) within group (order by duration_ms) / 1000.0 as p95_s,
--     count(*)
--   from public.ai_usage_ledger
--   where feature = 'storeGeneration' and duration_ms is not null;
