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
