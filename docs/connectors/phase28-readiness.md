# Phase 28 Readiness — the landed-contract gate

> **Status is produced by a script, not by this prose.** Run
> `node scripts/check-phase28-readiness.mjs`. Exit 0 = `passed`, exit 1 = `blocked`.
> This document carries the evidence, the interface inventory and the one owner judgment no script
> can make.

**Produced:** 2026-08-27 (plan 28-17) · **Gate:** `scripts/check-phase28-readiness.mjs`

---

## Why this gate exists

Phase 28's 29 plans were authored **2026-08-05**, against Phase 19, Phase 25 and Phase 27
interfaces that did not exist yet. Phase 27's own readiness audit
(`.planning/phases/27-curated-knowledge-work-pack-pilot/27-READINESS.md`) found **eleven rotted
premises** of exactly that shape — plans naming `convex/inbox.ts`, `convex/artifacts.ts`,
`apps/web/components/` and `apps/web/app/(dashboard)/…`, none of which ever existed.

So every prerequisite below is resolved from **a file on disk containing a named symbol**. Not from
a SUMMARY.md saying it landed, not from a ROADMAP row, and not from a planner's memory. A prior
session's confident green record is not evidence.

## Result

| | |
|---|---|
| **Code rows** | **15 / 15 GREEN** |
| **Owner-attested rows** | **0 / 1** — `p25-production-posture` is `undecided` |
| **Hard status** | **`blocked`** |
| **Blocks** | every Phase 28 plan (28-01 … 28-16, 28-18 … 28-29) |
| **Missing contract** | Production secret source, redirect-URI ownership and hosted fail-closed behaviour — none of them facts about this repository |
| **Remediation owner** | Owner — 28-17 Task 2 checkpoint |
| **Recheck** | `node scripts/check-phase28-readiness.mjs` |

The fifteen code rows are green on the **first** run, which is the exact shape this repo has
shipped broken capability behind before. They were therefore **observed RED** before being
believed — see *Non-vacuity evidence*.

---

## The one thing the repository cannot prove

`p25-production-posture` is not a `files` row and never can be. Three facts it needs are not facts
about this repository:

1. **Production secret SOURCE.** `packages/backend/convex/lib/env.ts` proves a *manifest of names*
   exists and that `ops.envCheck` reports which are unset — deliberately **names only, never a
   value, never a length**. It therefore cannot see which values a hosted deployment holds, nor
   whether they were set with `npx convex env set --prod` rather than copied from a dev
   `.env.local`. That is the right design and it is also why this row exists.
2. **Redirect-URI OWNERSHIP.** `isDurableOrigin()` rejects `localhost`, plain `http`, `.local` and
   Vercel preview hosts, and `ops.envCheck` reports `nonDurableOrigins`. Nothing in the repo can
   know whether the URI in `GMAIL_OAUTH_REDIRECT_URI` / `MICROSOFT_CALENDAR_REDIRECT_URI` is
   registered under an org-owned Google/Microsoft OAuth client or a personal one.
3. **Hosted FAIL-CLOSED behaviour.** `requireEnv` (`gmailAuth.ts`) and `requireEnvMedia`
   (`media.ts`) throw in source, and `ENV_MANIFEST` enumerates every `tier: "fixture"` seam so a
   faked provider is reportable. Whether the deployed build actually refuses — rather than serving
   a fixture seam someone left set — is an **observation**, and only the owner has made it.

**The bookkeeping agrees the question is open.** Phase 25 plans **25-11** (deploy the Branch-A
production bundle), **25-12** (automated production qualification) and **25-13** (final live
acceptance) have **no `SUMMARY.md` on disk**. Those three are precisely where production
secret/OAuth posture would have been exercised.

Recorded as an honest `blocked` rather than assumed. Phase 28's domain boundary is third-party
OAuth grants holding a tenant's accounting and payments data; starting connector work on an
unverified production secret posture is the one mistake this phase cannot afford.

### Owner attestation

The gate parses the block below. The value set is **closed** — a typo reads `undecided`, never
`pass`. Only a literal `pass` clears the row.

<!-- phase28-attestation
phase25_production_posture: undecided
-->

- `pass` — the owner has evidenced production secret source, redirect ownership AND fail-closed
  behaviour. Phase 28 may start.
- `block` — the owner has evidenced that one of them is wrong. Phase 28 stays stopped; remediation
  is a Phase 25 lane item (25-11 / 25-12 / 25-13).
- `undecided` — no judgment on record. **Default. Blocking.** The gate must not be satisfiable by
  forgetting to answer.

---

## Non-vacuity evidence

