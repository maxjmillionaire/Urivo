# 004 — Consolidate hardcoded ease curve onto --ease-urivo
Baseline: b2d9704 · Severity: LOW · Category: cohesion/tokens

## Problem
`cubic-bezier(0.16,1,0.3,1)` is hardcoded ~13x in generation-cinema.tsx and once
in evolution-lab.tsx:177 — identical to `--ease-urivo` in globals.css.

## Fix
Replace the literal `cubic-bezier(0.16,1,0.3,1)` with `var(--ease-urivo)` in:
- app/(platform)/dashboard/generation-cinema.tsx (all occurrences)
- app/(platform)/dashboard/evolution/evolution-lab.tsx:177
These are inline styles in client components; the CSS var resolves from :root.
Leave the storefront's `cubic-bezier(.2,.7,.2,1)` alone — the storefront is an
isolated design system with its own intentional curve.

## Verify
`grep -rn "cubic-bezier(0.16" app` returns only the globals.css token definition.
Build stays green; motion identical.
