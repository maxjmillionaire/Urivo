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
