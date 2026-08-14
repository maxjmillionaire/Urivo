-- How long an AI action actually took.
--
-- The landing page tells every visitor that Urivo generates a storefront "in
-- under a minute". Nothing in this codebase measures that, and nothing ever
-- has — so the claim could not be verified before it was made, and could not
-- be checked afterwards either. A performance promise on the page a customer
-- buys from is a statement of fact; it needs a number behind it.
--
-- The ledger already records what each action cost in tokens, images and
-- money. Wall-clock duration belongs in the same row: it is measured at the
-- same moment, by the same code, about the same action, and it makes the
-- marketing claim answerable with a query rather than an opinion.
--
-- Nullable, because rows written before this migration have no duration and
-- guessing one would be worse than admitting the gap.

alter table public.ai_usage_ledger
  add column if not exists duration_ms integer
    check (duration_ms is null or duration_ms >= 0);

comment on column public.ai_usage_ledger.duration_ms is
  'Wall-clock milliseconds the action took end to end, including image '
  'generation. NULL for rows written before migration 0051. This is the column '
  'that answers whether "in under a minute" is true.';

-- Answering the question is one query, so it lives here rather than in a
-- README where it would go stale:
--
--   select
--     percentile_cont(0.5) within group (order by duration_ms) / 1000.0 as p50_s,
--     percentile_cont(0.95) within group (order by duration_ms) / 1000.0 as p95_s,
--     count(*)
--   from public.ai_usage_ledger
--   where feature = 'storeGeneration' and duration_ms is not null;
