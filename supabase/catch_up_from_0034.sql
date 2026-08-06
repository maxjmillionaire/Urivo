-- ============================================================
-- URIVO — Database catch-up (migrations 0034–0036).
-- For a project that ALREADY has the earlier migrations applied.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- Use setup_all.sql instead on a brand-new, empty project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build -- --from 0034
-- ============================================================


-- ─────────────────────────────────────────────────────────
-- 0034_welcome_credits_25.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0034 — Free-tier welcome credits: 20 → 25
--
-- The pricing table promised "25 welcome AI credits" while the database granted
-- 20. A new account therefore read a number on the front page, counted its
-- balance, and found the first promise Urivo ever made to it was false — on the
-- free tier, which is the top of the entire funnel.
--
-- 25 is the deliberate figure, not a round-up: generating a store costs 20, so
-- 25 leaves five credits over. Those five are the only reason a free user ever
-- talks to the assistant, and the assistant is what sells Pro. Twenty credits
-- buys the store and nothing else — the user meets the product exactly once.
--
-- Since 0019 this function is the ONLY place the amount is written (the signup
-- trigger and the confirmation trigger both delegate here), so redefining it is
-- the whole change. Existing users are unaffected: their balance is history and
-- history is correct.
-- ------------------------------------------------------------

create or replace function public.grant_welcome_credits(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Mirrored by PLANS.free.signupCredits in lib/plans.ts. A test reads this
    -- line and fails if the two ever drift again, because they already did:
    -- the number lived in three places and disagreed with itself in two.
    v_welcome_credits constant integer := 25;
begin
    if public.is_email_domain_blocked(p_email) then
        -- Disposable address → no free generation. Recorded for visibility.
        insert into public.audit_logs (user_id, action, resource, resource_id)
        values (p_user_id, 'welcome_credits_withheld', 'profile', p_user_id::text);
        return;
    end if;

    -- The ledger reason is the idempotency guard: granted at most once per
    -- user, so a re-run — or a confirmation trigger firing twice — is a no-op.
    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and reason = 'Free tier welcome credits'
    ) then
        return;
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, v_welcome_credits, 'Free tier welcome credits', 'system');
end;
$$;

comment on function public.grant_welcome_credits(uuid, text) is
    'One-time free-tier grant. Amount mirrors PLANS.free.signupCredits; guarded by the ledger reason.';


-- ─────────────────────────────────────────────────────────
-- 0035_comped_access.sql
-- ─────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────
-- 0036_feedback.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0036 — In-product feedback
--
-- The test phase before launch produces exactly one asset: what the testers
-- tell us. Collected in a chat thread it arrives as "the store thing didn't
-- work" with no page, no store, no browser and no time — and by the time
-- anyone asks, the tester has moved on and cannot remember either.
--
-- Captured from inside the product it arrives with the route, the store, the
-- plan and the viewport already attached, because the application knows all
-- four at the moment the button is pressed and the person does not have to be
-- asked for any of them.
--
-- This is deliberately not a support inbox. It is a funnel instrument: the
-- North Star is the share of merchants who reach a first real sale, and the
-- only way to learn where that path breaks is to record where people were
-- standing when it broke.
-- ------------------------------------------------------------

create table if not exists public.feedback (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    -- Denormalised on purpose: feedback must survive the account being deleted
    -- long enough to be acted on, and an admin reading the list needs to know
    -- who it was without a join to a row that may be gone.
    email      text not null,
    kind       text not null default 'bug'
        check (kind in ('bug', 'confusing', 'idea', 'praise')),
    message    text not null,
    -- Where they were. The single most valuable field in the table.
    route      text,
    store_id   uuid references public.stores (id) on delete set null,
    -- Plan at the time of writing; a complaint about credits means something
    -- different on Free than on Pro, and the plan may change before anyone reads it.
    plan       text,
    -- Viewport, user agent, screen size — whatever the client can state about
    -- itself. Free-form because the useful fields change faster than a schema.
    context    jsonb not null default '{}'::jsonb,
    resolved_at timestamptz,
    admin_note  text,
    created_at timestamptz not null default now(),

    constraint feedback_message_length check (length(btrim(message)) between 3 and 4000)
);

