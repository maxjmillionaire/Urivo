-- ============================================================
-- URIVO — Database catch-up (migrations 0034–0038).
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


-- ─────────────────────────────────────────────────────────
-- 0037_economics.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0037 — Economics: real revenue, real image cost, real budget
--
-- Urivo already measures what it SPENDS exactly: every AI action writes token
-- counts and provider cost to ai_usage_ledger at the moment it happens. It has
-- never measured what it EARNS. Monthly revenue was derived by counting
-- profiles by plan and multiplying by the list price — which silently assumes
-- nobody is on a founding price, nobody bought a credit pack, nobody was
-- refunded, and every subscription actually collected. Gross margin computed
-- from that is an estimate wearing the clothes of a measurement.
--
-- Three things here, all in service of one rule: a number on the finance
-- dashboard either comes from a recorded event, or it is labelled as modelled.
--
--   1. platform_revenue — every euro Urivo actually collects, written by the
--      Stripe webhook from the amount Stripe reports, keyed by the event id so
--      a retry cannot double-count it.
--   2. A configurable image cost with PROVENANCE. The €0.07/image figure is an
--      estimate, and it is roughly two thirds of the cost of a free signup, so
--      it is the largest single assumption in the business. It moves to
--      settings (changeable without a deploy), carries whether it is estimated
--      or measured, and historical rows can be rebased to a corrected rate —
--      exactly because the ledger already stores the image COUNT.
--   3. A monthly AI budget, so "remaining budget" is a real number rather than
--      a feeling.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. Platform revenue
-- ------------------------------------------------------------
create table if not exists public.platform_revenue (
    id          uuid primary key default gen_random_uuid(),
    -- Nullable: a refund or an event we cannot attribute still belongs in the
    -- total. Revenue that only counts when we can name the customer is not a
    -- total, it is a sample.
    user_id     uuid references public.profiles (id) on delete set null,
    kind        text not null check (kind in ('subscription', 'credit_pack', 'refund')),
    -- Signed minor units, as Stripe reports them. Refunds are negative, so the
    -- month's revenue is a plain sum and can never be overstated by forgetting
    -- to subtract something.
    amount_cents integer not null,
    currency    text not null default 'eur',
    -- Which plan or pack this was, for the per-plan margin view.
    plan        text,
    pack        text,
    -- Stripe's own ids. The event id is UNIQUE: Stripe retries webhooks, and a
    -- retry that added revenue twice would corrupt every figure downstream.
    stripe_event_id  text not null unique,
    stripe_object_id text,
    occurred_at timestamptz not null default now(),
    created_at  timestamptz not null default now()
);

create index if not exists idx_platform_revenue_occurred
    on public.platform_revenue (occurred_at desc);
create index if not exists idx_platform_revenue_user
    on public.platform_revenue (user_id, occurred_at desc);

alter table public.platform_revenue enable row level security;
-- No policies at all: this is founder-only data, reached exclusively through
-- service_role from the admin surface. RLS on with no policy denies everyone.

comment on table public.platform_revenue is
    'Every euro Urivo collects, from Stripe, idempotent on the event id. The measured half of gross margin.';

-- ------------------------------------------------------------
-- 2. Operational settings: image cost, thresholds, budget
-- ------------------------------------------------------------
alter table public.platform_settings
    -- Null = fall back to the code default. Set = this rate wins, no deploy.
    add column if not exists image_cost_usd numeric(10, 6),
    -- 'estimated' until somebody reads it off a real invoice. The dashboard
    -- labels every figure that depends on an estimate, so a guess can never be
    -- mistaken for a measurement.
    add column if not exists image_cost_source text not null default 'estimated'
        check (image_cost_source in ('estimated', 'measured')),
    -- Ascending euro thresholds. Each one alerts once per day, so a runaway day
    -- escalates instead of going quiet after the first email.
    add column if not exists daily_spend_thresholds_eur numeric[] not null default '{25,50,100}',
    -- The highest threshold already alerted today; reset when the day rolls.
    add column if not exists spend_alert_high_water_eur numeric not null default 0,
    -- 0 = no budget set.
    add column if not exists monthly_ai_budget_eur numeric not null default 0;

comment on column public.platform_settings.image_cost_usd is
    'Effective per-image cost. Null falls back to the code default. Change with rebase_image_costs to keep history consistent.';

