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

~~SKIP: /assemble (multi-clip concatenation — ADR-011 rules it out of Phase 20)~~,
/trends (needs live trend data).

**⚠ THE `/assemble` DEFERRAL ABOVE IS REVERSED — struck through, not deleted, so
the reversal is legible.** ADR-011's "any longer artifact is assembly, which is a
different feature" line is **SUPERSEDED by ADR-012** (2026-08-03): a CLIP is
≤15 s, but a DELIVERABLE is N clips assembled, and assembly shipped in Phase 20.
`20-CONTEXT.md`'s Deferred list carries the same reversal. Leaving either one
contradictory is what D6 forbids.

**PARTLY SUPERSEDED 2026-08-01 (owner, Phase 20 planning); SETTLED 2026-08-03
(plan 20-11, ADR-012).** This todo's original SKIP list covered the media stages
as "heavy". Phase 20 reversed that for the MEDIA stages, and D8 additionally
pulled `/script` IN — a voiceover has nothing to say without one.

**DONE — ported into the `media-director` registry row (all four in ONE row) and
the render stage, Phase 20:**

- `/script` — moved IN by D8, was previously left to this todo
- `/art-direction`
- `/storyboard` — emits the fixed-length BLOCK DECK the price table and the
  assembler both parse
- `/generate` — the PROMPT SHAPE only; the CALL is ours (our adapter, price
  table, budget rail and webhook), never koda's invocation
- `/assemble` — a harvested `assemble_final.sh` run in an ephemeral Vercel
  Sandbox (ADR-013). **Deliberately NOT a registry row**: §5 governs prompts, and
  a runtime-mutable shell script executing in a VM that holds tenant media is RCE

Corroboration worth keeping: koda's `/generate` already targets fal.ai, which
ADR-011 chose independently on a price-per-clip argument.

**STILL PENDING, and this todo remains open for them:** `/brief`, `/concept`,
`/publish`, `/repurpose` and `/trends`. Phase 18's `content-drafter` covers
documents/HTML and does NOT claim them. Also still out of Phase 20 and unclaimed:
music beds and sung tracks (the harvested assembler's `--music` / `--song`, both
stripped), and re-cutting footage the user already has.

MIT license — keep an attribution note in each ported skill body's header.
Do NOT clone the repo into the codebase (CLAUDE.md §5: prompts live in the
registry, no second ungoverned prompt plane). Gated-skill decision + eval
fixtures to be made at phase-planning time.
