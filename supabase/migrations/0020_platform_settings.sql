-- ------------------------------------------------------------
-- 0020 — Platform settings (free-tier cost control, part 2)
--
-- A single-row, server-authoritative control panel the founder can change
-- WITHOUT a deploy — the levers you reach for at 3am when inference spend is
-- running away:
--
--   * free_generations_enabled   — the KILL SWITCH. When false, free accounts
--                                  cannot generate; paying accounts are never
--                                  affected. Independent of any daily cap.
--   * free_daily_generation_cap  — optional global ceiling on free generations
--                                  per 24h (0 = no cap). The number is a founder
--                                  decision; the column exists so it can be set
--                                  from the admin UI later without a migration.
--   * daily_free_spend_alert_usd — threshold for the spend-alert email.
--   * spend_alert_last_sent_on   — idempotency so the alert fires at most once
--                                  per day.
--
-- Service-role only (RLS on, no policies), like the other operational tables.
-- ------------------------------------------------------------

create table if not exists public.platform_settings (
    -- Single-row guarantee: the PK can only ever be true.
    id                          boolean primary key default true check (id),
    free_generations_enabled    boolean not null default true,
    free_daily_generation_cap   integer not null default 0 check (free_daily_generation_cap >= 0),
    daily_free_spend_alert_usd  numeric(10, 2) not null default 50 check (daily_free_spend_alert_usd >= 0),
    spend_alert_last_sent_on    date,
    updated_at                  timestamptz not null default now()
);

-- Seed the single row.
insert into public.platform_settings (id) values (true)
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
-- No policies → readable/writable only by the service role.

-- ── Daily inference spend, split by account type ───────────────────────────
-- Feeds the spend-alert (2.5). Free-account spend is the number that can run
-- away with no revenue behind it; paid spend is expected cost of goods — the
-- two are reported separately because only one of them is a problem.
create or replace function public.platform_daily_spend(p_day date)
returns table (free_usd numeric, paid_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
    select
        coalesce(sum(u.total_cost_usd) filter (where p.plan = 'free'), 0)::numeric  as free_usd,
        coalesce(sum(u.total_cost_usd) filter (where p.plan <> 'free'), 0)::numeric as paid_usd
    from public.ai_usage_ledger u
    join public.profiles p on p.id = u.user_id
    where u.created_at >= p_day::timestamptz
      and u.created_at <  (p_day + 1)::timestamptz;
$$;

revoke execute on function public.platform_daily_spend(date) from public, anon, authenticated;
grant execute on function public.platform_daily_spend(date) to service_role;