`scripts/check-playbooks.mjs` in this repo exits 0 on every terminal path and blocks forever on
stdin if run bare — a gate that can only ever read green. 27-READINESS found four more verify
commands naming files no task creates. This gate was built to not join them.

**1. `--self-check` (mechanical, runnable):**
`node scripts/check-phase28-readiness.mjs --self-check`

- All 16 rows go **RED against an empty tree** — no row can pass by having nothing to check.
- All **91 symbols proven load-bearing** by three mutations each: delete every occurrence,
  suffix-rename it, prefix-rename it. Each mutation must flip its row red.
- The posture row rejects `block`, `undecided`, `PASS`, `yes` and `""`; only literal `pass` passes.
- A row declaring neither `files` nor a `posture` key is rejected as unfalsifiable.

**2. Observed RED on the real working tree.** Two exported symbols were renamed in place
(`listPacks` → `listPacksRENAMED` in `workflowPackDiscovery.ts`; `pipelineTiles` →
`pipelineTilesRENAMED` in `contacts.ts`), the gate was run, and the files were restored to a clean
`git diff`.

- **First run — the gate stayed GREEN.** It matched with `String.includes`, and `listPacks` is
  still a substring of `listPacksRENAMED`. **A gate that survives the rename it exists to catch.**
  `--self-check` had passed on all 91 symbols while this hole was open, because its only mutation
  was deletion — and deletion is invisible to the substring trap.
- **Fixed** with whole-symbol matching (`containsSymbol`, identifier-boundary aware), and
  `--self-check` was extended with the rename mutations that would have caught it.
- **Second run — `p19-pipeline-view` and `p27-discovery` both went RED**, each naming the exact
  missing symbol. Exit 1. Files restored, `git diff --stat` empty.

Recorded because the failure *is* the evidence. A gate nobody has watched fail is not a gate.

---

## Landed interface inventory

Regenerate with `node scripts/check-phase28-readiness.mjs --inventory`. **Do not hand-edit** — the
authoritative list is the `CHECKS` table in the script, and a retyped second copy is a copy that
goes stale and then gets believed.

### Phase 19

**`p19-contacts-substrate`** — ACTN-05 — GREEN
> One tenant-scoped person/consent/suppression/follow-up store (REVN-04 must not build a second CRM).

- `packages/backend/convex/contacts.ts`
  - `export const upsertContact`
  - `export const assertConsent`
  - `export const consentRecord`
  - `export const markSuppressed`
  - `export const unsuppress`
  - `export const createFollowUp`
  - `export const setFollowUpStatus`
  - `export const listUnassignedFollowUps`
  - `export const isSuppressed`
  - `export const suppressedAmong`
- `packages/backend/convex/contacts.test.ts`
  - `contacts: the write surface`
  - `contacts: the send-path suppression backstop`
  - `contacts: listUnassignedFollowUps is the contactless section's own read`

**`p19-suppression-terminal`** — ACTN-05 — GREEN
> The last-mile send refusal. REVN-06's invoice-reminder drafts terminate here, not at a new check.

- `packages/backend/convex/gmail.ts`
  - `export async function prepareGovernedMessage`
  - `internal.contacts.isSuppressed`
  - `reason: "suppressed"`
- `packages/backend/convex/gmail.test.ts`
  - `gmail.send — the suppression backstop`

**`p19-approval-terminal`** — ACTN-05 — GREEN
> The single human approval gate + per-address suppression drop that REVN-06 drafts must pass through.

- `packages/backend/convex/cockpit.ts`
  - `export const executePlan`
  - `internal.contacts.suppressedAmong`
  - `"all_recipients_suppressed"`
  - `status: "approved"`
- `packages/backend/convex/cockpit.test.ts`
  - `executePlan`

**`p19-pipeline-view`** — PIPE-01 — GREEN
> A pipeline read over the SAME substrate, with no opportunity/deal-value concept. REVN-04 extends this.

- `packages/backend/convex/contacts.ts`
  - `export const pipelineTiles`
- `apps/web/app/(app)/dashboard/pipeline/PipelineView.tsx` *(presence only)*
- `packages/backend/convex/contacts.test.ts`
  - `PIPE-01: no second CRM data plane leaked an opportunity concept into the substrate`
  - `contacts: pipelineTiles are ALWAYS-KNOWN counts`

### Phase 25

**`p25-secret-manifest`** — REVN-03 (encrypted, revocable provider grants) — GREEN
> A derived-checked env manifest that reports NAMES only, plus the durable-origin assertion (ADR-022).

- `packages/backend/convex/lib/env.ts`
  - `export const ENV_MANIFEST`
  - `export const REQUIRED_ENV`
  - `export function missingEnv`
  - `export const ORIGIN_ENV`
  - `export function isDurableOrigin`
