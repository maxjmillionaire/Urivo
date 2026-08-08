-- ------------------------------------------------------------
-- 0038 — Ad attribution: which ad actually made money
--
-- Ad Studio generated ads and forgot them. The plan came back as JSON, the
-- merchant copied it into Meta, and nothing in Urivo ever learned whether a
-- single one of those ads worked. The second run for a store knew nothing
-- about the first. That is a generator, not a marketing system, and nobody
-- abandons their existing tools for a generator — ad copy is the one thing
-- every AI writes for free.
--
-- THE ADVANTAGE URIVO HAS AND NOBODY ELSE DOES. Attribution is normally hard:
-- the ad platform owns the click, the shop owns the sale, and stitching them
-- together needs a pixel that iOS and ad blockers quietly break — Meta's own
-- reporting routinely loses a third of conversions this way. Urivo owns BOTH
-- ENDS in one database. The storefront that receives the click and the order
-- that closes the sale are two rows here. No pixel, no third party, no
-- guessing: the join is exact, server-side, and cannot be blocked.
--
-- Three pieces:
--   1. ad_creatives — a generated ad becomes a real object with an id, so
--      there is something to attribute TO.
--   2. store_visits gains the creative that sent the visitor.
--   3. orders gain the visit's session, which is what turns "this ad got
--      clicks" into "this ad made €258".
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The ads themselves
-- ------------------------------------------------------------
create table if not exists public.ad_creatives (
    id          uuid primary key default gen_random_uuid(),
    store_id    uuid not null references public.stores (id) on delete cascade,
    -- Groups the 5–8 creatives produced by one "Generate ads" click, so a run
    -- can be compared against the run before it.
    run_id      uuid not null,
    platform    text not null,
    format      text not null default '',
    angle       text not null default '',
    headline    text not null,
    primary_text text not null default '',
    cta         text not null default '',
    -- Set when the merchant marks an ad as actually running. Ads that were
    -- generated and never used must not drag down the averages the next
    -- generation reads.
    launched_at timestamptz,
    archived_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists idx_ad_creatives_store on public.ad_creatives (store_id, created_at desc);
create index if not exists idx_ad_creatives_run on public.ad_creatives (run_id);

alter table public.ad_creatives enable row level security;

drop policy if exists "ad_creatives: owner read" on public.ad_creatives;
create policy "ad_creatives: owner read" on public.ad_creatives
    for select using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

drop policy if exists "ad_creatives: owner update" on public.ad_creatives;
create policy "ad_creatives: owner update" on public.ad_creatives
    for update using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

-- No insert policy: creatives are written by the generation route under
-- service_role, immediately after the model returns them. A client-written
-- creative would be an ad nobody generated, attributed to traffic nobody sent.

comment on table public.ad_creatives is
    'Generated ads, persisted so their traffic and revenue can be attributed back to them.';

-- ------------------------------------------------------------
-- 2. Which ad sent this visit
--
-- The link arrives as ?uc=<creative id> on the storefront URL. Stored as a
-- plain uuid with ON DELETE SET NULL: deleting an ad must never delete the
-- traffic history that proves what it did.
-- ------------------------------------------------------------
alter table public.store_visits
    add column if not exists creative_id uuid references public.ad_creatives (id) on delete set null,
    -- Free-text UTM campaign, for traffic Urivo did not generate the ad for
    -- (a merchant's own newsletter, an influencer link). Kept separate from
    -- creative_id so "our ads" and "everything else" never blur together.
    add column if not exists utm_campaign text,
    add column if not exists utm_source text;

create index if not exists idx_store_visits_creative
    on public.store_visits (creative_id, created_at desc)
    where creative_id is not null;

-- ------------------------------------------------------------
-- 3. Which visit became this order
--
-- The session hash is the same anonymous per-session id the visit beacon
-- already sends — no cookie, no PII, no new tracking. It is simply carried
-- through checkout so the sale can be joined back to the click.
--
-- first_touch_creative is denormalised onto the order deliberately: a visit
-- row can be pruned or a creative deleted, and the revenue attribution must
-- survive both. Reconstructing it later from a join that no longer resolves
-- is how attribution silently rots.
-- ------------------------------------------------------------
alter table public.orders
    add column if not exists session_hash text,
    add column if not exists creative_id uuid references public.ad_creatives (id) on delete set null;

create index if not exists idx_orders_creative
    on public.orders (creative_id)
    where creative_id is not null;

-- ------------------------------------------------------------
-- Performance per creative. THE function that closes the loop: what the
-- merchant sees, and what the next generation is told.
--
-- Clicks are distinct sessions, not raw pageviews — a visitor who reloads
-- four times is one click, and counting otherwise would make every ad look
-- four times better than it is.
-- ------------------------------------------------------------
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
               select count(distinct v.session_hash)::integer
               from public.store_visits v
               where v.creative_id = c.id
           ), 0),
           coalesce((
               select count(*)::integer
               from public.orders o
               where o.creative_id = c.id and o.status in ('paid', 'fulfilled')
           ), 0),
           coalesce((
               select sum(o.amount_total)::integer
               from public.orders o
               where o.creative_id = c.id and o.status in ('paid', 'fulfilled')
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
-- Attribute an order to the ad that earned it.
--
-- FIRST TOUCH, not last: the ad that introduced the brand is the one that did
-- the work, and last-touch would hand every sale to whatever retargeting ad
-- happened to be shown before checkout. Definer + service_role because it is
-- called from the Stripe webhook, which has no user session.
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
begin
    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        return null;
    end if;

    select store_id into v_store from public.orders where id = p_order_id;
    if v_store is null then
        return null;
    end if;

    -- The earliest visit in this session that carried a creative.
    select v.creative_id into v_creative
    from public.store_visits v
    where v.session_hash = p_session_hash
      and v.store_id = v_store
      and v.creative_id is not null
    order by v.created_at asc
    limit 1;

    update public.orders
    set session_hash = p_session_hash,
        creative_id  = v_creative
    where id = p_order_id;

    return v_creative;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;

comment on function public.ad_performance(uuid) is
    'Clicks, orders and revenue per generated ad. Exact rather than pixel-based: Urivo owns both the click and the sale.';
