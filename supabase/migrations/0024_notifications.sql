-- ------------------------------------------------------------
-- 0024 — Merchant notifications (the nervous system)
--
-- Urivo captured order/visit/health DATA but never told the merchant when
-- anything HAPPENED — most glaringly, it never told them they made a SALE.
-- This is the event spine every future notification hangs on: a new order, a
-- first-sale milestone, a low credit balance, a refund, a chargeback, a store
-- going live — one durable, per-merchant feed the dashboard bell reads and
-- future channels (email, push) mirror.
--
-- Service-role only (RLS on, no policies): the app authorises the signed-in
-- user, then reads/writes their own rows through the service role with an
-- explicit user_id filter — the pattern used by the other operational tables.
-- ------------------------------------------------------------

create table public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    -- Event type: 'order', 'first_sale', 'milestone', 'credits_low',
    -- 'credits_expiring', 'refund', 'chargeback', 'payment_failed', 'store_live',
    -- 'system', … (open vocabulary; the UI maps kind → icon/colour).
    kind       text not null,
    title      text not null,
    body       text,
    -- Deep link into the product (e.g. /dashboard/stores/<id>/orders).
    href       text,
    severity   text not null default 'info' check (severity in ('info', 'success', 'warning', 'critical')),
    metadata   jsonb not null default '{}',
    read_at    timestamptz,
    created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications (user_id, created_at desc);
create index idx_notifications_unread on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
-- No policies → service-role only.
