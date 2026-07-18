# Animation improvement plans

Audit against Emil Kowalski's craft bar (`.claude/skills/improve-animations`).
Baseline commit: b2d9704. The app was already strong (custom ease token, active
states on primary CTAs, reduced-motion coverage, transform/opacity-only, no
ease-in / transition:all / scale(0)). These tighten the remaining gaps.

| Plan | Severity | Status |
| --- | --- | --- |
| 001 — gate transform hovers behind (hover:hover) | HIGH | done |
| 002 — consistent press feedback on secondary buttons | MEDIUM | done |
| 003 — entrance for Ask Urivo messages + edit card | MEDIUM | done |
| 004 — consolidate hardcoded ease curve onto --ease-urivo | LOW | done |

Recommended order: 001 → 002 → 003 → 004 (independent; 001 highest leverage).
