-- GPSR product safety information (Regulation (EU) 2023/988).
--
-- The General Product Safety Regulation has applied since 13 December 2024, and
-- 2026 is its enforcement year: Safety Gate recorded 4,671 alerts in 2025, the
-- highest ever and 13% up on the year before, and market surveillance
-- authorities now have the powers to order a listing taken down.
--
-- Article 19 requires every distance-selling offer — which is what a generated
-- Urivo storefront is — to show, before the sale:
--
--   * the manufacturer's name, postal address and electronic address
--   * for goods made outside the EU, the EU "responsible person" and theirs
--   * the product's identifying details (type, batch or serial)
--   * any warnings or safety information
--
-- Urivo generates listings, so it generates the surface these belong on. The
-- fields are nullable because Urivo cannot invent them: a merchant who does not
-- know their manufacturer's registered address must be shown that the listing is
-- incomplete, not handed a plausible-looking address the AI made up. That is the
-- same rule the storefront already applies to shipping terms and eco claims —
-- the platform never authors a statement the merchant is legally bound by.
--
-- Every column here is the merchant's own content and none decides entitlement,
-- capacity or money, so the products grants are left as migration 0045 set them.

alter table public.products
  add column if not exists manufacturer_name text,
  add column if not exists manufacturer_address text,
  add column if not exists manufacturer_email text,
  add column if not exists eu_responsible_name text,
  add column if not exists eu_responsible_address text,
  add column if not exists eu_responsible_email text,
  add column if not exists product_identifier text,
  add column if not exists safety_warnings text;

comment on column public.products.manufacturer_name is
  'GPSR Art. 19: manufacturer name or registered trademark. NULL = the merchant '
  'has not supplied it; the listing is incomplete and says so.';
comment on column public.products.eu_responsible_name is
  'GPSR Art. 16: the EU-established responsible person, required when the '
  'manufacturer is outside the EU. NULL is only correct for EU-made goods.';
comment on column public.products.product_identifier is
  'GPSR Art. 19: type, batch or serial number identifying the specific product.';
comment on column public.products.safety_warnings is
  'GPSR Art. 19: warnings and safety information shown before purchase.';

-- Length ceilings only. No format checks and no NOT NULL: a constraint that
-- rejects a merchant's real, oddly-formatted manufacturer address would push
-- them to type something false, which is worse than an empty field.
alter table public.products
  drop constraint if exists products_gpsr_lengths;

alter table public.products
  add constraint products_gpsr_lengths check (
    coalesce(char_length(manufacturer_name), 0) <= 200
    and coalesce(char_length(manufacturer_address), 0) <= 500
    and coalesce(char_length(manufacturer_email), 0) <= 320
    and coalesce(char_length(eu_responsible_name), 0) <= 200
    and coalesce(char_length(eu_responsible_address), 0) <= 500
    and coalesce(char_length(eu_responsible_email), 0) <= 320
    and coalesce(char_length(product_identifier), 0) <= 140
    and coalesce(char_length(safety_warnings), 0) <= 2000
  );
