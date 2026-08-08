-- ------------------------------------------------------------
-- 0042 — 'expired' must mean OUR ad, not any ad
--
-- 0041 decided between 'expired' and 'none' with:
--
--     exists (select 1 from store_visits v
--              where v.session_hash = ... and v.store_id = v_store
--                and v.creative_id is not null and v.is_bot = false)
--
-- The attribution query one block above joins ad_creatives and requires the
-- creative to belong to this store (§5). This check does not — so a visit
-- carrying ANOTHER store's creative id counts as "there was a click", and the
-- order is labelled 'expired'.
--
-- The number stays right and the sentence goes wrong, which is the harder
-- failure to notice. 'expired' tells the merchant their 7-day window cost them
-- the credit and invites them to think about consideration cycles — when in
-- fact the link was never theirs. Somebody pasted a tracked URL copied from
-- elsewhere, and the honest label is 'none'.
--
-- Caught because the end-to-end run prints the basis next to every assertion.
-- The assertion itself only checked that no creative was credited, which was
-- true; the label beside it was wrong. Checking the value without checking the
-- word for it is how a misleading dashboard passes its own tests.
-- ------------------------------------------------------------

create or replace function public.attribute_order(p_order_id uuid, p_session_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_creative uuid;
    v_store    uuid;
    v_email    text;
    v_placed   timestamptz;
    v_existing public.attribution_basis;
    v_basis    public.attribution_basis;
begin
    select store_id, lower(btrim(customer_email)), created_at, attribution_basis
      into v_store, v_email, v_placed, v_existing
      from public.orders
     where id = p_order_id;

    if v_store is null then
        return null;
    end if;

    -- First write wins: a Stripe retry must never rewrite a decision the
    -- merchant has already read (§8).
    if v_existing <> 'none' then
        return (select creative_id from public.orders where id = p_order_id);
    end if;

    -- A returning customer is not an ad acquisition, even when they clicked
    -- one. Checked first, so a good ad cannot absorb loyal revenue (§6).
    if v_email is not null and length(v_email) > 0 and exists (
        select 1 from public.orders o
         where o.store_id = v_store
           and o.id <> p_order_id
           and lower(btrim(o.customer_email)) = v_email
           and o.status in ('paid', 'fulfilled', 'refunded')
           and o.created_at < v_placed
    ) then
        update public.orders
           set attribution_basis = 'returning'::public.attribution_basis,
               session_hash      = coalesce(p_session_hash, session_hash),
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        update public.orders
           set attribution_basis = 'none'::public.attribution_basis,
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    -- First touch inside the window, this store's own ad, humans only
    -- (§4, §5, §13).
    select v.creative_id into v_creative
      from public.store_visits v
      join public.ad_creatives c on c.id = v.creative_id
     where v.session_hash = p_session_hash
       and v.store_id     = v_store
       and c.store_id     = v_store
       and v.is_bot       = false
       and v.created_at  >= v_placed - public.attribution_window()
       and v.created_at  <= v_placed
     order by v.created_at asc
     limit 1;

    if v_creative is not null then
        update public.orders
           set creative_id       = v_creative,
               session_hash      = p_session_hash,
               attribution_basis = 'creative'::public.attribution_basis,
               attributed_at     = now()
         where id = p_order_id;
        return v_creative;
    end if;

    /*
     * 'expired' only when one of THIS store's own ads was clicked outside the
     * window — the same ownership join as the attribution query above, minus
     * the time bound. Without the join, a tracked link copied from another
     * store would be reported to this merchant as their own window expiring.
     */
    if exists (
        select 1
          from public.store_visits v
          join public.ad_creatives c on c.id = v.creative_id
         where v.session_hash = p_session_hash
           and v.store_id     = v_store
           and c.store_id     = v_store
           and v.is_bot       = false
    ) then
        v_basis := 'expired'::public.attribution_basis;
    else
        v_basis := 'none'::public.attribution_basis;
    end if;

    update public.orders
       set session_hash      = p_session_hash,
           attribution_basis = v_basis,
           attributed_at     = now()
     where id = p_order_id;

    return null;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;