- `packages/backend/convex/env.test.ts`
  - `missingEnv reports names, never values`
  - `isDurableOrigin rejects the origins that stop resolving`
  - `envCheck is owner-only and leaks nothing`
- `packages/backend/convex/ops.ts`
  - `export const envCheck`
  - `nonDurableOrigins`

**`p25-oauth-state`** — REVN-01/02/03 (connector OAuth round-trip) — GREEN
> The signed-state callback trust boundary a connector grant would be modelled on: HMAC state, provider discriminator, redirect from env.

- `packages/backend/convex/gmailAuth.ts`
  - `export async function verifyState`
  - `requireEnv("GMAIL_OAUTH_REDIRECT_URI")`
- `packages/backend/convex/microsoftAuth.ts`
  - `export async function verifyMicrosoftState`
  - `STATE_PROVIDER`
  - `requireEnv("MICROSOFT_CALENDAR_REDIRECT_URI")`
- `packages/backend/convex/http.ts`
  - `verifyState`
  - `verifyMicrosoftState`
- `packages/backend/convex/microsoftAuth.test.ts`
  - `verifyMicrosoftState — the callback trust boundary`
  - `a Google-issued state is REJECTED even when both providers share a client secret`
- `packages/backend/convex/httpAuth.test.ts`
  - `a tampered state fails BEFORE the credentialed token POST`

**`p25-no-dev-fallback`** — REVN-03 (honest partial/unavailable states) — GREEN
> Missing credentials THROW instead of falling back to a development default or a faked provider.

