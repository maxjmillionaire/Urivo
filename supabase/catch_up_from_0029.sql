-- ============================================================
-- URIVO — Database catch-up (migrations 0029–0033).
-- For a project that ALREADY has the earlier migrations applied.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- Use setup_all.sql instead on a brand-new, empty project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build -- --from 0029
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- 0029_store_subscribers.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0029 — Storefront email capture
--
-- Every generated store rendered a newsletter form whose Subscribe button did
-- nothing: no request, no confirmation, no error. A dead control on the second
-- most-clicked element of a storefront costs more trust than having no form.
--
-- It is wired here rather than removed because of what it is worth. Before a
-- merchant's first sale their traffic is their only asset, and an email address
-- is the only part of a visit that survives the visit. A store with no orders
-- and 40 subscribers is a business; a store with no orders and no list is not.
-- ------------------------------------------------------------

create table if not exists public.store_subscribers (
    id          uuid primary key default gen_random_uuid(),
    store_id    uuid not null references public.stores (id) on delete cascade,
    email       text not null,
    -- Where on the storefront they subscribed, for the merchant's own reporting.
    source      text not null default 'storefront',
    -- Soft delete: an unsubscribe must not free the address to be re-added
    -- silently by the same form, and the merchant needs the audit trail.
    unsubscribed_at timestamptz,
    created_at  timestamptz not null default now(),

    constraint store_subscribers_email_check check (position('@' in email) > 1),
    -- One address per store. A shopper pressing Subscribe twice is not two
    -- subscribers, and this is what makes the insert safely idempotent.
    constraint store_subscribers_unique unique (store_id, email)
);

create index if not exists idx_store_subscribers_store
    on public.store_subscribers (store_id, created_at desc);

alter table public.store_subscribers enable row level security;

-- The merchant reads and manages their own stores' lists. Nobody else can read
-- them at all: a subscriber list is the merchant's asset and contains PII.
create policy "store_subscribers: owner read" on public.store_subscribers
    for select using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

create policy "store_subscribers: owner update" on public.store_subscribers
    for update using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

create policy "store_subscribers: owner delete" on public.store_subscribers
    for delete using (
        exists (
            select 1 from public.stores s
            where s.id = store_subscribers.store_id and s.user_id = auth.uid()
        )
    );

-- No INSERT policy: shoppers are anonymous and must never be able to write to
-- this table directly, or a scraper could enumerate and pollute every list.
-- Subscriptions go through the RPC below, which runs as the definer and only
-- ever accepts an address for a store that is actually live.

