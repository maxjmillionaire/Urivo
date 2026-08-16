-- ------------------------------------------------------------
-- 0046 — publish_store could never publish a store
--
-- 0030 meant to lock the merchant's rows before counting them:
--
--     select count(*)::integer into v_live
--     from public.stores
--     where user_id = v_user_id and is_active = true
--     for update;                                  -- ← invalid
--
-- PostgreSQL refuses that outright: "FOR UPDATE is not allowed with aggregate
-- functions". It is not a slow path or an edge case — the statement raises
-- every time control reaches it, which is every publish of a store that is not
-- already live. The API turned that into a 500 and told the merchant to try
-- again, which never helped.
--
-- It stayed hidden because almost nothing reaches it in a first run: a
-- generated store is created with is_active DEFAULT TRUE, so a merchant's first
-- store is born live without publish_store ever being asked. The function only
-- runs when someone pauses a store and takes it live again, or takes a second
-- one live — so the capacity cap that Founder and Pro are sold on was also the
-- one path nobody exercised.
--
-- The lock and the count have to be two statements. Row locks are taken over
-- the merchant's stores first — a concurrent publish blocks there — and the
-- count runs afterwards, so the cap still holds under concurrency exactly as
-- 0030 intended.
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

    -- Lock every store this merchant owns, so a concurrent publish waits here
    -- rather than racing the count. Separate from the count on purpose: a row
    -- lock and an aggregate cannot be the same statement.
    perform 1 from public.stores where user_id = v_user_id for update;

    select count(*)::integer into v_live
    from public.stores
    where user_id = v_user_id and is_active = true;

    if p_max_live is not null and v_live >= p_max_live then
        return query select false, v_live, 'AT_CAPACITY'::text;
        return;
    end if;

    -- published_at is stamped by the 0027 trigger, once and never reset.
    update public.stores set is_active = true, updated_at = now() where id = p_store_id;

    return query select true, v_live + 1, 'PUBLISHED'::text;
end $$;

revoke execute on function public.publish_store(uuid, integer) from public, anon, authenticated;
grant execute on function public.publish_store(uuid, integer) to service_role;

comment on function public.publish_store(uuid, integer) is
    'Atomically take a store live within the plan''s live-store capacity. NULL capacity = unlimited.';
