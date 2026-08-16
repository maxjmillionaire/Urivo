-- ------------------------------------------------------------
-- 0045 — Column privileges: stop a logged-in user writing their own entitlement
--
-- Row Level Security answers "which ROWS may this user touch". It has nothing
-- to say about which COLUMNS. Every policy here was written correctly against
-- that question — `auth.uid() = id`, `auth.uid() = user_id` — and every one of
-- them was still wide open, because owning the row was enough.
--
-- The anon key ships to the browser by design; a signed-in user holds a real
-- `authenticated` session against PostgREST. So both of these ran, from a
-- console, against a correct policy:
--
--     supabase.from('profiles').update({ plan: 'pro',
--                                        subscription_status: 'active' })
--             .eq('id', myId)                       -- → Pro, for free, forever
--
--     supabase.from('stores').update({ is_active: true })
--             .eq('user_id', myId)                  -- → every store live, on Free
--
-- The second one bypassed `publish_store` entirely — the function that holds the
-- live-store cap under a lock, and the reason capacity was believed to be
-- enforced in the database rather than in application code. A cap is only a cap
-- if the column behind it cannot be written directly.
--
-- The fix is the privilege system, not another policy: REVOKE the blanket
-- UPDATE and grant back only the columns a user is genuinely allowed to set
-- about themselves. Everything that decides money, access or capacity is now
-- writable exclusively by `service_role` — which is where the webhook, the
-- admin RPCs and `publish_store` already write from.
--
-- RLS still applies on top: these grants say WHICH COLUMNS, the policies still
-- say WHICH ROWS. A user needs both, and now has exactly both.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- PROFILES — a user may edit their display name and their email preference.
-- Nothing else: plan, subscription_status, price_type, comped_until and every
-- stripe_* column are set by the Stripe webhook or an admin RPC.
--
-- INSERT is the `handle_new_user` trigger's job (security definer) and DELETE
-- happens through account deletion on auth.users, so neither is granted here.
-- ------------------------------------------------------------
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, marketing_opt_in) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- STORES — a user may rename their store and restyle it.
--
-- is_active is deliberately absent: publishing is a paid capability and a
-- capacity decision, so it belongs to `publish_store` alone. published_at is
-- first-sale instrumentation and must never be reset by hand. user_id would be
-- an ownership transfer. The stripe_* columns on this table are the deprecated
-- per-store Connect fields (superseded by profiles in 0026) and are nobody's to
-- write.
--
-- INSERT is revoked outright: stores are created by `generate_store_atomic`
-- (security definer), which is also what charges the credits for one. A user
-- who could INSERT directly would mint stores for free — and, since is_active
-- DEFAULTS TO TRUE, mint them already live.
--
-- DELETE stays: a merchant may delete their own store, and the policy scopes it
-- to rows they own.
-- ------------------------------------------------------------
revoke insert, update on public.stores from anon, authenticated;
grant update (store_name, theme_config) on public.stores to authenticated;

-- ------------------------------------------------------------
-- The remaining owner-writable tables (products, ad_creatives,
-- store_subscribers) carry a merchant's own content. Every column on them is
-- theirs to set, and none of them decides entitlement, capacity or money, so
-- their grants are left as they are.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Make the fix VERIFIABLE from the deployed application.
--
-- A missing GRANT is invisible in a way a missing table is not: every screen
-- works, every RPC answers, and the only symptom is that anyone can write
-- themselves a plan. The preflight already refuses to launch over a missing
-- function, so this reports the privilege state as a function and the deploy
-- check reads it — a database that predates this migration now fails preflight
-- loudly instead of running open.
-- ------------------------------------------------------------
create or replace function public.entitlement_columns_locked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not (
         has_column_privilege('authenticated', 'public.profiles', 'plan',                   'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'subscription_status',    'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'comped_until',           'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'price_type',             'UPDATE')
      or has_column_privilege('authenticated', 'public.profiles', 'stripe_subscription_id', 'UPDATE')
      or has_column_privilege('authenticated', 'public.stores',   'is_active',              'UPDATE')
      or has_column_privilege('authenticated', 'public.stores',   'user_id',                'UPDATE')
      or has_column_privilege('anon',          'public.profiles', 'plan',                   'UPDATE')
      or has_column_privilege('anon',          'public.stores',   'is_active',              'UPDATE')
    );
$$;

revoke execute on function public.entitlement_columns_locked() from public, anon, authenticated;
grant execute on function public.entitlement_columns_locked() to service_role;

comment on function public.entitlement_columns_locked() is
    'True when plan, subscription and publish columns are service-role-only. Read by /api/health?deep=1.';
