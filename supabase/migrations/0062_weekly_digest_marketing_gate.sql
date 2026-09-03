-- Weekly digest is marketing: gate it on consent and give it a working
-- one-click unsubscribe.
--
-- The weekly digest is a product-engagement (marketing) email — it nudges
-- publishing and top-ups. So it must (a) only reach users who opted in, and
-- (b) carry a real unsubscribe that turns marketing consent off. This does NOT
-- touch transactional/service email (welcome, order, payment, subscription,
-- security), which is sent on the basis of the contract and never gated here.

-- 1. Per-user unsubscribe token — the credential in the digest footer link. A
--    per-row uuid so the link is not guessable; each existing row is backfilled
--    with its own distinct token (gen_random_uuid() is volatile).
alter table public.profiles
    add column if not exists marketing_unsub_token uuid not null default gen_random_uuid();

-- 2. One-click marketing unsubscribe — public, definer, idempotent. Sets
--    marketing_opt_in = false by token and returns only a boolean, so it is not
--    an address oracle. No SELECT on profiles is granted to anon — only this.
create or replace function public.unsubscribe_marketing_by_token(p_token uuid)
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

    update public.profiles
       set marketing_opt_in = false
     where marketing_unsub_token = p_token
    returning true into v_found;

    return coalesce(v_found, false);
end $$;

revoke execute on function public.unsubscribe_marketing_by_token(uuid) from public;
grant execute on function public.unsubscribe_marketing_by_token(uuid) to anon, authenticated, service_role;

comment on function public.unsubscribe_marketing_by_token(uuid) is
    'One-click unsubscribe from Urivo marketing email (the weekly digest). Sets '
    'profiles.marketing_opt_in = false by token. Idempotent, definer, '
    'anon-executable, boolean-only (no oracle) (0062).';

-- 3. Digest recipients: only opted-in users, and expose the token so the runner
--    can build each recipient's unsubscribe link. The return type gains a
--    column, so the function is dropped and recreated (create-or-replace cannot
--    change a function's OUT columns). Body is otherwise unchanged from 0025
--    except the added token column and the `p.marketing_opt_in` filter.
drop function if exists public.weekly_digest_data();
create function public.weekly_digest_data()
returns table (
    user_id uuid,
    email text,
    full_name text,
    marketing_unsub_token uuid,
    credit_balance integer,
    credits_expiring_amount integer,
    credits_expiring_at timestamptz,
    stores_total integer,
    stores_live integer,
    stores_new integer,
    products_total integer,
    orders_week integer,
    revenue_week_cents bigint,
    orders_total integer,
    revenue_total_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with since as (select now() - interval '7 days' as ts)
    select
        p.id                                             as user_id,
        p.email,
        p.full_name,
        p.marketing_unsub_token                          as marketing_unsub_token,
        public.credit_balance(p.id)                      as credit_balance,
        coalesce(ce.amount, 0)                           as credits_expiring_amount,
        ce.expires_at                                    as credits_expiring_at,
        s.stores_total,
        s.stores_live,
        s.stores_new,
        coalesce(pr.products_total, 0)                   as products_total,
        coalesce(o.orders_week, 0)                       as orders_week,
        coalesce(o.revenue_week_cents, 0)                as revenue_week_cents,
        coalesce(o.orders_total, 0)                      as orders_total,
        coalesce(o.revenue_total_cents, 0)               as revenue_total_cents
    from public.profiles p
    -- Consent gate: the digest is marketing, so opted-out users are excluded
    -- entirely (no email and no in-app digest notification).
    join lateral (
        select
            count(*)::int                                                   as stores_total,
            count(*) filter (where st.is_active)::int                       as stores_live,
            count(*) filter (where st.created_at >= (select ts from since))::int as stores_new
        from public.stores st
        where st.user_id = p.id
    ) s on s.stores_total > 0
    left join lateral (
        select count(*)::int as products_total
        from public.products prd
        join public.stores st2 on st2.id = prd.store_id
        where st2.user_id = p.id
    ) pr on true
    left join lateral (
        select
            count(*) filter (
                where ord.status in ('paid', 'fulfilled')
                  and ord.created_at >= (select ts from since)
            )::int as orders_week,
            coalesce(sum(ord.amount_total) filter (
                where ord.status in ('paid', 'fulfilled')
                  and ord.created_at >= (select ts from since)
            ), 0)::bigint as revenue_week_cents,
            count(*) filter (
                where ord.status in ('paid', 'fulfilled')
            )::int as orders_total,
            coalesce(sum(ord.amount_total) filter (
                where ord.status in ('paid', 'fulfilled')
            ), 0)::bigint as revenue_total_cents
        from public.orders ord
        join public.stores st3 on st3.id = ord.store_id
        where st3.user_id = p.id
    ) o on true
    left join lateral (
        select amount, expires_at
        from public.credit_expiry_summary(p.id)
        limit 1
    ) ce on true
    where p.marketing_opt_in
    order by revenue_week_cents desc, stores_total desc;
$$;

revoke execute on function public.weekly_digest_data() from public, anon, authenticated;
grant execute on function public.weekly_digest_data() to service_role;
