# 002 — Consistent press feedback on secondary buttons
Baseline: b2d9704 · Severity: MEDIUM · Category: physicality

## Problem
Primary CTAs (.u-gold/.u-lift) scale on :active; secondary/text/icon buttons don't.
`.u-press { transition: transform 130ms var(--ease-urivo);} .u-press:active{ transform:scale(0.96);}`
already exists in globals.css — apply it.

## Fix
Add `u-press` (or `active:scale-[0.97]`) to pressable controls lacking feedback:
- app/(platform)/login/page.tsx: mode-switch text buttons (lines ~254,260,269).
- app/(platform)/dashboard/stores/[id]/store-manager.tsx: Edit/Remove (431,438),
  Regenerate/Generate (403), logo Remove/Upload (271,279), theme "Edit design" (241),
  "+ Add product" uses u-gold (skip). Modal ✕ close.
- app/(platform)/dashboard/generate-store-panel.tsx: ✕ close button.
Text links: `active:opacity-70` is enough; filled/bordered: `.u-press`.

## Verify
Press each on desktop + touch: subtle, immediate scale-down; no layout shift.
