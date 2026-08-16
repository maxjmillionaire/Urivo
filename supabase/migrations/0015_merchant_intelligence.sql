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
