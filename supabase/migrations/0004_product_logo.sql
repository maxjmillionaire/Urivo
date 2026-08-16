-- ============================================================
-- 0004 — Brand logo overlay
-- Per-product toggle for the store's logo overlay. The logo itself (URL +
-- placement/size/opacity) lives in stores.theme_config.logo; logo files reuse
-- the existing public product-images bucket under a logos/ prefix.
-- ============================================================

alter table public.products
    add column if not exists show_logo boolean not null default true;
