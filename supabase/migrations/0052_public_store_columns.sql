-- The public storefront may read a store. It may not read the whole row.
--
-- Measured against production with the public anon key before this migration:
--
--   select * from stores  →  2 of 3 rows, every column, including
--   user_id, stripe_account_id, stripe_charges_enabled, published_at.
--
-- The row filter was never the problem — `stores: public storefront read`
-- correctly limits anon to active stores, and the inactive one stayed hidden.
-- The problem is that RLS filters ROWS and says nothing about COLUMNS, exactly
-- as migration 0045 found for writes. 0045 revoked insert and update and
-- granted the two editable columns back; it left select alone, so the read side
-- kept handing out the entire record.
--
-- Nothing here is a credential: a Stripe Connect account id cannot be used
-- without the platform's secret key. What it is, is a map — anyone with the
-- publishable key could enumerate every live store, its owner's user id, and
-- that owner's Connect account, and join them together. That is competitor
-- intelligence and a phishing target, and it is visible to the open internet.
--
-- Column grants rather than a view, deliberately. A view would mean pointing
-- the storefront at a new relation, and the RLS policy on `products` contains
-- `exists (select 1 from stores s where s.id = store_id and s.is_active)` —
-- a policy subquery still runs its permission checks against the querying role,
-- so anon must retain select on `stores.id` and `stores.is_active` or every
-- product on every storefront disappears. The grant below covers both.

revoke select on public.stores from anon;

grant select (
  id,               -- joined by the products policy and by product routes
  store_name,
  subdomain,
  theme_config,     -- the brand: palette, fonts, copy. Public by definition.
  currency,
  is_active,        -- read by the products policy subquery
  published_at
) on public.stores to anon;

comment on table public.stores is
  'Anon holds column-level select (migration 0052): the storefront reads brand '
  'and identity only. user_id, stripe_account_id and stripe_charges_enabled are '
  'deliberately excluded — RLS filters rows, grants filter columns, and the '
  'public storefront needs neither the owner nor their payment account.';

-- ------------------------------------------------------------
-- Storage: stop the bucket from being enumerable.
--
-- `product-images` is a public bucket, so object reads by URL bypass policies
-- entirely — that is what "public" means and it is why every published store's
-- imagery keeps working untouched here. The policy below was doing something
-- else: `for select using (bucket_id = 'product-images')` is what authorises
-- the LIST api, and listing is how someone walks the bucket and finds the
-- imagery of stores that have never been published.
--
-- Paths are `<subdomain>/<index>-<uuid>.<ext>`, so an individual object is not
-- guessable. Removing the ability to enumerate therefore removes the only
-- practical route to an unpublished merchant's assets.
--
-- What this does NOT do, stated plainly so nobody assumes otherwise: someone
-- who already holds the URL of an unpublished image can still fetch it. Closing
-- that requires a private bucket and signed URLs, which means migrating every
-- image_url already stored on every published product. That is a separate,
-- larger change with a real risk of breaking live storefronts, and it is not
-- being smuggled into a hardening migration.
-- ------------------------------------------------------------
drop policy if exists "Public read product images" on storage.objects;
