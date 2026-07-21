-- ------------------------------------------------------------
-- 0008 — Generic credit spend (server-authoritative)
--
-- Store generation has its own atomic RPC (generate_store_atomic). Every OTHER
-- AI action that costs credits — Ask Urivo messages, market research, ad plans,
-- product imagery — deducts through this one primitive, so the balance can
-- never go negative and the rule lives in exactly one place (spec 6.2 §14/§19).
--
-- Locks the profile row, verifies the balance, appends a negative ledger entry,
-- and returns the new balance. Raises INSUFFICIENT_CREDITS if the caller can't
-- afford the action. SECURITY DEFINER + revoked from client roles, so it is
-- only ever reachable from the service role in our API layer.
-- ------------------------------------------------------------

create or replace function public.spend_credits(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_source text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_balance integer;
begin
    if p_amount is null or p_amount <= 0 then
        raise exception 'INVALID_AMOUNT';
    end if;

    -- Serialize concurrent spends per user (row lock on the profile).
    perform 1 from public.profiles where id = p_user_id for update;

    v_balance := public.credit_balance(p_user_id);
    if v_balance < p_amount then
        raise exception 'INSUFFICIENT_CREDITS';
    end if;

    insert into public.credit_ledger (user_id, delta, reason, source)
    values (p_user_id, -p_amount, p_reason, coalesce(p_source, 'ai'));

    return v_balance - p_amount;
end;
$$;

-- Only the service role may spend credits (never the browser). Mirror the
-- pattern in 0002: revoke the default PUBLIC grant, then grant to service_role
-- explicitly (our API layer calls this with the service-role key). Without the
-- grant, every spend would fail with "permission denied for function".
revoke execute on function public.spend_credits(uuid, integer, text, text)
    from public, anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text, text)
    to service_role;

-- ------------------------------------------------------------
-- Widen the credit_ledger.source vocabulary for the new economy.
-- The original CHECK only allowed system/subscription/generation/admin/referral;
-- the credit-costs overhaul introduces per-action sources (ask, research, ads,
-- image), a generic 'ai' fallback, and 'credit_pack' for one-time top-ups.
-- Without this, every AI charge and every pack grant would fail the constraint.
-- ------------------------------------------------------------
alter table public.credit_ledger drop constraint if exists credit_ledger_source_check;
alter table public.credit_ledger add constraint credit_ledger_source_check
    check (source in (
        'system', 'subscription', 'generation', 'admin', 'referral',
        'ai', 'ask', 'research', 'ads', 'image', 'credit_pack'
    ));
