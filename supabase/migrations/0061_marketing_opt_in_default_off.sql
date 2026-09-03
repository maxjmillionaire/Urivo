-- Marketing consent defaults to OFF (opt-in, not opt-out).
--
-- WHY
--
-- profiles.marketing_opt_in was created with `default true` (0007), so every new
-- account was marketing-opted-in without an affirmative choice. That is not an
-- acceptable launch default: marketing consent must be given, never assumed.
--
-- WHAT THIS CHANGES (AND WHAT IT DOES NOT)
--
--   • New accounts now default to marketing_opt_in = false. A user turns it on
--     themselves in Settings (the existing per-user toggle is unchanged).
--   • This is a column-default change only. It does NOT touch transactional or
--     service communications (account, billing, order, security emails), which
--     are sent on the basis of the contract and never gated on this flag.
--   • Existing rows are intentionally left untouched: a value already set to
--     true cannot be distinguished in the schema from an explicit opt-in, so we
--     do not mass-reset it here and risk erasing a real consent. Whether to
--     reset pre-existing (pre-launch) rows is a separate, deliberate decision.
--
-- NOTE (enforcement): no email path currently reads marketing_opt_in, so this
-- default makes the STORED consent correct but does not by itself suppress any
-- send. Gating the marketing email paths on this flag is tracked separately.

alter table public.profiles
    alter column marketing_opt_in set default false;
