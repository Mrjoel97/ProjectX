---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 11
wave: 8
requirements: [CONT-01]
status: complete
executed: 2026-08-22
---

# 26-11 — artifact provenance and the explicit trust promotion

## What shipped

**Four write sites now record which conversation produced an artifact.** `sourceThreadId` +
`sourcePlanId` are taken from the plan row the writing path already holds — never from a
model-supplied tool argument, so the model cannot stamp a document with another thread's
provenance. Approved memo (`evaluations.persistNextStepMemo`), created document
(`vault.insertCreatedDoc` ← `llm.ts:3817`), research brief (`research.persistFindings` ←
`dispatch.ts:1172`), and rendered media (`mediaComplete.ts`, `render/renderReel.ts`). Both new
validator fields are `v.optional`: nine existing `createdDocs.test.ts` call sites and an
over-the-wire e2e call pass neither, and legacy rows stay bare — no backfill, nothing inferred.

**`api.vault.promoteToReference`** — one guarded transaction. Accepts only a row this tenant owns
whose `origin === "agent"`, patches `origin → agent_promoted` + `status → processing`, and calls
the existing `startIngest` exactly once. Returns
`{ok:true,state:"processing"|"already_promoted"} | {ok:false,reason:"ineligible"}`. It is the SINGLE
promotion surface; 26-12/26-13 call it directly and project its result.

**Attribution follows the promoted text through both grounding planes.** `ownedDocsMeta` carries
`origin`; `vaultGroundHydrated` returns a parallel `origins` array *from the batch read it was
already doing*; the evaluation engine cites such a chunk `source: "agent-relayed"` instead of
`"vault"`; and the cockpit's `searchVault` fence marks the in-fence label the model reads.

## Owner decisions closed this session (all five open questions)

1. **vault.md's parked question is CLOSED.** The note refused BLANKET ingestion; an explicit,
   human-initiated, per-row promotion is what `schema.ts` says both `origin` literals exist for.
   That block is rewritten, not appended to, and ADR-025 records it.
2. **CONT-01 AMENDED** (not deviated): "sent mail" removed from the Content lane and reassigned to
   RPRT-01. As ratified the requirement could never be checked off — 26-11/12/13 all exclude it.
3. **Reel provenance landed HERE**, pulling `docs/playbooks/media.md` in as the fourth playbook.
4. **The cockpit fence was closed too — and it made the plan SMALLER.** The audited plan had
   `evaluations.ts` issue its OWN second `ownedDocsMeta` query; `vaultGroundHydrated` was already
   doing that read for `titles`, so returning `origins` serves both consumers from one round-trip
   and closes the cockpit door the plan would have left open. One fewer query, one more door shut.
5. **One promotion surface confirmed.** 26-12/26-13 plan text edited: call it directly, never
   re-wrap the guard in `api.content.*` — a duplicated guard is how one path ends up unguarded.

## DEVIATION — the plan told me to write an audit row, and the plan was wrong

