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

-- Dropped first for the same reason as 0029: policies have no IF NOT EXISTS.

drop policy if exists "store_domains: owner read" on public.store_domains;
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
