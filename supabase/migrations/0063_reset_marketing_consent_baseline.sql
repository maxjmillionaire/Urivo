-- One-time marketing-consent baseline reset (pre-launch).
--
-- 0061 made the column default false for NEW accounts. Existing rows still carry
-- the historical `default true`, and there is NO reliable way to tell an
-- explicit opt-in from an inherited default: marketing_opt_in is a bare boolean
-- with no timestamp, source, or audit trail. Because consent cannot be evidenced
-- for those rows, the compliance-safe baseline is to treat them as NOT consented.
--
-- This resets every currently-true row to false, once. It is:
--   • idempotent — re-running changes nothing (all rows are already false);
--   • scoped — it touches ONLY marketing_opt_in, no other profile field;
--   • lossless of genuine choices going forward — from here on, false can only
--     become true by an explicit user action in Settings.
--
-- Existing false rows (which could only have come from an explicit opt-out under
-- the old default-true) are left as-is.
--
-- APPLY DELIBERATELY: this is a data reset, not schema. Run it once, immediately
-- before launch, after deciding to establish a clean consent baseline.

update public.profiles
   set marketing_opt_in = false
 where marketing_opt_in = true;
