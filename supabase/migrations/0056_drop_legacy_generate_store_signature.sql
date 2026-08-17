-- Remove the six-argument `generate_store_atomic`, because two signatures make
-- the call ambiguous — and 0055 asserted the opposite.
--
-- WHAT 0055 CLAIMED
--
-- 0055 added `p_is_active boolean default false` and reasoned, in its own
-- header: "A defaulted parameter keeps the old six-argument call resolvable, so
-- an application that has not deployed yet still works."
--
-- That is wrong, and it is wrong in the worst possible direction: 0055 used
-- `create or replace function` with an extra parameter, which does not replace
-- anything. It creates a SECOND function. The six-argument form from 0003 is
-- still there beside it, and PostgreSQL then has two applicable candidates for
-- a six-argument call — the exact one, and the seven-argument one with its
-- default filled in. It refuses to choose:
--
--   ERROR:  function generate_store_atomic(uuid, text, text, jsonb, jsonb,
--           integer) is not unique                       (SQLSTATE 42725)
--
-- Verified against a real PostgreSQL, not reasoned about: two functions of the
-- same name, the second differing only by a defaulted trailing parameter, and
-- the narrower call raises 42725 both positionally and with named arguments.
-- Dropping the narrow signature makes the same call resolve to the wide
-- function with its default, which is what 0055 believed was happening.
--
-- WHY THIS IS URGENT RATHER THAN TIDY
--
-- 0055 is applied. The application deployed against it still calls the RPC with
-- six named arguments, so store generation — the product's first action — is
-- resolving against an ambiguity. This migration repairs it on its own, with no
-- deploy: afterwards the six-argument call lands on the seven-argument function
-- and creates the store unpublished, and a paid merchant publishes with one
-- click. Then the application deploy passes the seventh argument and the
-- publish decision is carried explicitly again.
--
-- Safe in both directions, which is the property that was missing:
--   • old application (6 named args) → wide function, p_is_active := false
--   • new application (7 named args) → wide function, p_is_active := the plan
--
-- THE LESSON, WRITTEN DOWN WHERE THE NEXT PERSON WILL LOOK
--
-- `create or replace function` replaces a function only when the argument types
-- match exactly. Adding a parameter — defaulted or not — is a new function and
-- an overload set. This is the second time a migration in this repository has
-- shipped a premise about PostgreSQL's behaviour that was never executed
-- against PostgreSQL (0052 asserted that policy subqueries need only column
-- privileges; 0053 repaired it). lib/sql-overloads.test.ts now fails the build
-- if any function in this directory is left with more than one live signature,
-- so the class of mistake cannot ship a third time.

drop function if exists public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer);

-- Re-state the grants on the surviving signature. Dropping a sibling does not
-- touch them; this is here so a reader of this file can see, without opening
-- 0055, exactly who may execute the only remaining form.
revoke execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.generate_store_atomic(uuid, text, text, jsonb, jsonb, integer, boolean) to service_role;

-- Proof, executable: exactly one signature must remain, and it must be the one
-- that takes the publish entitlement. This raises rather than returning, so
-- applying the migration is itself the assertion.
do $$
declare
    v_count integer;
    v_args  text;
begin
    select count(*), string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
      into v_count, v_args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'generate_store_atomic';

    if v_count <> 1 then
        raise exception 'generate_store_atomic must have exactly one signature, found %: %',
            v_count, v_args;
    end if;

    if v_args not like '%p_is_active boolean%' then
        raise exception 'the surviving generate_store_atomic does not take p_is_active: %', v_args;
    end if;
end $$;
