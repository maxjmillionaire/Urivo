-- GITO creator rate — align the stored record with the signed agreement (35%).
--
-- WHAT THIS IS (AND IS NOT)
--
-- GITO's contract is 35% of first-month revenue. The creators table supports a
-- per-creator commission_rate exactly so a special deal needs no code change
-- (migration 0012), but the column default is 0.25 — so GITO's row must be set
-- explicitly or the referral system pays him 25%.
--
-- This is a one-row DATA correction, not a schema or system change:
--   • it touches ONLY GITO's row, matched by his referral code (GITO10),
--   • it leaves the global default (0.25) untouched — future creators are
--     unaffected and still take their own agreed rate,
--   • it is idempotent: re-running is a no-op, and if GITO's row does not exist
--     yet (creator not created), it changes nothing and raises nothing.
--
-- It does not alter the contract, the creator UX, or the commission logic — it
-- only makes the stored configuration match what was already signed.

update public.creators
   set commission_rate = 0.35
 where code = 'GITO10'
   and commission_rate is distinct from 0.35;
