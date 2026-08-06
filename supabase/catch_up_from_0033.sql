-- ============================================================
-- URIVO — Database catch-up (migrations 0033–0033).
-- For a project that ALREADY has the earlier migrations applied.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- Use setup_all.sql instead on a brand-new, empty project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build -- --from 0033
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- 0033_order_volume.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0033 — Order volume
--
-- Urivo takes NO percentage of a merchant's sales. A take rate would tax the
-- merchants who succeed — the ones who become the case studies, the referrals
-- and the reason anyone else signs up — and it would hand a merchant doing
-- €50k a month a standing reason to migrate somewhere that takes nothing.
--
-- Volume moves a merchant up a TIER instead. The difference matters: a tier is
-- capped and predictable, so a merchant at €5k a month pays 4% of revenue and a
-- merchant at €50k pays 0.4%. Success gets cheaper, not more expensive. Nobody
-- churns over a plan; people churn over a percentage.
--
-- THE ONE INVARIANT: this may never block a sale. Refusing a merchant's
-- customer to force an upgrade would take money out of their pocket, which is
-- strictly worse than the take rate we declined to charge. This function only
-- COUNTS; nothing on the checkout path reads it.
-- ------------------------------------------------------------

create or replace function public.monthly_paid_orders(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.orders o
    join public.stores s on s.id = o.store_id
    where s.user_id = p_user_id
      -- Paid and fulfilled both count; a fulfilled order was paid for.
      -- Refunded and cancelled do not: a merchant is not charged a tier for a
      -- sale that came back.
      and o.status in ('paid', 'fulfilled')
      -- Calendar month, so the allowance resets on a date the merchant can
      -- predict rather than on a rolling window they have to reason about.
      and o.created_at >= date_trunc('month', now());
$$;

revoke execute on function public.monthly_paid_orders(uuid) from public, anon;
grant execute on function public.monthly_paid_orders(uuid) to authenticated, service_role;

comment on function public.monthly_paid_orders(uuid) is
    'Paid orders this calendar month across a merchant''s stores. Drives the plan tier prompt. Never consulted on the checkout path.';
