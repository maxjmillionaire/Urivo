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
