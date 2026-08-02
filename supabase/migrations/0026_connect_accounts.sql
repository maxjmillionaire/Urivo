-- ------------------------------------------------------------
-- 0026 — Stripe Connect payout accounts (per merchant, not per store)
--
-- Founder decision: ONE connected account per user. A merchant onboards once
-- and every store they own sells through that account. This matches how
-- merchants think ("my business gets paid"), avoids re-onboarding for each new
-- store, and keeps Stripe's own identity verification to a single pass.
--
-- The account therefore lives on profiles, which becomes the single source of
-- truth. stores.stripe_account_id / stripe_charges_enabled (added in 0005, when
-- the model was per-store) are backfilled from here and left in place, but
-- nothing reads them any more — see the comments at the bottom.
--
-- Urivo never holds merchant money: charges are created directly on the
-- merchant's connected account.
-- ------------------------------------------------------------

alter table public.profiles
    -- The Stripe connected account (acct_...). Null until the merchant starts onboarding.
    add column if not exists stripe_account_id text,
    -- Stripe's own verdicts, mirrored from the account object. Never inferred locally.
    add column if not exists stripe_charges_enabled boolean not null default false,
    add column if not exists stripe_payouts_enabled boolean not null default false,
    add column if not exists stripe_details_submitted boolean not null default false,
    -- When we last reconciled the mirror with Stripe (onboarding return or webhook).
    add column if not exists stripe_account_updated_at timestamptz;

-- One profile per connected account.
create unique index if not exists profiles_stripe_account_id_key
    on public.profiles (stripe_account_id)
    where stripe_account_id is not null;

-- ------------------------------------------------------------
-- Backfill: carry any per-store account up to its owner.
-- Pre-launch this is a no-op, but it makes the migration correct rather than
-- merely convenient. If one owner somehow had several accounts, the earliest
-- store wins — deterministic, and the merchant re-onboards once either way.
-- ------------------------------------------------------------
update public.profiles p
set stripe_account_id      = s.stripe_account_id,
    stripe_charges_enabled = s.stripe_charges_enabled,
    stripe_account_updated_at = now()
from (
    select distinct on (user_id)
           user_id, stripe_account_id, stripe_charges_enabled
    from public.stores
    where stripe_account_id is not null
    order by user_id, created_at asc
) s
where s.user_id = p.id
  and p.stripe_account_id is null;

comment on column public.profiles.stripe_account_id is
    'Stripe Connect account for this merchant. Source of truth for storefront payouts.';
comment on column public.stores.stripe_account_id is
    'DEPRECATED (0026): payout accounts are per-user. Read profiles.stripe_account_id.';
comment on column public.stores.stripe_charges_enabled is
    'DEPRECATED (0026): payout accounts are per-user. Read profiles.stripe_charges_enabled.';

-- ------------------------------------------------------------
-- Storefront checkout runs as the service role and needs the owner's payout
-- state for a store it is about to charge on. One function keeps that lookup in
-- the database rather than joining across two tables in the API layer.
-- ------------------------------------------------------------
create or replace function public.store_payout_account(p_store_id uuid)
returns table (
    stripe_account_id text,
    charges_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select p.stripe_account_id, p.stripe_charges_enabled
    from public.stores s
    join public.profiles p on p.id = s.user_id
    where s.id = p_store_id;
$$;

revoke execute on function public.store_payout_account(uuid) from public, anon, authenticated;
grant execute on function public.store_payout_account(uuid) to service_role;
