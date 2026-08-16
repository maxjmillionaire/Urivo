-- ============================================================
-- 0007_profile_settings — account preferences
-- ------------------------------------------------------------
-- Marketing/product-update email opt-in, editable from Settings.
-- Defaults to true (users opt out); the welcome + transactional
-- emails are transactional and unaffected by this flag.
-- ============================================================
alter table public.profiles
    add column if not exists marketing_opt_in boolean not null default true;
