-- Pause & Reactivate — a store is PAUSED, never deleted, when its owner stops paying.
--
-- DERIVED STATE, NOT A NEW STATE MACHINE
--
-- There is no new column and no client-settable flag. "Paused" is derived from
-- two facts the system already owns authoritatively:
--
--   1. stores.is_active = true   — the store was published (intent preserved).
--   2. the owner is no longer entitled to publish — their subscription lapsed.
--
-- Subscription state stays Stripe/webhook-derived (profiles.subscription_status,
-- comped_until), exactly as before. So a store returns to live automatically the
-- moment the subscription is restored — nothing to un-pause, nothing to sync,
-- no second source of truth to drift.
--
-- THE ENTITLEMENT RULE, MIRRORED FROM lib/plans.ts (entitledPlanKey + canPublish)
--
-- Entitled-to-publish = the owner currently resolves to a PAID tier:
--   plan in ('core','pro')
--   AND ( subscription_status in ('active','past_due')      -- past_due is dunning,
--         OR (comped_until is not null and comped_until > now()) )  -- not theft: still live
--
-- past_due therefore stays LIVE during the existing grace/dunning window. A
-- cancelled/expired subscription, an expired comp, or a free account with no
-- entitlement all drop out of the rule → the still-published store is paused.
--
-- SECURITY: definer so the anon storefront path can ask without any privilege on
-- profiles; returns only a boolean, never a field. A draft (is_active=false) is
-- not "paused" — it returns false, same as a store that does not exist.

create or replace function public.store_is_paused(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores s
    join public.profiles pr on pr.id = s.user_id
    where s.id = p_store_id
      and s.is_active = true
      and not (
        pr.plan in ('core', 'pro')
        and (
          pr.subscription_status in ('active', 'past_due')
          or (pr.comped_until is not null and pr.comped_until > now())
        )
      )
  );
$$;

comment on function public.store_is_paused(uuid) is
    'True when a published store''s owner is no longer entitled to publish '
    '(subscription lapsed / expired comp / free) — the storefront then serves a '
    'maintenance page and checkout is refused. Derived, definer, boolean-only, '
    'no PII leak (0058). Returns to live automatically when entitlement returns.';

revoke execute on function public.store_is_paused(uuid) from public;
grant execute on function public.store_is_paused(uuid) to anon, authenticated, service_role;
