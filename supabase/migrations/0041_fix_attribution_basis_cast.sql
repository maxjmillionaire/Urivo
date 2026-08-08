-- ------------------------------------------------------------
-- 0041 — Fix: attribute_order raised on every unattributed order
--
-- 0039 ended with:
--
--     attribution_basis = case when v_had_click then 'expired' else 'none' end
--
-- The CASE yields `text`; the column is an enum. PostgreSQL refuses the
-- assignment with 42804 rather than coercing it, so EVERY order that reached
-- the final branch — all direct traffic, and every click that fell outside the
-- window — raised instead of being labelled.
--
-- It failed silently, which is the worst part. attribute_order is called
-- best-effort from the Stripe webhook so an order is never lost to an
-- attribution problem, and that same safety net swallowed the exception. The
-- orders then kept the column default, 'none', which is the correct answer for
-- direct traffic and the WRONG answer for an expired click — the two became
-- indistinguishable, which is precisely the distinction §12 exists to draw.
-- Nothing logged, nothing broke, and the coverage split would have quietly
-- under-reported the "outside the window" bucket forever.
--
-- Found by checking the RPC's HTTP status in an end-to-end run rather than
-- only reading the row afterwards: the row looked plausible, and the response
-- was a 400.
--
-- Also stamped: session_hash and attributed_at on these orders, which the
-- raised statement never wrote.
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
     * Resolved into a typed variable rather than cast inline. The inline CASE
     * is what broke: it is easy to write, easy to read, and silently produces
     * `text` where an enum is required.
     *
     * 'expired' rather than 'none' when a tracked click exists but fell outside
     * the window — the merchant should see that the window cost them the
     * credit, not conclude the ad did nothing (§12).
     */
    if exists (
        select 1 from public.store_visits v
         where v.session_hash = p_session_hash
           and v.store_id     = v_store
           and v.creative_id is not null
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
