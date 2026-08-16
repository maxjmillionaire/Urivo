-- ------------------------------------------------------------
-- 0035 — Comped access (testers, partners, support recovery)
--
-- There was no way to give somebody a real plan without charging them. That
-- makes the pre-launch test phase impossible: a tester cannot exercise the
-- assistant, multiple live stores or the Evolution Lab from the free tier, and
-- asking them to put a card in to do you a favour is not a test, it is a sale
-- with extra steps.
--
-- It also has a second use that outlives the launch. When something goes wrong
-- for a paying customer, the fastest apology is access, not a refund — and
-- issuing it by hand-editing a profile row is how a support gesture turns into
-- a billing incident.
--
-- TWO RULES.
--
-- 1. A COMP MAY NEVER TOUCH A PAYING CUSTOMER. Overwriting the plan of somebody
--    with a live Stripe subscription would silently desynchronise Urivo from
--    Stripe, and the webhook would fight the admin panel over the same column.
--    grant refuses; expiry skips them.
--
-- 2. A COMP MUST END BY ITSELF. Access granted "for a few days" that quietly
--    becomes permanent is indistinguishable from a pricing leak. Every grant
--    carries an expiry, and expiry does not depend on anyone remembering.
--
-- The plan column stays the single truth: a comp WRITES the real plan rather
-- than adding a parallel notion of entitlement, so every gate, dashboard and
-- billing screen in the product keeps working with no knowledge of comps.
-- ------------------------------------------------------------

alter table public.profiles
    -- Non-null = access was granted, not bought, and ends at this moment.
    add column if not exists comped_until timestamptz,
    -- Why, in the admin's words: 'launch tester', 'refund for the 12 Aug outage'.
    add column if not exists comp_reason  text;

-- Expiry sweeps look for the few rows that are comped, never scan the table.
create index if not exists idx_profiles_comped_until
    on public.profiles (comped_until)
    where comped_until is not null;

comment on column public.profiles.comped_until is
    'When granted (not purchased) access ends. Null for normal accounts. Never set for a Stripe subscriber.';

