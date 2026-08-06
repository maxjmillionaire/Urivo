-- ------------------------------------------------------------
-- 0032 — Image provenance
--
-- From 2 August 2026, Article 50 of the EU AI Act requires AI-generated
-- content to be disclosed. Urivo generates product photography, so its stores
-- carry that obligation — and the merchant, not Urivo, is the one publishing.
--
-- The obligation cannot be met with a blanket notice. A merchant who replaced
-- our imagery with their own photographs would then be declaring real work to
-- be synthetic, which is a false statement in the other direction and hands a
-- competitor an easy complaint. So provenance is recorded PER IMAGE, at the
-- moment the image is set, and the storefront discloses only what is true.
-- ------------------------------------------------------------

alter table public.products
    add column if not exists image_source text
        check (image_source is null or image_source in ('ai', 'uploaded', 'supplier', 'placeholder'));

comment on column public.products.image_source is
    'Where image_url came from. Drives the AI disclosure on the storefront (EU AI Act Art. 50). NULL = unknown provenance, disclosed conservatively.';

-- Backfill. Every image Urivo has produced so far came out of the generation
-- pipeline and lives in our own storage bucket; anything else is unknown and
-- stays NULL, which the storefront treats conservatively rather than silently
-- claiming a photograph is real.
update public.products
set image_source = 'ai'
where image_source is null
  and image_url is not null
  and image_url like '%/storage/v1/object/public/%';

-- ------------------------------------------------------------
-- Does this store publish any AI-generated imagery right now?
--
-- One question, answered in one place, so the storefront never has to decide
-- the legal case per render — and so a store whose photos were all replaced
-- stops disclosing automatically.
-- ------------------------------------------------------------
create or replace function public.store_has_ai_imagery(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.products
        where store_id = p_store_id
          and image_url is not null
          -- NULL provenance counts: an image we cannot vouch for is disclosed,
          -- never quietly presented as a photograph.
          and (image_source is null or image_source in ('ai', 'placeholder'))
    );
$$;

revoke execute on function public.store_has_ai_imagery(uuid) from public;
grant execute on function public.store_has_ai_imagery(uuid) to anon, authenticated, service_role;