-- ------------------------------------------------------------
-- Subscribe. Idempotent by design: pressing the button twice, or returning a
-- week later, is a no-op rather than an error the shopper has to interpret.
-- Re-subscribing after an unsubscribe clears the flag, which is what the
-- shopper means when they type their address in again.
-- ------------------------------------------------------------
create or replace function public.subscribe_to_store(
    p_subdomain text,
    p_email     text,
    p_source    text default 'storefront'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_store_id uuid;
    v_email    text := lower(btrim(p_email));
begin
    if v_email is null or position('@' in v_email) < 2 or length(v_email) > 254 then
        return false;
    end if;

    -- Only a LIVE store accepts subscribers. A draft is not public, so an
    -- address arriving for one did not come from a real storefront visit.
    select id into v_store_id
    from public.stores
    where subdomain = lower(btrim(p_subdomain)) and is_active = true;

    if v_store_id is null then
        return false;
    end if;

    insert into public.store_subscribers (store_id, email, source)
    values (v_store_id, v_email, coalesce(nullif(btrim(p_source), ''), 'storefront'))
    on conflict (store_id, email)
    do update set unsubscribed_at = null;

    return true;
end $$;

-- Anonymous shoppers need this one, and only this one.
revoke execute on function public.subscribe_to_store(text, text, text) from public;
grant execute on function public.subscribe_to_store(text, text, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- How many people a merchant has captured, per store. Owner-scoped through
-- RLS on the underlying table, so it needs no privilege of its own.
-- ------------------------------------------------------------
create or replace function public.store_subscriber_counts(p_user_id uuid)
returns table (store_id uuid, subscribers bigint)
language sql
stable
security definer
set search_path = public
as $$
    select sub.store_id, count(*)::bigint
    from public.store_subscribers sub
    join public.stores s on s.id = sub.store_id
    where s.user_id = p_user_id and sub.unsubscribed_at is null
    group by sub.store_id;
$$;

revoke execute on function public.store_subscriber_counts(uuid) from public, anon;
grant execute on function public.store_subscriber_counts(uuid) to authenticated, service_role;

comment on table public.store_subscribers is
    'Storefront email captures. The merchant''s pre-first-sale asset; PII, owner-read only.';


-- ─────────────────────────────────────────────────────────
-- 0030_live_store_capacity.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0030 — Live store capacity
--
-- Credits meter CREATING a store. Nothing metered RUNNING one, so a €49 plan
-- could keep fifty storefronts live forever and an agency had no reason to ever
-- climb the ladder. Capacity is the product's natural unit: Urivo makes stores,
-- so "how many can you run" is what a tier should sell.
--
-- Deliberately generous where it matters. A merchant's FIRST SALE — the metric
-- the business is steered by — needs exactly one live store, so the cap never
-- touches the path that decides whether someone succeeds. It binds only on the
-- portfolio operator, who is by definition already past it.
--
-- Enforced here rather than in the API because a count-then-write in
-- application code is a race: two publishes landing together would both read
-- "2 live" and both proceed. This locks the merchant's rows first, so the cap
-- holds under any amount of concurrency.
-- ------------------------------------------------------------

create or replace function public.publish_store(
    p_store_id uuid,
    -- NULL means unlimited (Pro). The caller passes the plan's capacity; the
    -- plan table lives in the app, the enforcement lives here.
    p_max_live integer default null
)
returns table (published boolean, live_count integer, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_is_live boolean;
    v_live    integer;
begin
    -- Lock every store this merchant owns, so a concurrent publish waits here
    -- rather than racing the count below.
    select s.user_id, s.is_active into v_user_id, v_is_live
    from public.stores s
    where s.id = p_store_id
    for update;

    if v_user_id is null then
        return query select false, 0, 'NOT_FOUND'::text;
        return;
    end if;

    -- Already live: publishing again is a no-op, never a cap failure.
    if v_is_live then
        select count(*)::integer into v_live
        from public.stores where user_id = v_user_id and is_active = true;
        return query select true, v_live, 'ALREADY_LIVE'::text;
        return;
    end if;

    select count(*)::integer into v_live
    from public.stores
    where user_id = v_user_id and is_active = true
    for update;

    if p_max_live is not null and v_live >= p_max_live then
        return query select false, v_live, 'AT_CAPACITY'::text;
        return;
    end if;

    -- published_at is stamped by the 0027 trigger, once and never reset.
    update public.stores set is_active = true, updated_at = now() where id = p_store_id;

    return query select true, v_live + 1, 'PUBLISHED'::text;
end $$;

revoke execute on function public.publish_store(uuid, integer) from public, anon;
grant execute on function public.publish_store(uuid, integer) to service_role;

comment on function public.publish_store(uuid, integer) is
    'Atomically take a store live within the plan''s live-store capacity. NULL capacity = unlimited.';


-- ─────────────────────────────────────────────────────────
-- 0031_custom_domains.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0031 — Custom domains
--
-- A merchant on their own brand's domain is the difference between owning a
-- business and renting a subdomain, and it is the clearest reason to stay
-- subscribed. Available on Founder and Pro.
--
-- The hostname is UNIQUE ACROSS THE PLATFORM, not per store. Two merchants
-- claiming the same domain is not a conflict to resolve later — it is a
-- hijack, and the constraint is the only thing that makes verification
-- meaningful.
-- ------------------------------------------------------------

create table if not exists public.store_domains (
    id           uuid primary key default gen_random_uuid(),
    store_id     uuid not null references public.stores (id) on delete cascade,
    -- Always stored lower-cased and punycode; the app normalises before writing.
    hostname     text not null,
    status       text not null default 'pending'
        check (status in ('pending', 'verifying', 'active', 'failed', 'removed')),
    -- The provider's own id for this hostname (Cloudflare custom hostname,
    -- Vercel domain, …) so the record can be reconciled or deleted later.
    provider     text not null default 'cloudflare',
    provider_id  text,
    -- What the merchant must add at their registrar, as returned by the
    -- provider. Rendered verbatim in the setup screen — never reconstructed,
    -- because a DNS instruction we invented is a support ticket we caused.
    dns_records  jsonb not null default '[]'::jsonb,
    -- Why verification failed, in the provider's words, for the setup screen.
    last_error   text,
    verified_at  timestamptz,
    checked_at   timestamptz,
    created_at   timestamptz not null default now(),

    -- A hostname is a name, not a URL: no scheme, no path, no port, at least
    -- one dot. Apex domains are accepted by the schema; the app decides policy.
    constraint store_domains_hostname_shape check (
        hostname = lower(hostname)
        and hostname !~ '[/:? ]'
        and position('.' in hostname) > 0
        and length(hostname) between 4 and 253
    )
);

-- The whole point: one hostname, one store, platform-wide.
create unique index if not exists idx_store_domains_hostname
    on public.store_domains (hostname)
    where status <> 'removed';

create index if not exists idx_store_domains_store on public.store_domains (store_id);
-- The request path: resolve an incoming Host header to a live store, fast.
create index if not exists idx_store_domains_active
    on public.store_domains (hostname)
    where status = 'active';

alter table public.store_domains enable row level security;

create policy "store_domains: owner read" on public.store_domains
    for select using (
        exists (
            select 1 from public.stores s
            where s.id = store_domains.store_id and s.user_id = auth.uid()
        )
    );

-- No insert/update/delete policies: every write goes through the API, which
-- checks the plan, calls the DNS provider and keeps the two in step. A row
-- written directly would claim a hostname the provider has never heard of.

-- ------------------------------------------------------------
-- Resolve an incoming Host header to its store. Definer + anon-executable
-- because the storefront serves anonymous shoppers, and deliberately narrow:
-- it returns a subdomain and nothing else, so it can never become a way to
-- enumerate the platform's domains.
-- ------------------------------------------------------------
create or replace function public.store_for_domain(p_hostname text)
returns table (store_id uuid, subdomain text)
language sql
stable
security definer
set search_path = public
as $$
    select s.id, s.subdomain
    from public.store_domains d
    join public.stores s on s.id = d.store_id
    where d.hostname = lower(btrim(p_hostname))
      and d.status = 'active'
      and s.is_active = true
    limit 1;
$$;

revoke execute on function public.store_for_domain(text) from public;
grant execute on function public.store_for_domain(text) to anon, authenticated, service_role;

comment on table public.store_domains is
    'Merchant-owned hostnames pointing at a Urivo storefront. Unique platform-wide.';


-- ─────────────────────────────────────────────────────────
-- 0032_image_provenance.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0032 — Image provenance
--
-- From 2 August 2026, Article 50 of the EU AI Act requires AI-generated
-- content to be disclosed. Urivo generates product photography, so its stores
-- carry that obligation — and the merchant, not Urivo, is the one publishing.
--
-- The obligation cannot be met with a blanket notice. A merchant who replaced
-- our imagery with their own photographs would then be declaring real work to
-- be synthetic, which is a false statement in the other direction and hands a
-- competitor an easy complaint. So provenance is recorded PER IMAGE, at the
-- moment the image is set, and the storefront discloses only what is true.
-- ------------------------------------------------------------

alter table public.products
    add column if not exists image_source text
        check (image_source is null or image_source in ('ai', 'uploaded', 'supplier', 'placeholder'));

comment on column public.products.image_source is
    'Where image_url came from. Drives the AI disclosure on the storefront (EU AI Act Art. 50). NULL = unknown provenance, disclosed conservatively.';

-- Backfill. Every image Urivo has produced so far came out of the generation
-- pipeline and lives in our own storage bucket; anything else is unknown and
-- stays NULL, which the storefront treats conservatively rather than silently
-- claiming a photograph is real.
update public.products
set image_source = 'ai'
where image_source is null
  and image_url is not null
  and image_url like '%/storage/v1/object/public/%';

-- ------------------------------------------------------------
-- Does this store publish any AI-generated imagery right now?
--
-- One question, answered in one place, so the storefront never has to decide
-- the legal case per render — and so a store whose photos were all replaced
-- stops disclosing automatically.
-- ------------------------------------------------------------
create or replace function public.store_has_ai_imagery(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.products
        where store_id = p_store_id
          and image_url is not null
          -- NULL provenance counts: an image we cannot vouch for is disclosed,
          -- never quietly presented as a photograph.
          and (image_source is null or image_source in ('ai', 'placeholder'))
    );
$$;

revoke execute on function public.store_has_ai_imagery(uuid) from public;
grant execute on function public.store_has_ai_imagery(uuid) to anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────
-- 0033_order_volume.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0033 — Order volume
--
-- Urivo takes NO percentage of a merchant's sales. A take rate would tax the
-- merchants who succeed — the ones who become the case studies, the referrals
-- and the reason anyone else signs up — and it would hand a merchant doing
-- €50k a month a standing reason to migrate somewhere that takes nothing.
--
-- Volume moves a merchant up a TIER instead. The difference matters: a tier is
-- capped and predictable, so a merchant at €5k a month pays 4% of revenue and a
-- merchant at €50k pays 0.4%. Success gets cheaper, not more expensive. Nobody
-- churns over a plan; people churn over a percentage.
--
-- THE ONE INVARIANT: this may never block a sale. Refusing a merchant's
-- customer to force an upgrade would take money out of their pocket, which is
-- strictly worse than the take rate we declined to charge. This function only
-- COUNTS; nothing on the checkout path reads it.
-- ------------------------------------------------------------

create or replace function public.monthly_paid_orders(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.orders o
    join public.stores s on s.id = o.store_id
    where s.user_id = p_user_id
      -- Paid and fulfilled both count; a fulfilled order was paid for.
      -- Refunded and cancelled do not: a merchant is not charged a tier for a
      -- sale that came back.
      and o.status in ('paid', 'fulfilled')
      -- Calendar month, so the allowance resets on a date the merchant can
      -- predict rather than on a rolling window they have to reason about.
      and o.created_at >= date_trunc('month', now());
$$;

revoke execute on function public.monthly_paid_orders(uuid) from public, anon;
grant execute on function public.monthly_paid_orders(uuid) to authenticated, service_role;

comment on function public.monthly_paid_orders(uuid) is
    'Paid orders this calendar month across a merchant''s stores. Drives the plan tier prompt. Never consulted on the checkout path.';
