-- ------------------------------------------------------------
-- 0039 — The attribution model (specifications/10-attribution.md)
--
-- 0038 built the chain: click -> visit -> order. This makes it correct.
--
-- What was wrong, in order of how much money it moves:
--
--   1. NO WINDOW. The session lived in sessionStorage, so attribution ended
--      when the browser tab closed. Every considered purchase — click today,
--      buy tomorrow — was reported as zero next to the ad that caused it. A
--      measurement system that silently under-reports makes merchants switch
--      off ads that were working. §3
--
--   2. NOT IDEMPOTENT. attribute_order overwrote on every call, and Stripe
--      delivers webhooks at least once. A retry could rewrite a decision the
--      merchant had already read. §8
--
--   3. NO OWNERSHIP CHECK. A ?uc= belonging to another store attributed
--      happily. Copy a competitor's tracked link, and their ad takes credit
--      for your sale. §5
--
--   4. REPEAT PURCHASES CREDITED. One good ad quietly absorbed a year of
--      loyal revenue and looked unbeatable, after which every budget decision
--      ran against a number that was mostly not about advertising. §6
--
-- The architectural rule this preserves: every click stays a row, and the
-- attribution rule is applied when the report is read. Changing to last-touch
-- or time-decay later is a query change, not a migration, and not a year of
-- history thrown away. §4
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. Bot traffic never enters the numbers
--
-- Excluded from BOTH sides of every ratio: counting a crawler in the
-- denominator depresses conversion exactly as counting it in the numerator
-- inflates clicks. Stored rather than dropped so a merchant asking "where did
-- my visitor go" gets an answer instead of a shrug. §13
-- ------------------------------------------------------------
alter table public.store_visits
    add column if not exists is_bot boolean not null default false,
    add column if not exists bot_reason text;

-- Every read of real traffic filters on this, so it leads the index.
create index if not exists idx_store_visits_human
    on public.store_visits (store_id, created_at desc)
    where is_bot = false;

comment on column public.store_visits.is_bot is
    'Automated client (crawler, link unfurler, monitor). Excluded from every metric on both sides of the ratio.';

-- ------------------------------------------------------------
-- 2. How an order was attributed, recorded with the decision
--
-- The basis is as important as the answer. "Attributed to nothing" and
-- "deliberately excluded because this is a returning customer" are different
-- facts, and a dashboard that cannot tell them apart cannot be honest. §14
-- ------------------------------------------------------------
do $$
begin
    if not exists (select 1 from pg_type where typname = 'attribution_basis') then
        create type public.attribution_basis as enum (
            'creative',   -- joined to a specific ad inside the window
            'returning',  -- known customer; excluded from ad attribution by rule
            'expired',    -- a tracked click exists, but outside the window
            'none'        -- direct, organic, or no tracked click at all
        );
    end if;
end $$;

alter table public.orders
    add column if not exists attribution_basis public.attribution_basis not null default 'none',
    add column if not exists attributed_at timestamptz;

comment on column public.orders.attribution_basis is
    'Why this order carries the creative it carries — or why it carries none. See specifications/10-attribution.md.';

-- ------------------------------------------------------------
-- 3. The window, in one place
--
-- A policy, not a constant scattered through the code. Changing it changes
-- reporting; it never requires a migration, because the raw click events are
-- retained independently of it. §3
-- ------------------------------------------------------------
create or replace function public.attribution_window()
returns interval
language sql
immutable
as $$ select interval '7 days' $$;

comment on function public.attribution_window() is
    'Click-to-paid-order window. 7 days: long enough for a considered purchase, short enough that the commerce session stays defensible as cart continuity.';

-- ------------------------------------------------------------
-- 4. Attribute an order — the whole model in one function
--
-- Order of the checks is the order of the rules, and each one is a decision
-- the merchant can be shown rather than a silent skip.
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
    v_had_click boolean;
