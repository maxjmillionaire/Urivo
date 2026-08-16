-- ------------------------------------------------------------
-- 0044 — Click-event retention (specifications/10-attribution.md §11)
--
-- A retention period that exists only in a document is not a retention period.
--
-- 0039 shipped expire_click_events as a bare DELETE. It was never scheduled,
-- so nothing was ever deleted, and it deleted indiscriminately — which matters
-- more than it sounds:
--
--   A visit still referenced by an order is EVIDENCE. orders.creative_id is
--   denormalised so revenue attribution survives, but the visit row is the
--   record of how that decision was reached. Deleting it while the order still
--   points at the ad leaves an attribution nobody can audit — and for a refund
--   dispute or a tax question, "the system says so" is not an answer.
--
-- So retention is selective: visits are deleted once they are past the window
-- AND no order depends on them. Everything else is kept and counted, so the
-- job can report what it declined to remove rather than staying silent.
-- ------------------------------------------------------------

create or replace function public.expire_click_events(p_days integer default 90)
returns table (deleted integer, retained_for_orders integer, cutoff timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cutoff  timestamptz := now() - make_interval(days => greatest(p_days, 1));
    v_deleted integer := 0;
    v_kept    integer := 0;
begin
    /*
     * Kept despite being old: the session is named by an order, so this row is
     * the audit trail for a financial record. Counted first so the number is
     * reported even when nothing is deleted.
     */
    select count(*)::integer into v_kept
      from public.store_visits v
     where v.created_at < v_cutoff
       and exists (
           select 1 from public.orders o
            where o.session_hash = v.session_hash
              and o.store_id     = v.store_id
       );

    delete from public.store_visits v
     where v.created_at < v_cutoff
       and not exists (
           select 1 from public.orders o
            where o.session_hash = v.session_hash
              and o.store_id     = v.store_id
       );
    get diagnostics v_deleted = row_count;

    /*
     * Idempotent by construction: the predicate is a property of the rows, not
     * of a cursor or a run log. A second run in the same minute deletes nothing
     * because nothing matches any more.
     */
    return query select v_deleted, v_kept, v_cutoff;
end $$;

revoke execute on function public.expire_click_events(integer) from public, anon, authenticated;
grant execute on function public.expire_click_events(integer) to service_role;

comment on function public.expire_click_events(integer) is
    'Deletes click events past the retention window, except those still referenced by an order. Idempotent; returns what it removed and what it kept.';

-- The old zero-argument form would otherwise linger and shadow the new one.
drop function if exists public.expire_click_events();
