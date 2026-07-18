# 003 — Entrance for Ask Urivo messages + edit card
Baseline: b2d9704 · Severity: MEDIUM · Category: prevent jarring change

## Problem
Chat message bubbles and the "Proposed change" EditCard mount instantly (pop).

## Fix
In app/globals.css add:
```
@keyframes urivo-msg-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.u-msg-in{animation:urivo-msg-in 220ms var(--ease-urivo) both;}
```
In app/(platform)/dashboard/_shell/ask-urivo.tsx add className `u-msg-in` to the
MessageBubble wrapper and the EditCard root. The existing reduced-motion block
(`[class*="urivo-"]` / animation:none) — extend to also match `.u-msg-in` or add
`@media (prefers-reduced-motion:reduce){ .u-msg-in{animation:none;} }`.
Do NOT animate the streaming text updates (only the bubble mount).

## Verify
Send a message: bubble + card rise+fade in ~220ms. Reduced-motion: appears instantly.
