-- ============================================================
-- URIVO — Database catch-up (migrations 0029–0029).
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