-- ------------------------------------------------------------
-- 3. Today, at a glance — the number that decides whether to act now
-- ------------------------------------------------------------
create or replace function public.finance_today(p_day date default (now() at time zone 'utc')::date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with day_bounds as (
        select p_day::timestamptz as from_ts, (p_day + 1)::timestamptz as to_ts
    ),
    cost as (
        select coalesce(sum(l.total_cost_usd), 0)::numeric      as total_usd,
               coalesce(sum(l.anthropic_cost_usd), 0)::numeric  as anthropic_usd,
               coalesce(sum(l.image_cost_usd), 0)::numeric      as image_usd,
               count(*)::integer                                as actions,
               coalesce(sum(l.credits), 0)::integer             as credits,
               count(distinct l.user_id)::integer               as users
        from public.ai_usage_ledger l, day_bounds b
        where l.created_at >= b.from_ts and l.created_at < b.to_ts
    ),
    -- Split by whether the account behind the spend pays us anything. Free
    -- spend is the number with no revenue behind it; paid spend is expected
    -- cost of goods.
    split as (
        select
            coalesce(sum(l.total_cost_usd) filter (where p.plan = 'free'), 0)::numeric as free_usd,
            coalesce(sum(l.total_cost_usd) filter (where p.plan <> 'free'), 0)::numeric as paid_usd
        from public.ai_usage_ledger l
        join public.profiles p on p.id = l.user_id, day_bounds b
        where l.created_at >= b.from_ts and l.created_at < b.to_ts
    ),
    -- The single most expensive thing we did today, which is the first place
    -- to look when a day is unusual.
    top_feature as (
        select l.feature,
               sum(l.total_cost_usd)::numeric as cost_usd,
               count(*)::integer              as actions
        from public.ai_usage_ledger l, day_bounds b
        where l.created_at >= b.from_ts and l.created_at < b.to_ts
        group by l.feature
        order by 2 desc
        limit 1
    ),
    revenue as (
        select coalesce(sum(r.amount_cents), 0)::integer as cents
        from public.platform_revenue r, day_bounds b
        where r.occurred_at >= b.from_ts and r.occurred_at < b.to_ts
          and r.currency = 'eur'
    )
    select jsonb_build_object(
        'day',             p_day,
        'total_cost_usd',  (select total_usd from cost),
        'anthropic_usd',   (select anthropic_usd from cost),
        'image_usd',       (select image_usd from cost),
        'actions',         (select actions from cost),
        'credits',         (select credits from cost),
        'users',           (select users from cost),
        'free_cost_usd',   coalesce((select free_usd from split), 0),
        'paid_cost_usd',   coalesce((select paid_usd from split), 0),
        'revenue_cents',   (select cents from revenue),
        'top_feature',     (select feature from top_feature),
        'top_feature_usd', coalesce((select cost_usd from top_feature), 0),
        'top_feature_actions', coalesce((select actions from top_feature), 0)
    );
$$;

revoke execute on function public.finance_today(date) from public, anon, authenticated;
grant execute on function public.finance_today(date) to service_role;

-- ------------------------------------------------------------
-- 4. Revenue for a period, by kind. The measured half of gross margin.
-- ------------------------------------------------------------
create or replace function public.finance_revenue(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'total_cents',        coalesce(sum(amount_cents), 0)::integer,
        'subscription_cents', coalesce(sum(amount_cents) filter (where kind = 'subscription'), 0)::integer,
        'pack_cents',         coalesce(sum(amount_cents) filter (where kind = 'credit_pack'), 0)::integer,
        'refund_cents',       coalesce(sum(amount_cents) filter (where kind = 'refund'), 0)::integer,
        'events',             count(*)::integer,
        -- Anything not in euros is excluded from the sums above rather than
        -- silently added at an invented rate. Surfaced so it cannot hide.
        'non_eur_events',     count(*) filter (where currency <> 'eur')::integer
    )
    from public.platform_revenue
    where occurred_at >= p_since and currency = 'eur';
$$;

revoke execute on function public.finance_revenue(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_revenue(timestamptz) to service_role;

-- ------------------------------------------------------------
-- 5. Gross margin per plan, both sides measured.
--
-- Cost comes from the usage ledger grouped by the payer's CURRENT plan, which
-- is the honest approximation available: the ledger records who spent, and the
-- profile records what they pay. A merchant who upgrades mid-month moves their
-- whole month's cost to the new tier; over a month that is noise, and the
-- alternative — stamping the plan onto every ledger row — buys precision
-- nobody would act on.
-- ------------------------------------------------------------
create or replace function public.finance_margin_by_plan(p_since timestamptz)
returns table (
    plan            text,
    users           integer,
    actions         integer,
    credits         integer,
    cost_usd        numeric,
    revenue_cents   integer
)
language sql
stable
security definer
set search_path = public
as $$
    with cost as (
        select p.plan,
               count(distinct l.user_id)::integer          as users,
               count(*)::integer                           as actions,
               coalesce(sum(l.credits), 0)::integer        as credits,
               coalesce(sum(l.total_cost_usd), 0)::numeric as cost_usd
        from public.ai_usage_ledger l
        join public.profiles p on p.id = l.user_id
        where l.created_at >= p_since
        group by p.plan
    ),
    rev as (
        select coalesce(r.plan, 'unattributed') as plan,
               coalesce(sum(r.amount_cents), 0)::integer as revenue_cents
        from public.platform_revenue r
        where r.occurred_at >= p_since and r.currency = 'eur'
        group by 1
    )
    select coalesce(c.plan, r.plan),
           coalesce(c.users, 0),
           coalesce(c.actions, 0),
           coalesce(c.credits, 0),
           coalesce(c.cost_usd, 0),
           coalesce(r.revenue_cents, 0)
    from cost c
    full outer join rev r on r.plan = c.plan
    order by 6 desc;
$$;

revoke execute on function public.finance_margin_by_plan(timestamptz) from public, anon, authenticated;
grant execute on function public.finance_margin_by_plan(timestamptz) to service_role;

-- ------------------------------------------------------------
-- 6. Rebase historical image cost to a corrected rate.
--
-- The ledger stores the image COUNT alongside the cost, which is what makes
-- this exact rather than a fudge: every row's image cost is recomputed as
-- count × rate, and the row total is rebuilt from its two parts. Run this once
-- when the real per-image price is known, and the whole history stops being a
-- mixture of two different assumptions.
--
-- Returns the number of rows corrected.
-- ------------------------------------------------------------
create or replace function public.rebase_image_costs(p_rate_usd numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rows integer;
begin
    if p_rate_usd is null or p_rate_usd < 0 or p_rate_usd > 10 then
        raise exception 'rebase_image_costs: implausible rate %', p_rate_usd;
    end if;

    with updated as (
        update public.ai_usage_ledger
        set image_cost_usd = round(images * p_rate_usd, 6),
            total_cost_usd = round(anthropic_cost_usd + (images * p_rate_usd), 6)
        where images > 0
        returning id
    )
    select count(*)::integer into v_rows from updated;

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (null, 'image_cost_rebased', 'ai_usage_ledger', p_rate_usd::text);

    return v_rows;
end;
$$;

revoke execute on function public.rebase_image_costs(numeric) from public, anon, authenticated;
grant execute on function public.rebase_image_costs(numeric) to service_role;

comment on function public.rebase_image_costs(numeric) is
    'Recompute every historical image cost at a corrected per-image rate. Exact, because the ledger stores image counts.';


-- ─────────────────────────────────────────────────────────
-- 0038_ad_attribution.sql
-- ─────────────────────────────────────────────────────────
-- ------------------------------------------------------------
-- 0038 — Ad attribution: which ad actually made money
--
-- Ad Studio generated ads and forgot them. The plan came back as JSON, the
-- merchant copied it into Meta, and nothing in Urivo ever learned whether a
-- single one of those ads worked. The second run for a store knew nothing
-- about the first. That is a generator, not a marketing system, and nobody
-- abandons their existing tools for a generator — ad copy is the one thing
-- every AI writes for free.
--
-- THE ADVANTAGE URIVO HAS AND NOBODY ELSE DOES. Attribution is normally hard:
-- the ad platform owns the click, the shop owns the sale, and stitching them
-- together needs a pixel that iOS and ad blockers quietly break — Meta's own
-- reporting routinely loses a third of conversions this way. Urivo owns BOTH
-- ENDS in one database. The storefront that receives the click and the order
-- that closes the sale are two rows here. No pixel, no third party, no
-- guessing: the join is exact, server-side, and cannot be blocked.
--
-- Three pieces:
--   1. ad_creatives — a generated ad becomes a real object with an id, so
--      there is something to attribute TO.
--   2. store_visits gains the creative that sent the visitor.
--   3. orders gain the visit's session, which is what turns "this ad got
--      clicks" into "this ad made €258".
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. The ads themselves
-- ------------------------------------------------------------
create table if not exists public.ad_creatives (
    id          uuid primary key default gen_random_uuid(),
    store_id    uuid not null references public.stores (id) on delete cascade,
    -- Groups the 5–8 creatives produced by one "Generate ads" click, so a run
    -- can be compared against the run before it.
    run_id      uuid not null,
    platform    text not null,
    format      text not null default '',
    angle       text not null default '',
    headline    text not null,
    primary_text text not null default '',
    cta         text not null default '',
    -- Set when the merchant marks an ad as actually running. Ads that were
    -- generated and never used must not drag down the averages the next
    -- generation reads.
    launched_at timestamptz,
    archived_at timestamptz,
    created_at  timestamptz not null default now()
);

create index if not exists idx_ad_creatives_store on public.ad_creatives (store_id, created_at desc);
create index if not exists idx_ad_creatives_run on public.ad_creatives (run_id);

alter table public.ad_creatives enable row level security;

drop policy if exists "ad_creatives: owner read" on public.ad_creatives;
create policy "ad_creatives: owner read" on public.ad_creatives
    for select using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

drop policy if exists "ad_creatives: owner update" on public.ad_creatives;
create policy "ad_creatives: owner update" on public.ad_creatives
    for update using (
        exists (select 1 from public.stores s
                where s.id = ad_creatives.store_id and s.user_id = auth.uid())
    );

-- No insert policy: creatives are written by the generation route under
-- service_role, immediately after the model returns them. A client-written
-- creative would be an ad nobody generated, attributed to traffic nobody sent.

comment on table public.ad_creatives is
    'Generated ads, persisted so their traffic and revenue can be attributed back to them.';

-- ------------------------------------------------------------
-- 2. Which ad sent this visit
--
-- The link arrives as ?uc=<creative id> on the storefront URL. Stored as a
-- plain uuid with ON DELETE SET NULL: deleting an ad must never delete the
-- traffic history that proves what it did.
-- ------------------------------------------------------------
alter table public.store_visits
    add column if not exists creative_id uuid references public.ad_creatives (id) on delete set null,
    -- Free-text UTM campaign, for traffic Urivo did not generate the ad for
    -- (a merchant's own newsletter, an influencer link). Kept separate from
    -- creative_id so "our ads" and "everything else" never blur together.
    add column if not exists utm_campaign text,
    add column if not exists utm_source text;

create index if not exists idx_store_visits_creative
    on public.store_visits (creative_id, created_at desc)
    where creative_id is not null;

-- ------------------------------------------------------------
-- 3. Which visit became this order
--
-- The session hash is the same anonymous per-session id the visit beacon
-- already sends — no cookie, no PII, no new tracking. It is simply carried
-- through checkout so the sale can be joined back to the click.
--
-- first_touch_creative is denormalised onto the order deliberately: a visit
-- row can be pruned or a creative deleted, and the revenue attribution must
-- survive both. Reconstructing it later from a join that no longer resolves
-- is how attribution silently rots.
-- ------------------------------------------------------------
alter table public.orders
    add column if not exists session_hash text,
    add column if not exists creative_id uuid references public.ad_creatives (id) on delete set null;

create index if not exists idx_orders_creative
    on public.orders (creative_id)
    where creative_id is not null;

-- ------------------------------------------------------------
-- Performance per creative. THE function that closes the loop: what the
-- merchant sees, and what the next generation is told.
--
-- Clicks are distinct sessions, not raw pageviews — a visitor who reloads
-- four times is one click, and counting otherwise would make every ad look
-- four times better than it is.
-- ------------------------------------------------------------
create or replace function public.ad_performance(p_store_id uuid)
returns table (
    creative_id   uuid,
    run_id        uuid,
    platform      text,
    headline      text,
    angle         text,
    launched_at   timestamptz,
    clicks        integer,
    orders        integer,
    revenue_cents integer,
    created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select c.id,
           c.run_id,
           c.platform,
           c.headline,
           c.angle,
           c.launched_at,
           coalesce((
               select count(distinct v.session_hash)::integer
               from public.store_visits v
               where v.creative_id = c.id
           ), 0),
           coalesce((
               select count(*)::integer
               from public.orders o
               where o.creative_id = c.id and o.status in ('paid', 'fulfilled')
           ), 0),
           coalesce((
               select sum(o.amount_total)::integer
               from public.orders o
               where o.creative_id = c.id and o.status in ('paid', 'fulfilled')
           ), 0),
           c.created_at
    from public.ad_creatives c
    where c.store_id = p_store_id
      and c.archived_at is null
    order by c.created_at desc;
$$;

revoke execute on function public.ad_performance(uuid) from public, anon;
grant execute on function public.ad_performance(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- Attribute an order to the ad that earned it.
--
-- FIRST TOUCH, not last: the ad that introduced the brand is the one that did
-- the work, and last-touch would hand every sale to whatever retargeting ad
-- happened to be shown before checkout. Definer + service_role because it is
-- called from the Stripe webhook, which has no user session.
-- ------------------------------------------------------------
create or replace function public.attribute_order(p_order_id uuid, p_session_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_creative uuid;
    v_store    uuid;
begin
    if p_session_hash is null or length(btrim(p_session_hash)) < 6 then
        return null;
    end if;

    select store_id into v_store from public.orders where id = p_order_id;
    if v_store is null then
        return null;
    end if;

    -- The earliest visit in this session that carried a creative.
    select v.creative_id into v_creative
    from public.store_visits v
    where v.session_hash = p_session_hash
      and v.store_id = v_store
      and v.creative_id is not null
    order by v.created_at asc
    limit 1;

    update public.orders
    set session_hash = p_session_hash,
        creative_id  = v_creative
    where id = p_order_id;

    return v_creative;
end $$;

revoke execute on function public.attribute_order(uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_order(uuid, text) to service_role;

comment on function public.ad_performance(uuid) is
    'Clicks, orders and revenue per generated ad. Exact rather than pixel-based: Urivo owns both the click and the sale.';
