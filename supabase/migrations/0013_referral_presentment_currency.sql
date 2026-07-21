-- ------------------------------------------------------------
-- 0013 — Multi-currency readiness for referral payments
--
-- EUR stays the accounting currency: referrals.first_payment_amount_eur and
-- commission_amount_eur remain the normalised accounting truth. These two
-- nullable columns let us ALSO record what the customer actually paid in their
-- local checkout currency (Stripe presentment) once multi-currency checkout
-- ships in Phase 2 — added now so that ships without a schema change.
--
--   first_payment_currency          — ISO 4217 code the customer was charged in
--   first_payment_presentment_amount — the amount in that currency
--
-- Until Phase 2 both are simply null (or 'EUR'), and all accounting continues
-- to run off the *_eur columns unchanged.
-- ------------------------------------------------------------

alter table public.referrals
    add column if not exists first_payment_currency text
        check (first_payment_currency is null or char_length(first_payment_currency) = 3),
    add column if not exists first_payment_presentment_amount numeric(12, 2)
        check (first_payment_presentment_amount is null or first_payment_presentment_amount >= 0);
