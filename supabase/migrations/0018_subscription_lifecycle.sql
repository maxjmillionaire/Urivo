-- ------------------------------------------------------------
-- 0018 — Subscription lifecycle
--
-- The platform's Stripe subscription webhook needs to persist two facts the
-- profile did not yet carry: WHICH subscription a customer holds (so a later
-- subscription.updated / .deleted event maps back to the right person even if
-- the customer id race-created a second row) and WHEN the current paid period
-- ends (so the billing surface can show "renews on …" and management flows can
-- reason about cancel-at-period-end without a round-trip to Stripe).
--
-- stripe_customer_id already exists (0001). This only adds the subscription id
-- and the period boundary. Both are nullable — Free users have neither.
-- ------------------------------------------------------------

alter table public.profiles
    add column if not exists stripe_subscription_id text,
    add column if not exists current_period_end timestamptz;

-- Webhook lookups resolve a subscription event → the owning profile by either
-- the customer id (already unique-indexed) or the subscription id.
create index if not exists idx_profiles_stripe_subscription
    on public.profiles (stripe_subscription_id);
