# Plan 47-17 — independent D6 packet review

**Date:** 2026-09-25. **Packet author:** `/root`. **Independent reviewer:** Codex `/root/phase47_d6_checker`, read-only technical/governance review. **Final verdict:** ACCEPT the corrected [decision packet](47-17-D6-DECISION-PACKET.md) for an owner A/B/C disposition, **not** ADR-046 D6, ROUT-02, Phase 47 or Wave 6 acceptance. Pre-choice reviewed packet SHA-256: `4cbead3f6386ae34670f49dc0bf3689d340aac8e1f388b5cbfc1895f76ce909b`; after appending only the owner's route-selection words, packet SHA-256: `7e70c6e84ee51a671a07a661d62b1b4ab072962716c4d2b2078c1f2a5d58ccd7`.

## Challenge and correction

The first independent pass **refused** owner presentation. It agreed that ADR-046 literally requires paused state plus best-effort cancellation and that the sweep-only candidate has no per-routine pending callback to cancel, but found the packet concealed other candidate-versus-preserved-design differences. The author added a separate section naming stored next-due fields versus compute-from-zone/last occurrence, missing `savedPrompts` reference, and the candidate-only dead-letter table versus production reuse. The reviewer re-read that exact correction and returned **ACCEPT** with no further requested edit. Neither A nor B can promote the current candidate by resolving D6 alone.

The reviewer inspected ADR-046, ADR-050, Phase 47 context/stage, candidate model/schema/tests, production `crons.ts`, `reliabilitySweep.ts`, `dstProbe.ts`, and `convex.json`; the packet records their exact SHA-256 values and source paths. Its source scan found no production or app import of `candidate/recurrence` except negative test fixtures. The global `reliability-sweep` is not a cancellable per-routine callback; the four independent DST jobs remain untouched. Option A changes scheduling architecture and needs a separately reviewed boundary. Option B would require a narrowly superseding, exactly accepted ADR and substantive transactional proof. Option C retains defer. No option is an owner verdict yet.

## Current verification and limits

| Check | Current result |
|---|---|
| Historical `--matrix` | exit `0` |
| Historical `--eligibility` | exit `1`, expected refusal with 14 findings |
| Historical `--validate-decision` | exit `0`, `defer` |
| Separate `--validate-stage` | exit `0`, disabled candidate stage only |
| Candidate edge-runtime Vitest | 9/9, exit `0` |
| Candidate TypeScript project | exit `0` |
| Strict planning check | exit `0` |
| `git diff --check` | exit `0` (pre-existing line-ending warnings only) |

The independent review is a source/governance judgment, not production or live evidence. Synthetic tests do not prove pending-function cancellation, deployed ordering, real limiter integration, DST/OAuth/provider observations, or tenant activation. The historical `defer` decision and six-file stage inventory remain unchanged. No candidate/production source, ADR, checker, matrix row, provider, paid call, send, deploy or DST job was changed by Plan 47-17.

**Owner checkpoint update (2026-09-25):** The owner selected B after this review; the exact words are recorded in the packet. This review accepted the packet for presentation, not the future amendment. No ADR text is yet accepted and D6 remains open.
