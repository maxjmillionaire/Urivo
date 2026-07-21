-- ------------------------------------------------------------
-- 0010 — Free-tier welcome credits: 15 → 20
--
-- Signup credits are granted by the handle_new_user trigger (migration 0001),
-- not from application code, so the plan-config change in lib/plans.ts must be
-- mirrored here or new signups would still receive 15. Redefine the function so
-- every user created from now on gets 20 (Free = 2 stores). Existing users are
-- unaffected; their balance is historical and correct.
--
-- Everything else in the function is preserved verbatim from 0001 — only the
-- welcome-credit amount changes.
-- ------------------------------------------------------------

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

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (new.id, 20, 'Free tier welcome credits', 'system');

    insert into public.audit_logs (user_id, action, resource, resource_id)
    values (new.id, 'signup', 'profile', new.id::text);

    return new;
end;
$$;
