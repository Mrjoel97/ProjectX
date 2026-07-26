---
phase: 14-flagship-voice-doc-workflow
plan: 09
subsystem: voice-doc
tags: [wave-9, sc4, static-scan, mutation-verification, playbook, human-verify, phase-close]
requires:
  - phase: 14-05
    provides: "the two voicedoc.* audit call sites + docReviewSchema being scanned"
  - phase: 14-07
    provides: "DocStrip, one of the three UI files scanned for a re-logged excerpt"
  - phase: 14-08
    provides: "PostCall's doc branch + the citationExcerpt render path"
provides:
  - "the Phase-14 SC4 static scans, EVERY one mutation-verified (the ledger is in the test header)"
  - "the consolidated Phase-14 record in docs/playbooks/voice.md"
  - "the owner's live verification of the flagship flow on a real call"
affects:
  - "any future voice-doc payload: a third audit.log or a new content key in one fails llmRedaction"
tech-stack: [vitest, node-environment-static-scan]
---

# 14-09 — SC4 proven statically, then verified by voice

## What shipped

**Task 1 — the §4 static scans, now actually verified.** The scans themselves landed earlier in
`0b6a1e9`, committed under the honest label *"(pre-mutation-verification)"*: written, never proven
able to fail. That is the dangerous state for an SC4 guard — it reads as proof that report content
cannot reach the log plane while proving nothing. All seven mutations were planted, confirmed RED
and reverted (`f43bcba`):

| # | Planted | Test that went RED |
|---|---------|--------------------|
| M1 | raw `query` in the `voicedoc.searched` payload | EVERY payload object · voicedoc.searched |
| M2 | `citationExcerpt` in the `voicedoc.reviewed` payload | EVERY payload object · voicedoc.reviewed |
| M3 | a THIRD `internal.audit.log` call site | log-plane surface is PINNED |
| M4 | `citationTitle` added to `docReviewSchema` (+ `required`) | welds citations in code |
| M5 | `excerpt` renamed to `quote` in `docReviewSchema` | DOES declare excerpt |
| M6 | `proofMetric` dropped from a `required` array | STRICT-mode legal |
| M7 | an `audit.log` write planted in `PostCall.tsx` | UI never turns an excerpt into a log field |

**The trap this exposed, recorded in the test header so a re-run does not repeat it:** in
`docReviewSchema`, `properties` keys are indented 10 spaces and `required` 8. A literal-anchor
mutation misses silently — the mutation *looks* applied, the test stays green, and the scan gets
recorded as verified while never having been exercised. M4 and M5 both reported a false PASS on the
first pass. Anchor on a regex, not on indentation.

**Task 2 — the playbook.** The consolidated Phase-14 record in `docs/playbooks/voice.md` was already
in place from the preceding plans and covers all nine required bullets (verified, including the
easily-missed excerpt rules: `EXCERPT_CHAR_CAP`, substring verification, drop-the-excerpt-never-the-
finding, and the presence assertion). This plan added the live-verification record and bumped
`Last verified`.

**Task 3 — the live verification (owner, 2026-07-26).** Confirmed working on a real call with real
duplex audio: the agent discussed the uploaded report itself; a mid-call **drill-in** returned a
grounded answer from that document (which is what proves the `search_document` relay reached the
model and was invoked); and **both outcome paths** landed — the memo saved as a markdown artifact in
the vault, and a gap turned into a plan that produced an email through the ordinary Approve gate.
SC1, SC2 and SC3 exercised end to end.

## Deliberately left open

Recording these as open rather than guessing them — `realtime.ts` carries a standing warning that
`voiceToken.ts` has been wrong about the mint body **twice**, so a fabricated value is worse than a
blank one.

1. **Open Question 3 — the tool-declaration branch.** NOT captured, and **unrecoverable after the
   fact**: `toolsAtMint` is returned to the browser (`voiceToken.ts:174-191`) and never persisted —
   no audit row, no log line — and both branches are invisible in the UI by construction. The
   owner's successful drill-in proves *a* branch works end to end; it cannot discriminate which.
   One line of instrumentation settles it on any future session (`realtime.ts:107` names both).
2. **Retrieval round-trip latency.** Not timed. Never observed as a problem, which is weak evidence
   it is acceptable — not evidence it is fast. Measure before reaching for the digest knob.

## Gates

`llmRedaction` 42/42 · `@pikar/voice` 57/57 · backend suite 643/643 (46 files, exit 0 — the
long-documented `audit.test.ts` `auditCounts` red is now green too) · backend `tsc --noEmit` 52
errors, **all in test files, zero in source** (the documented baseline) · `check-playbooks` exit 0.

## The environment trap that nearly read as a product bug

The first live attempt produced a **generic assistant** with no persona and no vault reach —
*"I can't access any knowledge vault"* — which looks exactly like a grounding regression. It was
not. `pnpm start` serves a **frozen production build**, and the running bundle had been compiled
**4h14m before the first Phase-14 commit**: no picker, no `?doc=` handoff, no `docId` at the mint,
therefore no document scope, therefore an agent with nothing. Rebuilding from `main` fixed it.

**Rebuild before any voice UAT, and check the build timestamp against `git log` before believing a
UI-level symptom.** Recorded in the playbook.

Second, unrelated: the local Convex deployment's `packages/backend/.convex/local/default/config.json`
had been deleted, and the backend survived only because the running process held it in memory —
a latent break invisible until a restart. Rebuilt from `.env.local`; note that
`CONVEX_DEPLOYMENT`'s trailing `# team: … project: …` is a **dotenv comment**, not part of the
deployment name.
