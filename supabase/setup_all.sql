-- ============================================================
-- URIVO — Complete database setup (one-shot).
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It applies migrations 0001–0008 in order. Safe to run once on a fresh project.
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

