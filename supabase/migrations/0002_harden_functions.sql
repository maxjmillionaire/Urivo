-- ============================================================
-- URIVO — Migration 0002: harden sensitive functions (Phase 3)
-- Run AFTER 0001. Supabase Dashboard → SQL Editor → paste → Run.
--
-- Make credit and store-generation logic server-authoritative
-- (spec 6.1 §1). These functions take a user_id parameter and run
-- as SECURITY DEFINER, so they must never be callable directly by
-- the browser (anon/authenticated) — only the server, via the
-- service role, may invoke them.
-- ============================================================

revoke execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer)
    from public, anon, authenticated;
revoke execute on function public.credit_balance(uuid)
    from public, anon, authenticated;

grant execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer)
    to service_role;
grant execute on function public.credit_balance(uuid)
    to service_role;
