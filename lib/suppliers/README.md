# Suppliers — DORMANT (not wired into the product)

**Status: shelved.** This module is a complete, provider-agnostic sourcing /
dropshipping backend (AutoDS provider, import, scoring, intelligence, autopilot)
plus its schema (migration `0014_suppliers.sql`). It is **not imported by any
route or page** and is **not on the launch path.** It was built ahead of need.

It is deliberately kept (not deleted) because the design is sound and dropshipping
import is a plausible future motion — but until it is activated it must be treated
as **inactive infrastructure**, not a live feature:

- Do **not** reference it in product copy, the dashboard, or marketing — it does
  nothing a merchant can see today.
- Do **not** invest maintenance effort in it during the launch push.
- The `supplier_connections` / `product_sources` tables exist in the DB (0014,
  service-role only, RLS on) but hold no product-critical data; leave them.

## To activate later (rough shape)
1. A merchant-facing "Sourcing" surface (connect a provider, browse/import
   products into a store).
2. An API layer over `lib/suppliers/*` that surfaces connection status and import
   actions (never the stored credentials).
3. A cost/credit treatment for imports if any AI enrichment is involved.
4. Wire `product_sources` so imported products trace back to their supplier.

Until that work is scheduled, this directory is a parked asset. If it is ever
decided it will **not** be pursued, delete `lib/suppliers/` and leave `0014` in
place (migrations are immutable history) with a note here.