- `packages/backend/convex/gmailAuth.ts`
  - `function requireEnv`
  - `` throw new Error(`Gmail OAuth env not configured: ``
- `packages/backend/convex/media.ts`
  - `export function requireEnvMedia`
  - `` throw new Error(`Media env not configured: ``
- `packages/backend/convex/lib/env.ts`
  - `tier: "fixture"`
  - `fixturesActive`

**`p25-production-posture`** — REVN-01/02/03 production suitability gate — RED
> Production secret SOURCE, redirect-URI OWNERSHIP and hosted fail-closed behaviour. None of these are facts about this repository.

- Not code-provable. Owner attestation key: `phase25_production_posture`

### Phase 27

**`p27-manifest-provenance`** — PACK-01 — GREEN
> Pinned upstream snapshot + offline provenance verifier + attribution. A connector pack inherits this shape.

- `third_party/knowledge-work-plugins/manifest.json` *(presence only)*
- `scripts/verify-knowledge-work-provenance.mjs`
  - `--check-source`
  - `--check`
  - `adaptedBodySha256`
- `THIRD_PARTY_NOTICES.md`
  - `knowledge-work-plugins`

**`p27-static-grant`** — PACK-02 — GREEN
> Code-owned per-pack tool allow-list + forbidden-operation vocabulary. REVN-06 needs this to keep sends/refunds unreachable.

- `packages/core/src/workflowPacks.ts`
  - `export const WORKFLOW_PACK_IDS`
  - `export const WORKFLOW_PACKS`
  - `export function toolsForWorkflowPack`
  - `export function resolveWorkflowPack`
  - `export const LEAF_FORBIDDEN_OPERATIONS`
  - `export const PACK_UNREACHABLE_TOOLS`
  - `export const MISSING_PACK_SOURCES`
  - `export function packPreflight`
- `packages/core/src/workflowPacks.test.ts` *(presence only)*

**`p27-pack-binding`** — PACK-02 — GREEN
> The (skill body, tool-set) binding onto the existing agent loop. Revenue specialists bind the same way — do NOT write a second runtime.

- `packages/backend/convex/workflowPackBinding.ts`
  - `export const runWorkflowPack`
  - `export function preflightPrompt`
  - `export function outcomeFor`
- `packages/backend/convex/workflowPackBinding.test.ts` *(presence only)*
- `packages/backend/convex/cockpit.ts`
  - `export const startWorkflowPack`

**`p27-candidate-lifecycle`** — PACK-03 — GREEN
> Dark-first publication, provenance/eval/browser gating, activation and an owner-facing deactivate.

- `packages/backend/convex/skills.ts`
  - `export const publishPackCandidate`
  - `export const inspectPackCandidates`
  - `export const recordPackBrowserEvidence`
  - `export const deactivatePack`
  - `export const activateCandidate`
  - `export const getActiveSkill`
  - `export const PACK_GATE_ERROR`
  - `export const PROVENANCE_PIN_ERROR`
- `packages/core/src/workflowPacks.ts`
  - `export function hasValidPackProvenance`
  - `export function hasPassingPackBrowserEvidence`
- `packages/backend/convex/skills.test.ts` *(presence only)*

**`p27-golden-eval`** — PACK-03 — GREEN
> Per-pack fixture evaluation writing evidence onto the exact skill version. Revenue packs must reuse it, not add a third runner.

- `packages/backend/scripts/run-workflow-pack-evals.mjs` *(presence only)*
- `packages/backend/scripts/workflow-pack-fixtures/thresholds.json` *(presence only)*
- `packages/backend/scripts/run-eval-golden.mjs`
  - `COST_CAP_USD`

**`p27-discovery`** — PACK-04 — GREEN
> Tenant-visible pack list with honest source availability. REVN-01/02/03 connector states surface through this, not a new shelf.

- `packages/backend/convex/workflowPackDiscovery.ts`
  - `export const listPacks`
  - `export const probeSources`
  - `export const listPackCandidates`
- `packages/backend/convex/workflowPackDiscovery.test.ts` *(presence only)*

**`p27-shared-events`** — PACK-04 — GREEN
> The shared refs-only pack event plane and derived metrics. REVN telemetry EXTENDS this; it must not open a sixth event plane.

- `packages/core/src/workflowPackMetrics.ts`
  - `export const PACK_EVENTS`
  - `export const PACK_OUTCOMES`
  - `export const PACK_DERIVED_METRIC_SOURCES`
  - `export function followUpRecovery`
- `packages/backend/convex/workflowPackEventLog.ts`
  - `export const record`
  - `export function toMetricEvent`
  - `export const forTenant`
- `packages/backend/convex/schema.ts`
  - `workflowPackEvents: defineTable(`
- `packages/core/src/workflowPackMetrics.test.ts` *(presence only)*
- `packages/backend/convex/workflowPackEventLog.test.ts` *(presence only)*

**`p27-outcomes`** — PACK-04 — GREEN
> Cost/latency read from their EXISTING owners rather than re-emitted. REVN success measurement joins here.

- `packages/backend/convex/workflowPackOutcomes.ts`
  - `export const forTenant`
  - `PackOutcomeReport`
- `packages/backend/convex/workflowPackOutcomes.test.ts` *(presence only)*

---

## What a dependent Phase 28 plan must do

1. Run `node scripts/check-phase28-readiness.mjs`.
2. **Exit 1 → stop.** Do not substitute an assumed interface, do not write a compatibility shim,
   do not mark a planned-but-absent file as landed. Record the blocked row and hand it to the owner
   named in the output.
3. **Exit 0 → build against the symbols inventoried above**, which are the real ones.

Three consequences of the inventory that Phase 28 plans must respect, because each contradicts
something a 2026-08-05 planner could reasonably have assumed:

- **There is no second CRM.** `packages/backend/convex/contacts.ts` is the only
  person/consent/suppression/follow-up store. REVN-04 attaches provider references to it; it does
  not create opportunities, deal stages or monetary pipeline values — `contacts.test.ts` asserts
  exactly that under `PIPE-01: no second CRM data plane leaked an opportunity concept into the
  substrate`.
- **A pack with a tool allow-list is a LEAF agent.** `runAgentLoop` sets
  `grantDispatch: toolNames === undefined`, so a revenue pack carrying a static grant structurally
  cannot dispatch a specialist. Compose in the Executive Agent, not inside a pack.
- **There is no sixth tenant event plane.** `workflowPackEvents` +
  `packages/core/src/workflowPackMetrics.ts` is the pack telemetry contract, and cost/latency are
  read from their existing owners (`spendEvents`, `telemetry`) rather than re-emitted. REVN success
  measurement extends these; it does not open a new plane.

Two more that bear directly on the revenue lane:

- **Suppression is checked twice, and both sites read `suppressions` only.** `cockpit.executePlan`
  drops suppressed addresses per-recipient *before* the group-mode join and refuses with
  `all_recipients_suppressed`; `gmail.prepareGovernedMessage` refuses again at the wire. REVN-06
  reminder drafts terminate at these, and must not add a third check.
- **Missing credentials throw; they do not degrade.** `requireEnv` / `requireEnvMedia` are the
  idiom a connector adapter must copy. A connector that falls back to a development default would
  be the one thing `p25-no-dev-fallback` exists to forbid.

## Change discipline

Adding a Phase 28 prerequisite means adding a row to `CHECKS` **with symbols**, then re-running
`--self-check`. A row with an empty `files` list and no `posture` key is rejected as unfalsifiable,
and a symbol that can be deleted or renamed without reddening its row is rejected as not
load-bearing.

*Last verified: 2026-08-27*