create index if not exists idx_feedback_created on public.feedback (created_at desc);
create index if not exists idx_feedback_open
    on public.feedback (created_at desc)
    where resolved_at is null;
create index if not exists idx_feedback_user on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

-- Postgres has no `create policy if not exists`; dropping first keeps a re-run
-- of the catch-up script from failing with 42710 and rolling everything back.
drop policy if exists "feedback: author read" on public.feedback;
create policy "feedback: author read" on public.feedback
    for select using (user_id = auth.uid());

-- No insert policy: submissions go through the RPC below, which stamps the
-- email and plan from the server's own view of the account. A client-supplied
-- plan on a bug report about plan gating is worth nothing.

-- ------------------------------------------------------------
-- Submit. Definer, and executable by any signed-in user.
-- ------------------------------------------------------------
create or replace function public.submit_feedback(
    p_message  text,
    p_kind     text default 'bug',
    p_route    text default null,
    p_store_id uuid default null,
    p_context  jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user    uuid := auth.uid();
    v_email   text;
    v_plan    text;
    v_recent  integer;
begin
    if v_user is null then
        return false;
    end if;

    if p_message is null or length(btrim(p_message)) < 3 then
        return false;
    end if;

    select email, plan into v_email, v_plan from public.profiles where id = v_user;
    if v_email is null then
        return false;
    end if;

    -- A stuck send button retrying, or somebody bored. Twenty an hour is far
    -- more than an honest tester needs and far less than a nuisance.
    select count(*)::integer into v_recent
    from public.feedback
    where user_id = v_user and created_at > now() - interval '1 hour';
    if v_recent >= 20 then
        return false;
    end if;

    insert into public.feedback (user_id, email, kind, message, route, store_id, plan, context)
    values (
        v_user,
        v_email,
        case when p_kind in ('bug', 'confusing', 'idea', 'praise') then p_kind else 'bug' end,
        left(btrim(p_message), 4000),
        left(coalesce(p_route, ''), 500),
        -- Only accept a store the sender actually owns, so the field cannot be
        -- used to probe which store ids exist.
        (select s.id from public.stores s where s.id = p_store_id and s.user_id = v_user),
        v_plan,
        coalesce(p_context, '{}'::jsonb)
    );

    return true;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.submit_feedback(text, text, text, uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- The admin inbox. Newest first, open items first — during a test phase the
-- only question is "what is still broken".
-- ------------------------------------------------------------
create or replace function public.feedback_inbox(p_limit integer default 100)
returns table (
    id          uuid,
    email       text,
    kind        text,
    message     text,
    route       text,
    plan        text,
    store_name  text,
    context     jsonb,
    resolved_at timestamptz,
    created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select f.id, f.email, f.kind, f.message, f.route, f.plan,
           s.store_name, f.context, f.resolved_at, f.created_at
    from public.feedback f
    left join public.stores s on s.id = f.store_id
    order by (f.resolved_at is null) desc, f.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke execute on function public.feedback_inbox(integer) from public, anon, authenticated;
grant execute on function public.feedback_inbox(integer) to service_role;

create or replace function public.resolve_feedback(p_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    update public.feedback
    set resolved_at = case when resolved_at is null then now() else null end,
        admin_note  = coalesce(nullif(btrim(p_note), ''), admin_note)
    where id = p_id
    returning id into v_id;
    return v_id is not null;
end;
$$;

revoke execute on function public.resolve_feedback(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_feedback(uuid, text) to service_role;

comment on table public.feedback is
    'In-product feedback with the route, store and plan attached. Funnel instrument, not a support inbox.';
