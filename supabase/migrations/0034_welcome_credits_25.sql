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
