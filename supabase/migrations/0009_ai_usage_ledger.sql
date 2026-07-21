-- ------------------------------------------------------------
-- 0009 — AI usage ledger (real per-action cost, not estimates)
--
-- The credit_ledger records what a user was CHARGED (credits). This table
-- records what an action actually COST US: the real input/output tokens off the
-- provider response, the images generated, and the money that translates to.
-- Together they answer, exactly, "this user cost us €4.82 this month" and "this
-- feature earns/loses margin" — the foundation of the finance system.
--
-- Append-only, one row per AI action. Written by the API layer (service role)
-- via lib/finance/ledger.ts. Costs are stored in USD (provider-native) so a
-- later FX revision never corrupts history; EUR is derived at read time.
-- ------------------------------------------------------------

create table public.ai_usage_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    -- Which product surface produced the spend.
    feature text not null check (feature in (
        'storeGeneration', 'askMessage', 'storeEdit',
        'marketResearch', 'adStudio', 'productImage'
    )),
    -- What the user was charged for it (mirror of the credit_ledger delta).
    credits integer not null default 0 check (credits >= 0),
    -- Real provider usage.
    input_tokens integer not null default 0 check (input_tokens >= 0),
    output_tokens integer not null default 0 check (output_tokens >= 0),
    images integer not null default 0 check (images >= 0),
    model text,
    -- Real money (USD, provider-native). Derived from usage × price at write time
    -- so the number is fixed even if list prices later change.
    anthropic_cost_usd numeric(12, 6) not null default 0 check (anthropic_cost_usd >= 0),
    image_cost_usd numeric(12, 6) not null default 0 check (image_cost_usd >= 0),
    total_cost_usd numeric(12, 6) not null default 0 check (total_cost_usd >= 0),
    -- Correlates with application logs / captureException for tracing.
    request_id text,
    created_at timestamptz not null default now()
);

-- Per-user rollups ("what did this user cost us this month") and per-feature
-- rollups ("which feature costs most") are the two hot query shapes.
create index idx_ai_usage_user on public.ai_usage_ledger (user_id, created_at desc);
create index idx_ai_usage_feature on public.ai_usage_ledger (feature, created_at desc);

alter table public.ai_usage_ledger enable row level security;

-- A user may read their OWN cost history (transparency); no client may write it —
-- inserts happen only through the service role in the API layer, same trust
-- model as credit_ledger.
create policy "ai_usage_ledger: own read" on public.ai_usage_ledger
    for select using (user_id = auth.uid());
