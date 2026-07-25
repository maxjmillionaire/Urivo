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