-- ------------------------------------------------------------
-- Grant. Service-role only: it is reached through an admin API route that has
-- already checked the caller is on the ADMIN_EMAILS allow-list.
--
-- Returns a row rather than raising, because every refusal here is an ordinary
-- outcome an admin needs to read ("that address has a subscription", "no such
-- user") and not an error worth a stack trace.
-- ------------------------------------------------------------
create or replace function public.grant_comped_access(
    p_email   text,
    p_plan    text,
    p_days    integer,
    p_credits integer default 0,
    p_reason  text default 'tester'
)
returns table (granted boolean, reason text, user_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_profile  public.profiles%rowtype;
    v_expires  timestamptz;
begin
    if p_plan not in ('free', 'core', 'pro') then
        return query select false, 'INVALID_PLAN'::text, null::uuid, null::timestamptz;
        return;
    end if;

    -- An unbounded comp is the leak this function exists to prevent, and a
    -- year-long one is the same leak with a slower fuse.
    if p_days is null or p_days < 1 or p_days > 365 then
        return query select false, 'INVALID_DURATION'::text, null::uuid, null::timestamptz;
        return;
    end if;

    if p_credits is null or p_credits < 0 or p_credits > 5000 then
        return query select false, 'INVALID_CREDITS'::text, null::uuid, null::timestamptz;
        return;
    end if;

    select * into v_profile
    from public.profiles
    where email = lower(btrim(p_email))
    for update;

    if v_profile.id is null then
        -- Deliberately not an invitation system: the person signs up normally,
        -- then gets upgraded. Creating auth users from here would bypass email
        -- confirmation, the disposable-domain blocklist and the signup throttle.
        return query select false, 'NO_SUCH_USER'::text, null::uuid, null::timestamptz;
        return;
    end if;

    -- Rule 1.
    if v_profile.stripe_subscription_id is not null
       or v_profile.subscription_status = 'active' then
        return query select false, 'HAS_SUBSCRIPTION'::text, v_profile.id, null::timestamptz;
        return;
    end if;

    -- Re-granting extends from now rather than stacking, so running the same
    -- command twice cannot quietly double someone's access.
    v_expires := now() + make_interval(days => p_days);

    update public.profiles
    set plan         = p_plan,
        comped_until = v_expires,
        comp_reason  = nullif(btrim(p_reason), ''),
        updated_at   = now()
    where id = v_profile.id;

    if p_credits > 0 then
        insert into public.credit_ledger (user_id, delta, reason, source)
        values (v_profile.id, p_credits, 'Comped access credits', 'system');
    end if;

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (v_profile.id, 'comped_access_granted', 'profile', v_profile.id::text);

    return query select true, 'OK'::text, v_profile.id, v_expires;
end;
$$;

revoke execute on function public.grant_comped_access(text, text, integer, integer, text)
    from public, anon, authenticated;
grant execute on function public.grant_comped_access(text, text, integer, integer, text)
    to service_role;

-- ------------------------------------------------------------
-- Revoke early — a tester who drops out, or a comp granted to the wrong
-- address. Drops them to free immediately; never touches a subscriber.
-- ------------------------------------------------------------
create or replace function public.revoke_comped_access(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    update public.profiles
    set plan         = 'free',
        comped_until = null,
        comp_reason  = null,
        updated_at   = now()
    where email = lower(btrim(p_email))
      and comped_until is not null
      and stripe_subscription_id is null
      and subscription_status <> 'active'
    returning id into v_id;

    if v_id is not null then
        insert into public.audit_logs (user_id, action, resource, resource_id)
        values (v_id, 'comped_access_revoked', 'profile', v_id::text);
    end if;

    return v_id is not null;
end;
$$;

revoke execute on function public.revoke_comped_access(text) from public, anon, authenticated;
grant execute on function public.revoke_comped_access(text) to service_role;

-- ------------------------------------------------------------
-- Rule 2, enforced. Idempotent and cheap enough to call opportunistically from
-- the application, which is exactly how it is called: expiry that depends on a
-- scheduler somebody has to configure is expiry that will not happen during a
-- four-day test phase.
--
-- A comped user who subscribed in the meantime keeps their plan — Stripe owns
-- it now — and merely loses the marker.
-- ------------------------------------------------------------
create or replace function public.expire_comped_access()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_expired integer;
begin
    with downgraded as (
        update public.profiles
        set plan         = 'free',
            comped_until = null,
            comp_reason  = null,
            updated_at   = now()
        where comped_until is not null
          and comped_until < now()
          and stripe_subscription_id is null
          and subscription_status <> 'active'
        returning id
    )
    select count(*)::integer into v_expired from downgraded;

    -- They started paying during the comp: the marker is stale, the plan is not.
    update public.profiles
    set comped_until = null,
        comp_reason  = null
    where comped_until is not null
      and (stripe_subscription_id is not null or subscription_status = 'active');

    return v_expired;
end;
$$;

revoke execute on function public.expire_comped_access() from public, anon, authenticated;
grant execute on function public.expire_comped_access() to service_role;

-- ------------------------------------------------------------
-- Who currently has granted access, for the admin screen.
-- ------------------------------------------------------------
create or replace function public.comped_accounts()
returns table (
    email        text,
    full_name    text,
    plan         text,
    comp_reason  text,
    comped_until timestamptz,
    credits      integer,
    stores       integer
)
language sql
stable
security definer
set search_path = public
as $$
    select p.email,
           p.full_name,
           p.plan,
           p.comp_reason,
           p.comped_until,
           coalesce((select sum(l.delta)::integer from public.credit_ledger l where l.user_id = p.id), 0),
           (select count(*)::integer from public.stores s where s.user_id = p.id)
    from public.profiles p
    where p.comped_until is not null
    order by p.comped_until asc;
$$;

revoke execute on function public.comped_accounts() from public, anon, authenticated;
grant execute on function public.comped_accounts() to service_role;
