-- ------------------------------------------------------------
-- 0028 — Creator payouts (closing the commission loop)
--
-- 0012 could record that a commission was OWED and that an individual referral
-- had been paid, but nothing could answer "what do I owe this creator right
-- now" or record the actual transfer. Commissions accumulated with no way to
-- settle them, which is the half of the growth engine that keeps a
-- distribution partner willing to keep promoting.
--
-- A payout is one real transfer to one creator, settling N referrals at once.
-- Each referral points back at the payout that settled it, so every euro is
-- traceable in both directions.
-- ------------------------------------------------------------

create table if not exists public.creator_payouts (
    id uuid primary key default gen_random_uuid(),
    creator_id uuid not null references public.creators (id) on delete cascade,
    amount_eur numeric(10, 2) not null check (amount_eur >= 0),
    referral_count integer not null check (referral_count > 0),
    -- How it was actually sent. Free text on purpose: this records reality,
    -- it does not move money.
    method text,
    -- Bank/PayPal reference so a creator query can be answered in one lookup.
    reference text,
    note text,
    paid_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists idx_creator_payouts_creator
    on public.creator_payouts (creator_id, paid_at desc);

-- Which payout settled each commission.
alter table public.referrals
    add column if not exists payout_id uuid references public.creator_payouts (id) on delete set null;

create index if not exists idx_referrals_payout on public.referrals (payout_id);

alter table public.creator_payouts enable row level security;
-- No policies: admin-only, reached through the service role.

-- ------------------------------------------------------------
-- What is owed, per creator, right now.
-- ------------------------------------------------------------
create or replace function public.creator_payout_summary()
returns table (
    creator_id uuid,
    creator_name text,
    creator_code text,
    owed_count integer,
    owed_eur numeric,
    paid_eur numeric,
    last_paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select
        c.id,
        c.name,
        c.code,
        count(r.id) filter (where r.commission_status = 'owed')::int      as owed_count,
        coalesce(sum(r.commission_amount_eur)
                 filter (where r.commission_status = 'owed'), 0)          as owed_eur,
        coalesce(sum(r.commission_amount_eur)
                 filter (where r.commission_status = 'paid'), 0)          as paid_eur,
        (select max(p.paid_at) from public.creator_payouts p where p.creator_id = c.id)
                                                                          as last_paid_at
    from public.creators c
    left join public.referrals r on r.creator_id = c.id
    group by c.id, c.name, c.code
    order by owed_eur desc, c.name;
$$;

revoke execute on function public.creator_payout_summary() from public, anon, authenticated;
grant execute on function public.creator_payout_summary() to service_role;

-- ------------------------------------------------------------
-- Settle everything currently owed to one creator, atomically.
--
-- Locks the owed rows first so two admins clicking at once cannot pay the same
-- commission twice — the amount is computed from the locked set, never from a
-- number the caller supplied.
-- ------------------------------------------------------------
create or replace function public.pay_out_creator(
    p_creator_id uuid,
    p_method text default null,
    p_reference text default null,
    p_note text default null
)
returns table (
    payout_id uuid,
    amount_eur numeric,
    referral_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ids uuid[];
    v_amount numeric;
    v_count integer;
    v_payout uuid;
begin
    select array_agg(id), coalesce(sum(commission_amount_eur), 0), count(*)
      into v_ids, v_amount, v_count
    from (
        select id, commission_amount_eur
        from public.referrals
        where creator_id = p_creator_id
          and commission_status = 'owed'
          and commission_paid = false
        for update
    ) owed;

    if v_count is null or v_count = 0 then
        raise exception 'NOTHING_OWED';
    end if;

    insert into public.creator_payouts (creator_id, amount_eur, referral_count, method, reference, note)
    values (p_creator_id, v_amount, v_count, p_method, p_reference, p_note)
    returning id into v_payout;

    update public.referrals
    set commission_status = 'paid',
        commission_paid = true,
        commission_paid_at = now(),
        payout_id = v_payout
    where id = any(v_ids);

    return query select v_payout, v_amount, v_count;
end $$;

revoke execute on function public.pay_out_creator(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pay_out_creator(uuid, text, text, text) to service_role;
