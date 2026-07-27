-- ------------------------------------------------------------
-- 0019 — Signup guardrails (free-tier cost control, part 1)
--
-- THE RISK: the 20 welcome credits (0010) were granted by handle_new_user on
-- INSERT into auth.users — i.e. the instant an account row exists, BEFORE the
-- email is confirmed. A store generation costs exactly 20 credits, so every
-- unverified signup converted directly into one full generation (two large
-- model calls + a catalogue + product images) with no payment on file. One
-- viral moment could mean tens of thousands of free generations and zero
-- revenue — the viral scenario and the insolvency scenario were the same event.
--
-- THIS MIGRATION closes the door in the database (the authoritative place):
--   1. Welcome credits are granted only once the email is CONFIRMED (or at
--      creation for already-verified OAuth signups) — never for an unconfirmed
--      account.
--   2. Disposable / abuse email domains receive NO welcome credits at all.
--
-- Credits are never mutated or deleted here; the grant simply doesn't happen
-- until the account earns it. Existing users are unaffected.
-- ------------------------------------------------------------

-- ── Disposable-domain blocklist ────────────────────────────────────────────
-- Data-driven so the founder can extend it without a deploy (service-role only:
-- RLS on, no policies, exactly like stripe_webhook_events / reserved_subdomains).
create table if not exists public.blocked_email_domains (
    domain     text primary key,           -- lowercased host, no '@'
    reason     text,
    created_at timestamptz not null default now()
);

alter table public.blocked_email_domains enable row level security;

-- A pragmatic starter set of well-known disposable providers. Extend at runtime.
insert into public.blocked_email_domains (domain, reason) values
    ('mailinator.com', 'disposable'),
    ('guerrillamail.com', 'disposable'),
    ('guerrillamail.info', 'disposable'),
    ('sharklasers.com', 'disposable'),
    ('grr.la', 'disposable'),
    ('10minutemail.com', 'disposable'),
    ('10minutemail.net', 'disposable'),
    ('temp-mail.org', 'disposable'),
    ('tempmail.com', 'disposable'),
    ('tempmailo.com', 'disposable'),
    ('throwawaymail.com', 'disposable'),
    ('getnada.com', 'disposable'),
    ('maildrop.cc', 'disposable'),
    ('mohmal.com', 'disposable'),
    ('yopmail.com', 'disposable'),
    ('yopmail.net', 'disposable'),
    ('dispostable.com', 'disposable'),
    ('trashmail.com', 'disposable'),
    ('trashmail.de', 'disposable'),
    ('fakeinbox.com', 'disposable'),
    ('mailnesia.com', 'disposable'),
    ('mintemail.com', 'disposable'),
    ('spamgourmet.com', 'disposable'),
    ('mailcatch.com', 'disposable'),
    ('emailondeck.com', 'disposable'),
    ('tempinbox.com', 'disposable'),
    ('moakt.com', 'disposable'),
    ('luxusmail.org', 'disposable'),
    ('mailpoof.com', 'disposable'),
    ('inboxkitten.com', 'disposable'),
    ('temp-mail.io', 'disposable'),
    ('burnermail.io', 'disposable'),
    ('33mail.com', 'disposable'),
    ('anonaddy.com', 'disposable'),
    ('mailinator.net', 'disposable'),
    ('discard.email', 'disposable'),
    ('einrot.com', 'disposable'),
    ('spam4.me', 'disposable'),
    ('tmail.ws', 'disposable'),
    ('vomoto.com', 'disposable')
on conflict (domain) do nothing;

-- Is this email's domain on the blocklist? (case-insensitive on the host part)
create or replace function public.is_email_domain_blocked(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.blocked_email_domains
        where domain = lower(split_part(coalesce(p_email, ''), '@', 2))
    );
$$;

-- ── One-time welcome grant ─────────────────────────────────────────────────
-- Grants the 20 welcome credits at most once per user, and never for a blocked
-- domain. Idempotent: the ledger reason is the guard, so a re-run is a no-op.
create or replace function public.grant_welcome_credits(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.is_email_domain_blocked(p_email) then
        -- Disposable address → no free generation. Recorded for visibility.
        insert into public.audit_logs (user_id, action, resource, resource_id)
        values (p_user_id, 'welcome_credits_withheld', 'profile', p_user_id::text);
        return;
    end if;

    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and reason = 'Free tier welcome credits'
    ) then
        return; -- already granted
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, 20, 'Free tier welcome credits', 'system');
end;
$$;

-- ── Rework signup provisioning ─────────────────────────────────────────────
-- Profile + audit still happen on INSERT (the app needs the profile row), but
-- credits are now granted ONLY when the account is already verified at creation
-- (OAuth, or a project with email-confirmation disabled). Unconfirmed
-- email/password signups get their credits later, from the confirmation trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, full_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', null)
    );

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (new.id, 'signup', 'profile', new.id::text);

    if new.email_confirmed_at is not null then
        perform public.grant_welcome_credits(new.id, new.email);
    end if;

    return new;
end;
$$;

-- Grant on confirmation: fires when email_confirmed_at goes null → not-null.
create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.email_confirmed_at is null and new.email_confirmed_at is not null then
        perform public.grant_welcome_credits(new.id, new.email);
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
    after update on auth.users
    for each row execute function public.handle_user_confirmed();
