-- Separate the shop window from the merchant's private record.
--
-- WHAT WAS WRONG
--
-- Measured on a replica built from this repository's own setup_all.sql, with a
-- real second account holding a real session:
--
--   merchant A → select user_id, stripe_account_id, stripe_charges_enabled
--                from stores where id = <merchant B's live store>
--   → user_id=<B>  stripe_account_id=acct_…  charges_enabled=true
--
-- and, without an id to aim at:
--
--   merchant A → select * from stores where user_id <> A
--   → every live store on the platform, with its owner and payout account
--
-- Two independent facts combine into that:
--
--   1. `stores: public storefront read` was created in 0001 as
--      `for select using (is_active = true)` with NO `to` clause. A policy
--      without a role list applies to PUBLIC, so it has always applied to
--      `authenticated` as well as `anon`. 0053 added role scoping to seven
--      owner policies and did not touch this one.
--
--   2. 0052 ran `revoke select on public.stores from anon` and granted back a
--      public column list. It revoked from ANON ONLY. `authenticated` kept
--      table-level select on every column, including the three 0052 exists to
--      protect.
--
-- So 0052 closed the leak against the open internet and left it open to anyone
-- willing to sign up for a free account, which is the entire internet plus one
-- form. The information is the same map 0052 describes: every live store, its
-- owner's user id, and that owner's Stripe Connect account, joinable.
--
-- WHY NOT ANOTHER POLICY PATCH
--
-- The instinct is to scope `stores: public storefront read` to `anon`. That
-- breaks the storefront: the product page and the order-success page read
-- `stores` through the SESSION client, so a signed-in shopper would get a 404
-- on any shop but their own. That is 0052's mistake exactly — a hardening
-- change whose blast radius lands on live customers.
--
-- The instinct after that is to mirror 0052's column grants onto
-- `authenticated`. That breaks the dashboard: grants are per-ROLE, not
-- per-ROW, so revoking `user_id` from `authenticated` takes it from owners
-- reading their own store too.
--
-- RLS filters rows and cannot filter columns. GRANTs filter columns and cannot
-- filter rows. "This column, but only on rows you own" is not expressible in
-- either, and every attempt to force it produces a regression somewhere else.
--
-- THE FIX: STOP ASKING ONE RELATION TO BE BOTH
--
-- `public.storefronts` is the public projection — the columns a shop window
-- genuinely needs, and only rows that are actually live. It is the read
-- surface for anonymous and signed-in shoppers alike, so a signed-in visitor
-- browsing someone else's shop is served by the same relation as everyone
-- else, and sees the same columns everyone else sees.
--
-- `public.stores` then goes back to being what its RLS always said it was: the
-- merchant's own record. One policy, owner-scoped, `to authenticated`. Once
-- merchant A cannot see merchant B's ROW at all, `user_id` and
-- `stripe_account_id` need no special handling — they are private because the
-- row is, which is a property that holds for every column the table grows
-- later, including ones nobody has thought of yet. That is the part a column
-- allow-list could never give us.
--
-- This does not weaken RLS. `stores` loses a permissive policy and keeps the
-- restrictive one; anon loses every privilege it had on the table.

-- ------------------------------------------------------------
-- 1. The public projection.
--
-- security_invoker = false (the default, set explicitly because this is the
-- entire point): the view runs as its owner, so a caller needs no privilege on
-- `stores` whatsoever. Anonymous visitors reach the storefront through this
-- and nothing else.
--
-- The `where is_active` is therefore load-bearing — with the view running as
-- owner, RLS on the base table is not what is holding unpublished stores back,
-- this predicate is. security_barrier stops the planner from pushing a
-- user-supplied function down past it and observing rows the predicate would
-- have excluded.
--
-- Columns are an allow-list, never `select *`. A column added to `stores`
-- tomorrow is private until someone edits this list on purpose.
-- ------------------------------------------------------------
create or replace view public.storefronts
with (security_invoker = false, security_barrier = true) as
    select
        s.id,
        s.store_name,
        s.subdomain,
        s.theme_config,   -- the brand: palette, fonts, copy. Public by definition.
        s.currency,
        s.is_active       -- always true here; kept so callers' shapes are unchanged
    from public.stores s
    where s.is_active = true;

