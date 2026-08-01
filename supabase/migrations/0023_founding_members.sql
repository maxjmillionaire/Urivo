-- ------------------------------------------------------------
-- 0023 — Founding members (first 50 get a lifetime price)
--
-- Launch mechanic: the first N signups (default 50) are "founding members" and
-- lock a lifetime price (Founder €29 / Pro €149) instead of the standard
-- €49 / €199. A SIGNUP burns a spot (not a payment) — the founder's decision —
-- so the price is reserved the moment an account is created and honoured
-- whenever that person subscribes. After the cap, new signups pay standard.
--
-- No public counter (deliberately — a ticking "spots left" widget cheapens a
-- premium brand); the founder tracks the cohort privately on the admin surface.
-- ------------------------------------------------------------

-- Cap + running count live on the single platform_settings row (0020).
alter table public.platform_settings
    add column if not exists founding_cap     integer not null default 50 check (founding_cap >= 0),
    add column if not exists founding_claimed integer not null default 0  check (founding_claimed >= 0);

-- Allow the new price tier tag.
alter table public.profiles drop constraint if exists profiles_price_type_check;
alter table public.profiles
    add constraint profiles_price_type_check
    check (price_type in ('standard', 'launch', 'creator', 'founding'));

-- Redefine signup provisioning to atomically claim a founding spot. Preserves
-- all of 0019's behaviour (profile + audit + verified-only welcome credits) and
-- adds the founding claim. The conditional UPDATE on the single settings row
-- serializes concurrent signups, so the cap can never be exceeded.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_founding boolean := false;
begin
    -- Claim a spot iff any remain (row lock on the one settings row = atomic).
    update public.platform_settings
       set founding_claimed = founding_claimed + 1, updated_at = now()
     where id = true and founding_claimed < founding_cap;
    if found then
        v_founding := true;
    end if;

    insert into public.profiles (id, email, full_name, price_type)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', null),
        case when v_founding then 'founding' else 'standard' end
    );

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (new.id, 'signup', 'profile', new.id::text);

    if new.email_confirmed_at is not null then
        perform public.grant_welcome_credits(new.id, new.email);
    end if;

    return new;
end;
$$;
