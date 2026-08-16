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
