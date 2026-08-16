-- ------------------------------------------------------------
-- 0048 — A deleted founding member releases their spot
--
-- 0023 claims a Founding 50 spot when an account is created and nothing ever
-- gave one back. `founding_claimed` is a denormalised counter, so the moment a
-- founding account is deleted the counter and reality disagree — permanently,
-- and silently, because nothing reads the two against each other.
--
-- It had already happened. On the live database the counter stood at 10 while
-- exactly ONE profile carried price_type = 'founding': nine spots were held by
-- accounts that no longer existed, so the offer would have closed after 41 real
-- merchants instead of 50. Nobody would have noticed — the cap simply arrives
-- early, and the landing page correctly stops advertising a price it can no
-- longer honour.
--
-- The business rule does not change: exactly the first 50 eligible merchants
-- get launch pricing. This makes the counter able to say so truthfully.
--
-- Concurrency: the release is a conditional UPDATE on the SAME single settings
-- row the claim in 0023 locks, so a claim and a release can never interleave —
-- Postgres serialises them on that row. `greatest(..., 0)` keeps the counter
-- off the floor even if a spot is somehow released twice, which the table's
-- own `founding_claimed >= 0` check would otherwise turn into a failed delete.
-- ------------------------------------------------------------

create or replace function public.release_founding_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.platform_settings
       set founding_claimed = greatest(founding_claimed - 1, 0),
           updated_at = now()
     where id = true;
    return old;
end;
$$;

-- Row trigger with a WHEN clause: a non-founding delete never reaches the
-- function at all, so "deleting a standard account leaves the count alone" is a
-- structural property rather than a branch someone could later edit away.
--
-- AFTER DELETE, so the spot is only returned once the row is really gone. Fires
-- for a direct delete and for the cascade from auth.users, which is how an
-- account is actually removed.
drop trigger if exists trg_release_founding_slot on public.profiles;
create trigger trg_release_founding_slot
    after delete on public.profiles
    for each row
    when (old.price_type = 'founding')
    execute function public.release_founding_slot();

-- ------------------------------------------------------------
-- Reconcile the counter with reality, once.
--
-- The trigger prevents future drift; it cannot undo the drift already there.
-- Derived from the profiles table rather than written as a literal, so this is
-- correct on the live database, on a fresh provision from setup_all.sql (where
-- it evaluates to 0), and on any restored copy.
-- ------------------------------------------------------------
update public.platform_settings
   set founding_claimed = least(
           (select count(*) from public.profiles where price_type = 'founding'),
           founding_cap
       ),
       updated_at = now()
 where id = true;
