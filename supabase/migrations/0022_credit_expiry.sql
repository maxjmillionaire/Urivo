-- ------------------------------------------------------------
-- 0022 — Credit expiry (monthly plan credits are use-it-or-lose-it)
--
-- THE RISK: monthly subscription credits never expired, so unspent credits
-- rolled over forever — an unbounded liability a user could cash in during the
-- worst possible month. Policy: PLAN (monthly) credits expire at the end of the
-- billing period they were granted for; PURCHASED (pack) credits, welcome
-- credits, referral and admin grants NEVER expire.
--
-- Implementation is append-only and non-destructive: no row is ever mutated or
-- deleted. Grants simply carry an `expires_at`; the balance is derived FIFO so
-- that spends consume the SOONEST-expiring credits first (user-favourable — you
-- spend plan credits before they lapse, and your permanent credits are the last
-- to be touched). An expired lot's unspent remainder is dropped from the
-- balance by the derivation. Backward-compatible: with no expires_at anywhere,
-- the FIFO result is exactly sum(delta), so existing balances are unchanged.
-- ------------------------------------------------------------

alter table public.credit_ledger
    add column if not exists expires_at timestamptz;

-- Balance, expiry-aware. Both spenders (spend_credits, generate_store_atomic)
-- call this, so display and spending share one authoritative definition.
create or replace function public.credit_balance(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    with
    spent as (
        select coalesce(sum(-delta), 0)::bigint as total
        from public.credit_ledger
        where user_id = p_user_id and delta < 0
    ),
    lots as (
        -- Positive entries are grant "lots". Order so spends are attributed to
        -- the soonest-expiring lot first; permanent lots (null) are consumed last.
        select
            delta::bigint as amount,
            expires_at,
            coalesce(sum(delta) over (
                order by (expires_at is null), expires_at, created_at, id
                rows between unbounded preceding and 1 preceding
            ), 0)::bigint as prev_cum
        from public.credit_ledger
        where user_id = p_user_id and delta > 0
    )
    select coalesce(sum(
        case
            -- Expired lot: whatever the FIFO spend didn't consume is forfeited.
            when l.expires_at is not null and l.expires_at <= now() then 0
            -- Otherwise: this lot's amount minus the share of spend that reached it.
            else greatest(0, l.amount - greatest(0, s.total - l.prev_cum))
        end
    ), 0)::integer
    from lots l cross join spent s;
$$;

-- Soonest upcoming expiry + how many credits expire (for honest UI surfacing).
create or replace function public.credit_expiry_summary(p_user_id uuid)
returns table (amount integer, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    with
    spent as (
        select coalesce(sum(-delta), 0)::bigint as total
        from public.credit_ledger
        where user_id = p_user_id and delta < 0
    ),
    lots as (
        select
            delta::bigint as amount,
            expires_at,
            coalesce(sum(delta) over (
                order by (expires_at is null), expires_at, created_at, id
                rows between unbounded preceding and 1 preceding
            ), 0)::bigint as prev_cum
        from public.credit_ledger
        where user_id = p_user_id and delta > 0
    ),
    remaining as (
        select
            l.expires_at,
            greatest(0, l.amount - greatest(0, s.total - l.prev_cum)) as rem
        from lots l cross join spent s
        where l.expires_at is not null and l.expires_at > now()
    )
    select sum(rem)::integer as amount, min(expires_at) as expires_at
    from remaining
    having sum(rem) > 0;
$$;

revoke execute on function public.credit_expiry_summary(uuid) from public, anon, authenticated;
grant execute on function public.credit_expiry_summary(uuid) to service_role;
