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
