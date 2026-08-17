-- A generated store is no longer born live.
--
-- THE HOLE THIS CLOSES
--
-- `stores.is_active` is declared `not null default true` (0001), and
-- `generate_store_atomic` inserts without naming the column. Every generated
-- store was therefore live the moment it existed, for every plan, and
-- `publish_store` — which holds the capacity rule and the paid-capability rule
-- — was never on that path at all.
--
-- So the free tier never needed the publish button. It got a live store on a
-- urivo.ai address as a side effect of the column default. Flipping
-- `features.publish` to false in lib/plans.ts closes the button and closes
-- nothing else; without this migration the rule would read as enforced in the
-- application and be false in production on the very first generation.
--
-- THE FIX
--
-- `generate_store_atomic` takes the publish decision as a parameter, the same
-- shape `publish_store` already uses for capacity: the plan lives in the
-- application, the enforcement lives here. The app passes
-- `entitledPlan(profile).features.publish`, which resolves from payment state
-- rather than from the plan column alone, so an unpaid checkout cannot buy it.
--
-- DEFAULT false, AND THAT IS THE DEPLOY-SAFE DIRECTION
--
-- A defaulted parameter keeps the old six-argument call resolvable, so an
-- application that has not deployed yet still works. It defaults to FALSE, not
-- true: an older build then creates stores unpublished, and a paid merchant
-- publishes with one click. The other default would keep handing free live
-- stores out for as long as the deploy lagged, which is the failure this
-- migration exists to prevent. Fail closed on the side of the rule.
--
-- ^ CORRECTION (0056). The first sentence of that paragraph is FALSE, and it is
-- left standing here rather than rewritten because the record matters. Adding a
-- parameter does not replace a function, it creates a second one, and a
-- six-argument call then matches both candidates: PostgreSQL raises
-- "function ... is not unique" (SQLSTATE 42725) instead of filling in the
-- default. The choice of `false` was right; the claim about resolvability was
-- never executed against PostgreSQL. 0056 drops the six-argument form and makes
-- the sentence true. Read 0056 before relying on anything in this paragraph.
--
-- Existing live stores are NOT touched. Taking a merchant's shop offline is a
-- customer decision, not a migration's, and `publish_store` returns ALREADY_LIVE
-- before it reaches the capacity check — so a store that is live stays live
-- until someone decides otherwise. The count and the statement to act on it are
-- in the release notes for this change.

create or replace function public.generate_store_atomic(
    p_user_id uuid,
    p_store_name text,
    p_subdomain text,
    p_theme_config jsonb,
    p_products jsonb,
    p_credit_cost integer,
    -- Whether this merchant's entitled plan may run a live store. False for
    -- Free. Defaults to false so an un-deployed application cannot publish.
    p_is_active boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_store_id uuid;
    v_balance  integer;
begin
    if p_credit_cost <= 0 then
        raise exception 'INVALID_COST';
    end if;

    if exists (select 1 from public.reserved_subdomains where subdomain = p_subdomain) then
        raise exception 'SUBDOMAIN_RESERVED';
    end if;

    perform 1 from public.profiles where id = p_user_id for update;

    v_balance := public.credit_balance(p_user_id);
    if v_balance < p_credit_cost then
        raise exception 'INSUFFICIENT_CREDITS';
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, -p_credit_cost, 'Store generation: ' || p_subdomain, 'generation');

    -- is_active is now named explicitly. This is the whole migration: the column
    -- default made the decision before, and the default cannot see a plan.
    insert into public.stores (user_id, store_name, subdomain, theme_config, is_active)
    values (p_user_id, p_store_name, p_subdomain, p_theme_config, coalesce(p_is_active, false))
    returning id into v_store_id;

    insert into public.products (store_id, title, description, price_eur, position)
    select v_store_id,
           elem->>'title',
           coalesce(elem->>'description', ''),
           (elem->>'price_eur')::numeric,
           ordinality - 1
    from jsonb_array_elements(p_products) with ordinality as t(elem, ordinality);

    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (p_user_id, 'store_generation', 'store', v_store_id::text,
            jsonb_build_object('subdomain', p_subdomain, 'credit_cost', p_credit_cost,
                               'is_active', coalesce(p_is_active, false)));

    return jsonb_build_object(
        'store_id', v_store_id,
        'credits_remaining', v_balance - p_credit_cost
    );
end $$;

comment on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer, boolean) is
    'Generate a store atomically: spend credits, create the store, insert its '
    'products, write the audit row. p_is_active carries the plan''s publish '
    'entitlement and defaults to false — a generated store is not live unless '
    'the caller says the merchant may have a live store (migration 0055).';

-- Same grants as the six-argument form: service role only. The route holds the
-- session and the entitlement; the function is not reachable from a browser.
revoke execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer, boolean) to service_role;

-- ------------------------------------------------------------
-- How many stores the old default published for merchants who may not have one.
--
-- Reporting, not acting. Read it, decide, then act by hand if you want to:
--
--   select s.id, s.subdomain, p.email, p.plan, s.published_at
--   from public.stores s
--   join public.profiles p on p.id = s.user_id
--   where s.is_active = true
--     and p.plan = 'free'
--     and coalesce(p.subscription_status, 'none') not in ('active', 'past_due')
--     and (p.comped_until is null or p.comped_until < now());
--
-- To take them offline (irreversible for the merchant's live URL):
--
--   update public.stores set is_active = false, updated_at = now()
--   where id in ( … ids from the query above … );
-- ------------------------------------------------------------
create or replace function public.free_tier_live_stores()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.stores s
  join public.profiles p on p.id = s.user_id
  where s.is_active = true
    and p.plan = 'free'
    and coalesce(p.subscription_status, 'none') not in ('active', 'past_due')
    and (p.comped_until is null or p.comped_until < now());
$$;

comment on function public.free_tier_live_stores() is
    'How many live stores belong to merchants with no paid entitlement — the '
    'population the pre-0055 column default created. Reporting only.';

revoke execute on function public.free_tier_live_stores() from public, anon, authenticated;
grant execute on function public.free_tier_live_stores() to service_role;