Task 2 as audited specified `internal.audit.log` inside `promoteToReference`, and treated the only
risk as registering the `auditCounts` component. It missed **`vaultRedaction.test.ts`**, a shipped
static scan asserting that `vault.ts` / `vaultIngest.ts` / `vaultGraph.ts` / `vaultLlm.ts` emit **no
log-plane call or insert at all**. Adding the audit reddened it (caught by the full-suite run, not
by the plan's filtered command).

The invariant is deliberate and **stronger than what the plan proposed**: `vault.ts` is the one
module holding raw document text, so it is kept log-free BY CONSTRUCTION rather than by inspecting a
payload. A carefully-shaped payload is one careless edit away from carrying `doc.title`; an absent
call site is not. This is the repo's own "structural exclusion beats a predicate" pattern — the same
reasoning that made `insertCreatedDoc` skip `startIngest` in the first place.

**Resolution:** the audit write was removed, its test deleted, and the `auditCounts` registration
reverted. **The CALLER audits** — the shipped precedent is `vault.searched`, written by `llm.ts`,
not by the vault plane. 26-13 now owns a refs-only `vault.promoted` row from the web-side action;
recorded in its plan, in `vault.md` and in ADR-025. Until then the record that a promotion happened
is the row itself plus the ingest workflow's trail.

## Evidence

| Check | Result |
|---|---|
| Full backend suite | **90 files, 2237 passed** — clean on 3 of 4 runs; one run hit a media cross-file flake (see below) |
| `tsc --noEmit` (backend) | clean |
| Playbook gate (uncommitted) | no `"decision":"block"` — and **verified live**: clearing the ack and reverting `media.md` DID block, restoring it allowed |
| Promotion mutation checks | **5/5 caught**, each by the named test |
| Citation mutation check | caught |

Mutants (applied and reverted programmatically): M1 delete `startIngest` → tests (1)(2)(7);
M2 delete the `already_promoted` early return → (2); M3 delete the tenant term → (3);
M4 `origin !== undefined` instead of the positive whitelist → (5); M5 drop `status:"processing"`
→ (1)(7). M6 unconditional `source:"vault"` → the agent-relayed test.

**M8 is the one worth reading.** Dropping the two provenance fields at the `insertCreatedDoc` call
site in `llm.ts` reddens `cockpitTools.test.ts` **while `createdDocs.test.ts` stays green** —
measured, both suites in one run. That asymmetry is the whole reason the tool-level assertion had to
exist: `createdDocs.test.ts` calls the mutation directly, so it can only ever prove the *arguments
exist*, never that `llm.ts` passes them. I had in fact finished Task 1 without that assertion and
only caught it at staging, when `cockpitTools.test.ts` showed **no diff** against a plan that listed
it. Mechanism coverage is not behaviour coverage; a file the plan names but the diff does not touch
is a coverage hole with a green suite over it.

**One mutation check in the plan was itself wrong and is corrected in place:** "drop `origin` from
`ownedDocsMeta` → typecheck reddens" is FALSE — the field is declared `origin?: string`, so omitting
it is legal TypeScript and `tsc` exits 0. Only the behavioural test catches it. **A `?:` field can
never be mutation-checked by the compiler.**

## Things worth not re-learning

- **`pnpm --filter <pkg> test -- <filters>` DOES NOT FILTER.** Measured: `test -- zzzznotarealfile`
  ran `dispatch.test.ts`, which matches neither term (90 files, 2227 tests, ~107s). Dropping the
  `--` filters correctly. The failure is INVERTED — slower, appears to do more, and passes — so a
  "focused suite" verify silently proves nothing about scope. Both of this plan's original verify
  commands used the broken form, as did 26-VALIDATION row 26-11 (which also carried a dead
  `content` filter term matching no file). Both corrected.
- **`node scripts/check-playbooks.mjs` can never fail an `&&` chain** — all six exit sites are
  `process.exit(0)`; it signals by printing `{"decision":"block",…}`. It must also run while code
  AND playbook edits are still uncommitted.
- **The playbook gate has an acknowledgment cache** (`.git/claude-playbooks-ack.json`) keyed by the
  hash of the changed watched files. Once a state is blessed, reverting the playbook alone will NOT
  re-block — my first attempt to prove the gate was live was confounded by exactly this. Clear the
  playbook's ack entry to test it honestly.
- **Exhaustive `toEqual` on `vaultGroundHydrated`'s return** exists in two isolation tests
  (`vaultGround.test.ts`, `onboarding.test.ts`). Both were updated rather than loosened — they are
  cross-tenant guards, and exhaustiveness is the point.
- **TWO FLAKES, recorded rather than rounded to green.** (a) An early filtered run reported
  `1 failed | 650 passed` without the name being captured; three consecutive re-runs of the same
  filter were clean at 651. (b) One of four full-suite runs reddened
  `media.test.ts > the caption BURN terminal: a failure degrades the reel, it never unpublishes it`;
  `media.test.ts` then passed 3/3 in isolation (227/227) and the full suite passed 3 of 4 runs at
  2237/2237. Both are cross-file timing flakes under parallel execution, neither reproduces in
  isolation, and neither touches the promotion or provenance paths. Not diagnosed here — but the
  honest claim is "3 of 4 full runs clean", not "green".

## Not done / handed on

- **No UI.** `files_modified` contains no `apps/web/**` file. 26-13 builds the control; until then
  "rollback" means deleting the export (26-10 recorded there is no runtime kill-switch).
- **26-13 owes**: the `vault.promoted` audit row, the promotion explanation including the one-way
  warning, and a FRESH agent-authored document per UAT promotion.
- **26-12 owes**: the "research briefs are not projected into the Content shelf" invariant — it
  belongs to the plan that creates `content.ts`, and was removed from this plan's truths as
  untestable here. `persistFindings` keeps writing `kind:"web_research"` as its discriminator.
- **Still open, not introduced here**: two red finance tests characterised in 26-10-SUMMARY, and
  26-VALIDATION rows 26-06/07/08.