comment on view public.storefronts is
    'The public shop window: the only columns a storefront needs, and only '
    'stores that are live. Runs as owner so anonymous visitors need no '
    'privilege on `stores`, which is owner-scoped (migration 0054). Never add '
    'a column here without deciding, deliberately, that the open internet may '
    'read it — user_id, stripe_account_id and stripe_charges_enabled must not.';

revoke all on public.storefronts from public;
grant select on public.storefronts to anon, authenticated;

-- ------------------------------------------------------------
-- 2. `stores` becomes the merchant's own record and nothing else.
--
-- Dropping the public read is what closes the leak. Scoping the owner policy
-- to `authenticated` follows 0053's precedent: auth.uid() is null for anon, so
-- the policy could never grant an anonymous caller anything, and evaluating it
-- for anon only ever risked an error where the right answer was "no rows".
-- ------------------------------------------------------------
drop policy if exists "stores: public storefront read" on public.stores;

drop policy if exists "stores: own all" on public.stores;
create policy "stores: own all" on public.stores
    for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- `for all` already uses USING as the check when WITH CHECK is absent; it is
-- written out so that a future edit to one half cannot silently change the
-- other.

comment on table public.stores is
    'A merchant''s own store record. Readable only by its owner (migration '
    '0054) — the public storefront reads public.storefronts instead. Because '
    'isolation here is row-level, every column is private by default, '
    'including columns added after this comment was written.';

-- ------------------------------------------------------------
-- 3. anon loses everything on `stores`.
--
-- 0052's column grants were the anonymous storefront's read path. The view is
-- that path now, so the grants are not narrowed — they are removed. Nothing
-- anonymous references `stores` directly any more: the products policy asks
-- `store_is_active()` (security definer, 0053), custom domains resolve through
-- `store_for_domain()` (security definer), and the storefront itself reads the
-- view.
--
-- `authenticated` keeps table-level select. It is no longer a way to read
-- anyone else's data, because the only rows it can now reach are its own.
-- ------------------------------------------------------------
revoke all on public.stores from anon;

-- ------------------------------------------------------------
-- 4. Make the separation checkable from the deployed application.
--
-- A dropped policy is invisible in the way a dropped table is not: every
-- screen still renders and the only symptom is that a signed-in stranger can
-- read your payout account. The preflight already refuses to launch over a
-- missing function, so this reports the state as one, the same way 0045 did
-- for column privileges.
-- ------------------------------------------------------------
create or replace function public.storefront_isolation_intact()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        -- No permissive policy may expose `stores` to anyone but its owner.
        not exists (
            select 1 from pg_policies
            where schemaname = 'public' and tablename = 'stores'
              and policyname = 'stores: public storefront read'
        )
        -- anon holds nothing on the base table, column grants included.
        and not exists (
            select 1 from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'stores' and grantee = 'anon'
        )
        and not exists (
            select 1 from information_schema.table_privileges
            where table_schema = 'public' and table_name = 'stores' and grantee = 'anon'
        )
        -- The public projection exists and carries none of the private columns.
        and exists (
            select 1 from information_schema.views
            where table_schema = 'public' and table_name = 'storefronts'
        )
        and not exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'storefronts'
              and column_name in ('user_id', 'stripe_account_id', 'stripe_charges_enabled')
        );
$$;

comment on function public.storefront_isolation_intact() is
    'True when `stores` is owner-only, anon holds nothing on it, and '
    'public.storefronts carries no private column. Read by /api/health?deep=1. '
    'A database provisioned before 0054 has no symptoms — every screen renders '
    'and the only sign is that any signed-in account can read every live '
    'store''s owner and Stripe Connect id.';

revoke execute on function public.storefront_isolation_intact() from public, anon, authenticated;
grant execute on function public.storefront_isolation_intact() to service_role;
