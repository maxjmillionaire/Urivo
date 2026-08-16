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
