-- Repairs the storefront that migration 0052 broke.
--
-- WHAT WENT WRONG
--
-- 0052 replaced anon's table-level select on `stores` with column-level grants,
-- on the assumption that a policy subquery only needs privileges on the columns
-- it touches. That is false. PostgreSQL checks TABLE-level select on every
-- relation a policy expression references, regardless of which columns the
-- expression reads. The comment in 0052 predicting otherwise was wrong.
--
-- The result, measured against production with the publishable key immediately
-- after 0052 was applied:
--
--   GET /rest/v1/products  →  401  permission denied for table stores
--
-- Every anonymous visitor's catalogue was empty. The storefront loads products
-- through the session client (app/(store)/store/[subdomain]/page.tsx), so this
-- was live customer-facing breakage, and a worse outcome than the information
-- disclosure 0052 set out to fix.
--
-- Two policies on `products` are evaluated for an anonymous select and BOTH
-- reference `stores`: the public read, and `products: owner write`, which is
-- FOR ALL and therefore applies to select as well. Fixing only the first would
-- have left the 401 in place.
--
-- THE FIX
--
-- A security-definer helper answers "is this store live?" without the caller
-- needing any privilege on `stores` at all. The function is owned by the schema
-- owner, so the privilege check happens against the owner, not against anon.
-- It is STABLE and pinned to an explicit search_path — a definer function
-- without a fixed search_path is a privilege-escalation vector.
--
-- Owner-scoped policies are additionally restricted TO authenticated. They can
-- never grant an anonymous visitor anything (auth.uid() is null), so evaluating
-- them for anon only ever produced an error where the correct answer was "no
-- rows". Scoping them is both a correctness fix and one less relation anon
-- needs rights on.
--
-- 0052's column grants on `stores` stay exactly as they are: the storefront's
-- own select of stores works, and user_id, stripe_account_id and
-- stripe_charges_enabled remain unreadable to anon. That part was correct and
-- is verified.

-- ------------------------------------------------------------
-- The helper.
-- ------------------------------------------------------------
create or replace function public.store_is_active(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores
    where id = p_store_id and is_active = true
  );
$$;

comment on function public.store_is_active(uuid) is
  'Is this store published? Security definer so the public storefront policies '
  'can ask without anon holding select on stores (migration 0053). Reveals one '
  'boolean about a store id the caller already has.';

revoke all on function public.store_is_active(uuid) from public;
grant execute on function public.store_is_active(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- products — the two policies an anonymous select evaluates.
-- ------------------------------------------------------------
drop policy if exists "products: public storefront read" on public.products;
create policy "products: public storefront read" on public.products
    for select
    to anon, authenticated
    using (public.store_is_active(store_id));

drop policy if exists "products: owner write" on public.products;
create policy "products: owner write" on public.products
    for all
    to authenticated
    using (
        exists (select 1 from public.stores s
                where s.id = store_id and s.user_id = auth.uid())
    );

-- ------------------------------------------------------------
-- Owner-scoped policies: never applicable to anon, so never evaluated for anon.
-- Bodies are unchanged; only the role scope is added.
-- ------------------------------------------------------------
drop policy if exists "orders: owner read" on public.orders;
create policy "orders: owner read" on public.orders
    for select to authenticated using (
        exists (select 1 from public.stores s
                where s.id = store_id and s.user_id = auth.uid())
    );

drop policy if exists "order_items: owner read" on public.order_items;
create policy "order_items: owner read" on public.order_items
    for select to authenticated using (
        exists (
            select 1 from public.orders o
            join public.stores s on s.id = o.store_id
            where o.id = order_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_visits: owner read" on public.store_visits;
create policy "store_visits: owner read" on public.store_visits
    for select to authenticated using (
        exists (
            select 1 from public.stores s
            where s.id = store_visits.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_subscribers: owner read" on public.store_subscribers;
create policy "store_subscribers: owner read" on public.store_subscribers
    for select to authenticated using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_subscribers: owner update" on public.store_subscribers;
create policy "store_subscribers: owner update" on public.store_subscribers
    for update to authenticated using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_subscribers: owner delete" on public.store_subscribers;
create policy "store_subscribers: owner delete" on public.store_subscribers
    for delete to authenticated using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_domains: owner read" on public.store_domains;
create policy "store_domains: owner read" on public.store_domains
    for select to authenticated using (
        exists (
            select 1 from public.stores s
            where s.id = store_domains.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "ad_creatives: owner read" on public.ad_creatives;
create policy "ad_creatives: owner read" on public.ad_creatives
    for select to authenticated using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

drop policy if exists "ad_creatives: owner update" on public.ad_creatives;
create policy "ad_creatives: owner update" on public.ad_creatives
    for update to authenticated using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );
