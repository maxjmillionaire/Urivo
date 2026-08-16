# 001 — Gate transform-based hovers behind (hover:hover)
Baseline: b2d9704 · Severity: HIGH · Category: touch accessibility

## Problem
No `@media (hover:hover)` exists in the codebase. Transform/scale hover motion
fires on touch tap as a false hover, making elements jump on mobile/tablet.

## Fix (exact)
1. `app/globals.css` — `.u-lift:hover { transform: translateY(-2px); }` (~line 435):
   wrap in `@media (hover:hover) and (pointer:fine){ ... }`.
2. `app/(store)/store/[subdomain]/storefront-renderer.tsx` scopedCss (~line 152-153):
   `#uv-store .uv-card:hover .uv-plane{ transform:scale(1.045); }` → move inside
   `@media (hover:hover){ ... }`. Keep the non-hover `.uv-plane` transition rule.
   Also gate `#uv-store .uv-btn:hover{ ...transform:translateY(-1px)... }` — keep the
   box-shadow/filter change ungated (colour), gate only the translate.
Leave colour/border/opacity hovers ungated everywhere.

## Verify
On a touch emulator, tap a store card and a lifted button: no jump. On desktop,
hovers still lift. Reduced-motion still overrides.
