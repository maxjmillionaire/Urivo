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
