-- ============================================================
-- 0006_welcome_email — track the one-time welcome email
-- ------------------------------------------------------------
-- welcomed_at is set atomically the first time a user reaches the
-- dashboard, guaranteeing exactly one welcome email regardless of
-- how they signed up (email, OAuth, confirmation link).
-- ============================================================
alter table public.profiles
    add column if not exists welcomed_at timestamptz;
