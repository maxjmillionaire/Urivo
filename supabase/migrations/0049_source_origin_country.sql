-- Origin country on a product's supplier source.
--
-- The EU's €150 duty exemption ended on 1 July 2026. A parcel entering the EU
-- now carries a flat customs charge per line item — €3, rising to €5 once the
-- handling fee joins it on 1 November 2026 — and on the low-cost goods that
-- dropshipping runs on, that charge is not a rounding error, it is the margin.
-- An €8 product sold at €24 is 67% before duty and 46% after.
--
-- The dashboard computes each merchant's average margin as (price - cost)/price
-- straight from this table, so without knowing where the goods ship FROM it
-- cannot tell an EU-sourced product (no customs line at all) from an import.
-- It has therefore been reporting the pre-July number to every merchant.
--
-- Nullable on purpose, and null is NOT read as "domestic": lib/finance/
-- import-duty.ts treats unknown origin as an import, because under-stating cost
-- sells at a loss the merchant discovers after the ad spend, while over-stating
-- it costs a little volume. Those are not symmetric mistakes.

alter table public.product_sources
  add column if not exists ships_from_country text;

comment on column public.product_sources.ships_from_country is
  'ISO-3166-1 alpha-2 origin of the goods. Drives EU import duty in margin '
  'calculations (lib/finance/import-duty.ts). NULL = unknown, which is treated '
  'as a non-EU import rather than as domestic.';

-- Two characters, upper case, or nothing. A malformed code would silently fall
-- through the EU-membership check and be treated as an import, which is the
-- safe direction but hides the data problem rather than surfacing it.
alter table public.product_sources
  drop constraint if exists product_sources_ships_from_country_iso2;

alter table public.product_sources
  add constraint product_sources_ships_from_country_iso2
  check (ships_from_country is null or ships_from_country ~ '^[A-Z]{2}$');
