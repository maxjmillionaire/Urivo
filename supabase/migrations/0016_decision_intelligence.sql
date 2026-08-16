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
