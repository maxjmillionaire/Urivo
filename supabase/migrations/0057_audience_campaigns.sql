-- Audience: the merchant's own customer list, made visible and mailable.
--
-- WHY THIS EXISTS
--
-- store_subscribers (0029) already captured every shopper who typed their
-- address into a storefront's newsletter box — and then nothing read it. The
-- merchant could not see the list, export it, or email it, and the addresses
-- sat as PII no one could act on. That is a dead end and, for EU merchants, a
-- data-protection edge (personal data collected with no purpose the person
-- benefits from). This migration turns the captured list into an asset the
-- merchant owns and can use, with a lawful one-click unsubscribe built in.
--
-- NUMBERING
--
-- 0055 and 0056 are reserved by an in-flight branch (the free-tier publishing
-- change). This migration touches only store_subscribers and a new
-- store_campaigns table, so it is independent of those and applies cleanly in
-- either merge order; the gap closes when that branch lands.

-- ------------------------------------------------------------
-- 1. Per-subscriber unsubscribe token.
--
-- Every marketing email must carry a working unsubscribe, and the link must not
-- expose a guessable id. A per-row uuid token is the unsubscribe key: it goes in
-- the email footer and nowhere else. gen_random_uuid() is volatile, so each
-- existing row is backfilled with its own distinct token.
-- ------------------------------------------------------------
alter table public.store_subscribers
    add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- ------------------------------------------------------------
-- 2. Campaigns — what the merchant sent, to how many, and when.
--
-- An audit trail and the dashboard's "sent" history. The body is stored as the
-- markdown the merchant approved, so a sent campaign is reproducible.
-- ------------------------------------------------------------
create table if not exists public.store_campaigns (
    id             uuid primary key default gen_random_uuid(),
    store_id       uuid not null references public.stores (id) on delete cascade,
    subject        text not null,
    body           text not null,
    audience_count integer not null default 0,
    sent_count     integer not null default 0,
    status         text not null default 'draft' check (status in ('draft', 'sent')),
    created_at     timestamptz not null default now(),
    sent_at        timestamptz
);

create index if not exists idx_store_campaigns_store
    on public.store_campaigns (store_id, created_at desc);

alter table public.store_campaigns enable row level security;

-- The merchant reads and writes their own stores' campaigns; nobody else can
-- see them. Scoped `to authenticated` (a signed-in owner), never anon — the
-- subquery reads public.stores, which authenticated already has table-level
-- SELECT on, so the policy expression is satisfiable (the lesson from 0053).
drop policy if exists "store_campaigns: owner read" on public.store_campaigns;
create policy "store_campaigns: owner read" on public.store_campaigns
    for select to authenticated using (
        exists (
            select 1 from public.stores s
            where s.id = store_campaigns.store_id and s.user_id = auth.uid()
        )
    );

drop policy if exists "store_campaigns: owner insert" on public.store_campaigns;
create policy "store_campaigns: owner insert" on public.store_campaigns
    for insert to authenticated with check (
        exists (
            select 1 from public.stores s
            where s.id = store_campaigns.store_id and s.user_id = auth.uid()
        )
    );

grant select, insert on public.store_campaigns to authenticated;

-- ------------------------------------------------------------
-- 3. One-click unsubscribe by token — public, definer, idempotent.
--
-- The link in a campaign footer hits a public route that calls this. It sets
-- unsubscribed_at once (a second click is a no-op, not an error) and never
-- reveals whether the token existed beyond a boolean, so the endpoint is not an
-- oracle. No SELECT on the table is granted to anon — only this function.
-- ------------------------------------------------------------
create or replace function public.unsubscribe_by_token(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_found boolean := false;
begin
    if p_token is null then
        return false;
    end if;

    update public.store_subscribers
       set unsubscribed_at = coalesce(unsubscribed_at, now())
     where unsubscribe_token = p_token
    returning true into v_found;

    return coalesce(v_found, false);
end $$;

revoke execute on function public.unsubscribe_by_token(uuid) from public;
grant execute on function public.unsubscribe_by_token(uuid) to anon, authenticated, service_role;

comment on function public.unsubscribe_by_token(uuid) is
    'One-click unsubscribe from a campaign footer link. Idempotent, definer, '
    'anon-executable; sets store_subscribers.unsubscribed_at by token (0057).';