begin
    select store_id, lower(btrim(customer_email)), created_at, attribution_basis
      into v_store, v_email, v_placed, v_existing
      from public.orders
     where id = p_order_id;

    if v_store is null then
        return null;
    end if;

    /*
     * FIRST WRITE WINS. Stripe retries on any non-2xx and may deliver out of
     * order; without this a retry could rewrite a decision the merchant has
     * already read. A number that changes after it has been seen is worse
     * than one that is slightly conservative. §8
     */
    if v_existing <> 'none' then
        return (select creative_id from public.orders where id = p_order_id);
    end if;

    /*
     * RETURNING CUSTOMERS ARE NOT AD ACQUISITIONS. Checked before the session
     * lookup, because a returning customer who clicks an ad is still a
     * returning customer — crediting the ad would let it absorb loyal revenue
     * indefinitely and look unbeatable. Ad Studio measures acquisition; this
     * revenue is reported separately. §6
     */
    if v_email is not null and length(v_email) > 0 and exists (
        select 1 from public.orders o
         where o.store_id = v_store
           and o.id <> p_order_id
           and lower(btrim(o.customer_email)) = v_email
           and o.status in ('paid', 'fulfilled', 'refunded')
           and o.created_at < v_placed
    ) then
        update public.orders
           set attribution_basis = 'returning',
               session_hash      = coalesce(p_session_hash, session_hash),
               attributed_at     = now()
         where id = p_order_id;
        return null;
    end if;

    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        update public.orders set attribution_basis = 'none', attributed_at = now() where id = p_order_id;
        return null;
    end if;

    /*
     * FIRST TOUCH inside the window. Last touch would hand nearly every sale
     * to whatever retargeting ad ran immediately before checkout — the most
     * common way a small budget drifts toward the channel that did least. §4
     *
     * The creative must belong to THIS store: a tracked link copied from
     * somewhere else must never take credit here. §5
     *
     * Bots are excluded at the source, so a crawler that followed the link
     * cannot become the first touch. §13
     */
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
               attribution_basis = 'creative',
               attributed_at     = now()
         where id = p_order_id;
        return v_creative;
    end if;

    /*
     * A tracked click exists but fell outside the window. Distinct from "no
     * ad involved at all" — the merchant should see that their window is what
     * cost them the credit, not conclude the ad did nothing. §12
     */
    select exists (
        select 1 from public.store_visits v
         where v.session_hash = p_session_hash
           and v.store_id     = v_store
           and v.creative_id is not null
           and v.is_bot       = false
    ) into v_had_click;

    update public.orders
       set session_hash      = p_session_hash,
           attribution_basis = case when v_had_click then 'expired' else 'none' end,
           attributed_at     = now()
     where id = p_order_id;

    return null;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;

-- ------------------------------------------------------------
-- 5. Performance per creative — net of refunds, humans only
--
-- Revenue must match money the merchant actually kept, or it will be used to
-- justify spend against income that was returned. An ad showing orders with
-- near-zero revenue is a real signal: usually the wrong buyer. §10
-- ------------------------------------------------------------

-- Declared before the function that reads it: PostgreSQL parses a SQL-language
-- body at creation time, so a column added afterwards would fail the migration.
alter table public.orders
    add column if not exists amount_refunded integer not null default 0
        check (amount_refunded >= 0);

create or replace function public.ad_performance(p_store_id uuid)
returns table (
    creative_id   uuid,
    run_id        uuid,
    platform      text,
    headline      text,
    angle         text,
    launched_at   timestamptz,
    clicks        integer,
    orders        integer,
    revenue_cents integer,
    created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select c.id,
           c.run_id,
           c.platform,
           c.headline,
           c.angle,
           c.launched_at,
           coalesce((
               -- Distinct sessions, never pageviews: a visitor who reloads
               -- four times is one click. Bots are not visitors at all.
               select count(distinct v.session_hash)::integer
               from public.store_visits v
               where v.creative_id = c.id and v.is_bot = false
           ), 0),
           coalesce((
               select count(*)::integer
               from public.orders o
               where o.creative_id = c.id
                 and o.attribution_basis = 'creative'
                 and o.status in ('paid', 'fulfilled')
           ), 0),
           coalesce((
               select sum(o.amount_total - coalesce(o.amount_refunded, 0))::integer
               from public.orders o
               where o.creative_id = c.id
                 and o.attribution_basis = 'creative'
                 and o.status in ('paid', 'fulfilled')
           ), 0),
           c.created_at
    from public.ad_creatives c
    where c.store_id = p_store_id
      and c.archived_at is null
    order by c.created_at desc;
$$;

revoke execute on function public.ad_performance(uuid) from public, anon;
grant execute on function public.ad_performance(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Retention — a period that only exists in a document is not a period
--
-- Click events outlive the 7-day window by a wide margin on purpose, so a
-- webhook delayed by hours or days still attributes correctly. That headroom
-- is the concrete advantage of holding the window on the server rather than on
-- a device that may have cleared its storage. §11
-- ------------------------------------------------------------
create or replace function public.expire_click_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_deleted integer;
begin
    delete from public.store_visits
     where created_at < now() - interval '90 days';
    get diagnostics v_deleted = row_count;
    return v_deleted;
end $$;

revoke execute on function public.expire_click_events() from public, anon, authenticated;
grant execute on function public.expire_click_events() to service_role;

comment on function public.expire_click_events() is
    'Deletes click events past the 90-day retention window. Run daily.';
