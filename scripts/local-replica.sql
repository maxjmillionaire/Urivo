-- ------------------------------------------------------------
-- A local stand-in for the hosted parts of a Supabase project.
--
-- WHY THIS EXISTS
--
-- scripts/adversarial-tenancy.sh needs an owner connection: it seeds fixtures
-- and reads around RLS to establish ground truth. Production is hosted
-- Supabase, where no such connection exists, so for most of this project's
-- life the tenancy suite had nowhere to run and its results were assumed
-- rather than measured.
--
-- Applying this file and then supabase/setup_all.sql to a plain PostgreSQL 16
-- gives a database whose SCHEMA, POLICIES AND GRANTS are identical to
-- production, because setup_all.sql is the same file that provisions it. That
-- is enough to test everything RLS and privileges decide. It is NOT production
-- and holds none of its data, so anything data-dependent — how many stores
-- exist, whether a table is populated — must still be measured against the
-- real database with scripts/adversarial-tenancy-rest.mjs.
--
--   createdb urivo
--   psql -d urivo -f scripts/local-replica.sql
--   psql -d urivo -f supabase/setup_all.sql
--   PGDATABASE=urivo scripts/adversarial-tenancy.sh
--
-- The default privileges below are the load-bearing part. Supabase grants anon
-- and authenticated full DML on `public` out of the box, and every revoke in
-- migrations 0045 and 0052 is written against that starting point. A replica
-- without them would let those migrations "pass" by revoking privileges that
-- had never been granted.
-- ------------------------------------------------------------

create schema if not exists auth;

-- Only the columns setup_all.sql and the test fixtures actually touch. The
-- shape matches Supabase's own auth.users closely enough that the signup
-- trigger — which reads email_confirmed_at and raw_user_meta_data — behaves
-- identically.
create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    instance_id uuid default '00000000-0000-0000-0000-000000000000',
    aud text default 'authenticated',
    role text default 'authenticated',
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Supabase resolves the caller from the verified JWT and exposes it as a GUC.
-- PostgREST sets exactly this setting, so RLS evaluates identically here.
create or replace function auth.uid() returns uuid
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
    end if;
end $$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Supabase Storage — only the two relations setup_all.sql touches.
-- ------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false
);

create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
