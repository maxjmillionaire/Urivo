-- Generation protection — durable, Postgres-backed. No queue, no new infra.
--
-- WHAT THIS IS (AND IS NOT)
--
-- There is no durable distributed queue here, because one cannot exist without
-- new infrastructure (Redis/BullMQ/a worker), which is out of scope — and a
-- Railway container can restart mid-request, so any in-memory coordination is a
-- lie. Postgres is the one durable coordinator we already run, so the expensive
-- generation path is protected with it:
--
--   • at most ONE running generation per user (a partial unique index),
--   • an expiring lock so a crashed generation self-releases,
--   • idempotency so a double-submit / retry never double-generates or
--     double-charges,
--   • a global ceiling for coarse backpressure.
--
-- The route turns a refused claim into a controlled 429 + Retry-After. It never
-- tells the shopper their request was "queued" — nothing here is a queue.

create table if not exists public.generation_jobs (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references public.profiles (id) on delete cascade,
    -- Dedup key: the request's subdomain (its natural identity) or a client
    -- Idempotency-Key. A retried submit reuses the row instead of starting again.
    idempotency_key text not null,
    subdomain       text,
    status          text not null default 'running'
        check (status in ('running', 'succeeded', 'failed')),
    -- The store this job created, once it succeeds — so a retry after success
    -- returns the same store rather than making another.
    store_id        uuid,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- A running job past this is treated as crashed and reclaimed. Set beyond the
    -- route's maxDuration so a slow-but-alive generation is never stolen.
    expires_at      timestamptz not null
);

-- Idempotency: exactly one row per (user, key).
create unique index if not exists uq_generation_jobs_idem
    on public.generation_jobs (user_id, idempotency_key);

-- Concurrency: at most one RUNNING job per user. Crashed jobs are flipped to
-- 'failed' by claim_generation_job before this is consulted, which frees the
-- slot — a predicate index cannot reference now(), so reclamation is explicit.
create unique index if not exists uq_generation_jobs_running_per_user
    on public.generation_jobs (user_id) where status = 'running';

create index if not exists idx_generation_jobs_running
    on public.generation_jobs (expires_at) where status = 'running';

alter table public.generation_jobs enable row level security;
-- No policies: this table is touched only by the service role through the two
-- functions below. It holds no data a browser should read directly.

-- ------------------------------------------------------------
-- Claim a generation slot BEFORE the expensive work. Race-safe: the unique
-- indexes are the real guarantee; the pre-checks give clean outcomes on the
-- common path. Outcomes: 'claimed' | 'duplicate_succeeded' | 'in_progress' |
-- 'busy_user' | 'busy_global'.
-- ------------------------------------------------------------
create or replace function public.claim_generation_job(
    p_user_id     uuid,
    p_key         text,
    p_subdomain   text,
    p_ttl_seconds integer,
    p_max_global  integer
) returns table(outcome text, job_id uuid, store_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_job public.generation_jobs;
    v_deadline timestamptz := now() + make_interval(secs => greatest(p_ttl_seconds, 1));
begin
    -- Reclaim THIS user's crashed/expired running jobs so a dead request can
    -- never lock them out; this releases the per-user running-lock slot.
    update public.generation_jobs
       set status = 'failed', updated_at = now()
     where user_id = p_user_id and status = 'running' and expires_at <= now();

    -- Idempotent replay of a request we've already seen under this key.
    select * into v_job from public.generation_jobs
     where user_id = p_user_id and idempotency_key = p_key;
    if found then
        if v_job.status = 'succeeded' then
            return query select 'duplicate_succeeded'::text, v_job.id, v_job.store_id;
            return;
        elsif v_job.status = 'running' then  -- still in flight (expired ones were reclaimed above)
            return query select 'in_progress'::text, v_job.id, null::uuid;
            return;
        end if;
        -- else 'failed': fall through and re-claim the same row for a fresh run.
    end if;

    -- Per-user concurrency: any OTHER live running job blocks a new generation.
    if exists (
        select 1 from public.generation_jobs
         where user_id = p_user_id and status = 'running' and expires_at > now()
           and (v_job.id is null or id <> v_job.id)
    ) then
        return query select 'busy_user'::text, null::uuid, null::uuid;
        return;
    end if;

    -- Global ceiling on concurrent expensive generations (coarse backpressure).
    if (select count(*) from public.generation_jobs
          where status = 'running' and expires_at > now()) >= p_max_global then
        return query select 'busy_global'::text, null::uuid, null::uuid;
        return;
    end if;

    -- Claim: reuse a prior failed row for this key, else insert fresh. A lost
    -- race trips a unique index and is reported as backpressure, not a 500.
    begin
        if found then
            update public.generation_jobs
               set status = 'running', store_id = null, subdomain = p_subdomain,
                   expires_at = v_deadline, updated_at = now()
             where id = v_job.id
            returning id into job_id;
        else
            insert into public.generation_jobs (user_id, idempotency_key, subdomain, status, expires_at)
                 values (p_user_id, p_key, p_subdomain, 'running', v_deadline)
            returning id into job_id;
        end if;
        return query select 'claimed'::text, job_id, null::uuid;
    exception when unique_violation then
        return query select 'busy_user'::text, null::uuid, null::uuid;
    end;
end $$;

-- ------------------------------------------------------------
-- Finish a claimed job — success (with the created store) or failure. Failure
-- frees the per-user lock immediately; because credits are deducted only inside
-- generate_store_atomic on success, a failed generation has consumed none.
-- ------------------------------------------------------------
create or replace function public.finish_generation_job(
    p_job_id   uuid,
    p_status   text,
    p_store_id uuid
) returns void
language sql
security definer
set search_path = public
as $$
    update public.generation_jobs
       set status = case when p_status in ('succeeded', 'failed') then p_status else 'failed' end,
           store_id = coalesce(p_store_id, store_id),
           updated_at = now()
     where id = p_job_id and status = 'running';
$$;

revoke execute on function public.claim_generation_job(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_generation_job(uuid, text, text, integer, integer) to service_role;
revoke execute on function public.finish_generation_job(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finish_generation_job(uuid, text, uuid) to service_role;

comment on table public.generation_jobs is
    'Durable per-user lock + idempotency for expensive store generation (0059). '
    'Postgres-backed, not a queue; the route converts a refused claim into 429 + Retry-After.';
