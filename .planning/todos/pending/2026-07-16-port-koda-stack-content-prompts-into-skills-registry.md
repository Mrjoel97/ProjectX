---
created: 2026-07-16T23:41:27.489Z
title: Port koda-stack content prompts into skills registry
area: content
files:
  - packages/contracts/skills/
  - packages/backend/convex/skills.ts:161
---

## Problem

Pikar AI has no content-creation skills (social scripts, captions, repurposing) —
the registry covers email drafting, documents, inbox digest, and cockpit routing
only. koda-stack (https://github.com/timkoda/koda-stack, MIT, researched
2026-07-16) is a 10-stage prompt-only content pipeline for Claude Code whose
prompt content is worth harvesting for a future content-creation phase. It has
nothing structural to teach us (our registry already does versioning + eval
gates + rollback); the value is field-tested prompt text.

## Solution

New phase (post-MVP or roadmap slot), NOT current 03.7 work. Port 3–4 stages as
new skill bodies following the documentDrafter pattern (markdown body in
packages/contracts/skills/, constant in @pikar/contracts/skill, entry in the
seedSkills array in packages/backend/convex/skills.ts):

- `content.brief` — loose idea → structured creative brief (their /brief)
- `content.script` — 5-block short-form formula: hook / pre-CTA / walkthrough /
  transition / comment-keyword CTA, 91–125 words (their /script — the most
  valuable prompt in the pack)
- `content.publish` — captions + hashtags per platform (their /publish)
- `content.repurpose` — one script → thread/carousel/story variants (their /repurpose)

Their "Creative DNA" config (Voice / Visual Identity / Content Format / Audience /
Rules) maps to a per-tenant brand-profile document, not a file.

SKIP: /generate, /assemble (image/video APIs — heavy), /trends (needs live trend
data), /storyboard, /art-direction (video-production stages, off solopreneur path).

MIT license — keep an attribution note in each ported skill body's header.
Do NOT clone the repo into the codebase (CLAUDE.md §5: prompts live in the
registry, no second ungoverned prompt plane). Gated-skill decision + eval
fixtures to be made at phase-planning time.
