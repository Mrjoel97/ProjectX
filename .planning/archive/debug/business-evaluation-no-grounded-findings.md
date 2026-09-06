---
status: resolved
trigger: "eval:golden fixtures 27/28/29/30/31 red on the ACTIVE cockpit-agent@24; findingsPresent false, gapCount 0, actOnGap gap_not_found; runs 9aaff3b3, bcaa9c7e, ceb81926; 2026-08-15"
created: 2026-08-15T21:20:00.0000000Z
updated: 2026-08-15T21:55:00.0000000Z
---

## Root cause

`runEvaluation` seeded its findings-provenance map by iterating **`userProvided`**, while the figures
it needed had been recorded into **`fieldProvenance`**. Commit **`5523f3e`** (phase 21-01, the same
day) split those two: it made `userProvided` LITERAL — only what the USER supplied —

```diff
-    userProvided: [field],
+    userProvided: byUser ? [field] : [],
```

— and `recordScorecardAnswerInternal` hard-codes `actor: "agent"` by construction, because the
cockpit RELAYS what it heard rather than the owner confirming it (that literal is 21-01's
anti-laundering guarantee and is CORRECT; it must not be reverted). The two facts compose into a
silent hole: on the conversational path `byUser` is permanently false, so `userProvided` is
permanently `[]`, so the pre-seed loop found nothing, so `findings` came out EMPTY — and SC #1 then
force-cleared the gaps, because a gap without a grounded finding would be a fabricated diagnosis.

The engine therefore answered "not enough data" about a figure the owner had just given it, one
turn earlier, and which was sitting correctly in the scorecard the whole time. **The defect was
citation-only: the VALUE always landed.** Both halves of the split were individually correct. Only
the join between them was not.

## Fix

`packages/backend/convex/evaluations.ts` — seed `provenance` from `fieldProvenance` (the record of
WHO answered), with `userProvided` kept as a fallback for legacy rows written before that column
existed. A relayed figure is cited as **`agent-relayed`**, a third additive literal on the
`findings[].source` union in `schema.ts`.

That third literal is the load-bearing part. A relayed figure MUST be cited — `FigureActor`'s own
contract is that origin and actor are independent, so the owner STATED it and the agent merely WROTE
it — but it must never be cited as `user-provided`, which is exactly the laundering `5523f3e` closed.
Both wrong answers were available (cite it as the owner's word, or keep suppressing it); the union
needed a third member so the honest answer was expressible at all. Additive, so every existing row
stays valid with no migration.

## Verification

- **New regression test** in `evaluations.test.ts`: a figure recorded via
  `recordScorecardAnswerInternal` must produce its OWN cited finding and must NOT be labelled
  `user-provided`. Observed RED before the fix (`expected undefined to be defined`) and green after.
  It asserts the SPECIFIC finding, never `findings.length >= 1` — the profile doc contributes
  identity findings of its own, so a count assertion would have passed while the figure still cited
  nothing. That is the vacuity this repo keeps catching.
- `evaluations.test.ts` 39/39, including the pre-existing anti-laundering assertions ("an AGENT
  answer lands the value but NEVER joins userProvided"), which still hold.
- `gapAction.test.ts` + `cash.test.ts` 59/59. `tsc --noEmit` clean.
- **LIVE, on the ACTIVE `cockpit-agent@24`** — the same command that established the defect:
  fixtures 27 and 28 went 0/2 ($0.0440, each failing twice on retry) → **2/2 PASS** ($0.0228, each
  passing first attempt), run `e6ddb1e9`. Only `evaluations.ts` and `schema.ts` changed between
  those two runs; no skill body was touched, which is what isolates the cause.
- The three gap-dispatch fixtures **29, 30 and 31 all PASS** (3/3, run pinned to @24, $0.0263 exec
  + $0.0017 specialist), each with a REAL specialist dispatch — confirming the whole chain recovers:
  findings → gap → tap → specialist. **All five originally-red fixtures now pass on the ACTIVE body.**

## Eliminated during investigation

- Caused by the item-4 body change (v26), or by 20-12/20.1-02 (v25): **no** — reproduced identically
  on `cockpit-agent@24`, which is BELOW both candidates.
- Vault retrieval or the corpus broken: **no** — `25-vault-grounded`, `35-create-document` and
  `39-drive-read` all passed in the same deployment state.
- An artifact of the OpenAI credit outage: **no** — 27/28 failed with real per-case cost BEFORE
  credits ran out, and reproduced after the top-up.
- Transient environment fault: **no** — reproduced against a freshly restarted `convex dev` with
  zero `Retrying request` lines and 32 other fixtures green.

## Why it escaped

`5523f3e` shipped 105 lines of new tests in `evaluations.test.ts` and they were all correct. They
asserted the MECHANISM — that provenance is recorded with the right actor, that an agent answer
never joins `userProvided` — and never the BEHAVIOUR, that an evaluation still produces findings
afterward. The pre-existing BEVL-01 findings test seeds a vault doc WITH financial lines, so its
findings come from the vault path and it stayed green throughout. No test covered the
conversational-only path, where the relayed figure is the sole basis. This is
`green-tests-over-broken-capability` again, and the new test above is written specifically to close
that path rather than the mechanism.

## Consequence, now discharged

While these five were red, `recordEvalEvidence` could never fire (evidence lands only on an
all-green UNFILTERED run), so NO `cockpit-agent` candidate could be activated — v25's media/Drive
work and v26's calendar/document work were both blocked behind a defect neither introduced. With the
fix in, a full unfiltered gate can go green and record evidence for the first time. That run has NOT
been performed yet; fixtures 32/33/34 (research) also remain unverified in this cycle.
