---
phase: 36-smoke-sentinels-out-of-band
plan: 01
status: complete (code + unit proof); re-drive status in §Re-drive
completed: 2026-09-06
commits: [see the phase-close commit's parent — feat(36-01)]
requirements-completed: [G24 — in-band fixture sentinels out of band]
requirements-pending: [none in code; production must keep both fixture-tier names unset]
---

# 36-01 — Fixture selection is an operator fact about WHO

**The rule, shipped (ADR-035).** Every `SMOKE::` gate on a production path is now
`prefix && fixtureSeamFor(tenantId)`. `fixtureSeamFor` (`lib/models.ts`) = `offlineSeamAvailable()`
(the 2026-08-28 keyless opt-in) OR `isFixtureTenant(PIKAR_FIXTURE_TENANT_IDS, tenantId)` (`lib/env.ts`, an
exact, trimmed, comma-separated allowlist, `fixture`-tier in `ENV_MANIFEST`). The sentinel only SELECTS a
fixture; WHETHER one may run is a fact about the deployment that only its operator can set. Dev lists the
e2e user and `"smoke"`; production lists nothing.

**Sites converted (14 files, ~20 gates).** Vault ingest chain: `vaultLlm.extractGraph` (a Drive file a
stranger shared in could write the tenant's entity graph), `vaultLlm.classifyDoc` (attacker-chosen
classification + identity line), `vaultRag.embedDoc` (a `ready` row with no vector), `vaultExtract`,
`vaultTranscribe`, `vault.vaultSearch`. Model-composed tool arguments: `gmail.search` (fabricated mailbox
evidence — the worst site in the 29 register), the two Drive tools in `llm.ts`. Send arms: `gmail.send` /
`graph.send` `SMOKE::fail`. Cockpit grammars: `parseSmoke(text, tenantId)` (8 call sites; `draftCockpit`
and `draftDocument` now destructure `tenantId`), `parseAgentSmoke(text, tenantId)`, the forced agent
timeout. Tenant-typed: `onboarding` ×2, `intake` ×2. The four sites already on `offlineSeamAvailable()`
(`vaultGround`, `vaultDigest`, `knowledgeLlm` ×2, `voiceDoc`) moved to the WHO predicate so one rule holds
everywhere and `knowledge-search.spec.ts`'s offline mode can run on keyed dev.

**Readiness (owner decision).** `ops.envCheck.ready` additionally requires `fixturesActive.length === 0`;
`AdminView`'s not-ready headline names the count. A production deployment carrying either
`PIKAR_OFFLINE_FIXTURES` or `PIKAR_FIXTURE_TENANT_IDS` is red on `/admin`.

**Proof (`fixtureSeam.test.ts`, 17 tests).** The predicate table (membership rules; keyless+opt-in =
everyone, keyed+no list = nobody, keyed+list = exactly the listed, and the opt-in does not widen the list
on a keyed deployment). Per site, BOTH directions on a keyed deployment: unlisted → the real path
(`resolveModel` mocked to throw a marker; the embedding path reaches the `rag` component / a stubbed
transport; `gmail.search` returns `not_connected`; the Drive tools fall through; both parsers return
`null`); listed → the fixture (the graph edge, the classify line, `smoke::<hash>`, the two header records,
the sentinel ids, "Smoke folder"/"Smoke result", the parsed ops). Plus a leak guard restoring the
suite-wide consent. `env.test.ts` gained the fixture-active ⇒ not-ready test; `knowledgeLlm.test.ts`'s
source scan pins the new first conjunct; `cockpitTools.test.ts`'s parser round-trips pass a tenant;
`voice.test.ts` plants its Realtime key with `vi.stubEnv` and allow-lists its tenant (the dev shape).

**What did NOT change.** Every sentinel grammar, every fixture body, the 13 sentinel-driven browser
specs' typed strings, the four smoke scripts' payloads, the suite-wide keyless consent in
`vitest.config.mts`, the eval runners (they already reject sentinel turns).

**Measured.** backend two shards 67 files / 2033 tests + 67 files / 1954 tests, both exit 0 (the first full run showed `proactiveReview.test.ts` hitting the timer-pump ceiling ONLY under load — root cause: `voiceToken.test.ts` and `profileRedaction.test.ts` planted a raw `process.env.OPENAI_API_KEY` that leaked into later files in the worker, and under the new rule a leaked key closes every sentinel gate downstream; both converted to `vi.stubEnv` + `unstubAllEnvs`, re-run green); `fixtureSeam.test.ts` 17/17; web 47/49 files with the two known jsdom-install artifacts of this worktree (green on CI), `adminPresentation.test.ts` 10/10; repo typecheck 12/12; `pnpm lint --diagnostic-level=error --max-diagnostics=none` exit 0.

**Docs.** ADR-035; playbooks vault, cockpit, intake, onboarding, voice, knowledge-search-routines,
production-beta, beta-admission bumped; `watch.json` registers `fixtureSeam.test.ts` under
production-beta; `29-SMOKE-SEAM-DEBT.md` closed with a pointer; ROADMAP Phase 36 inserted.

## Re-drive (definition of done: the 13 browser specs + 4 smoke scripts on the local deployment)

**Setup (2026-09-06, owner-approved takeover).** The shared tree's stale `convex dev` + local backend +
`next start :3111` were stopped; `convex dev` now runs DETACHED from the release worktree (`.convex`
junctioned to the shared tree's data, `.env.local` copied), the release build serves on `:3112`, and the
local deployment carries `PIKAR_FIXTURE_TENANT_IDS = <e2e-wave6 id>,<e2e id>,smoke,smokeA,smokeB,smokeBudget`.
The local deployment holds BOTH model keys, so this is exactly the keyed-deployment case the allowlist exists for.
`skills:seedSkills` was run there (the Phase 29 planner rows were absent — the 2026-08-30 finding again).

**Seam evidence (the point of the re-drive), all on the keyed local deployment:**
- `vault.spec.ts` 4/4: paste → `SMOKE::graph::` fixture → entities Alice/Acme/works_at; `SMOKE::extract::` and
  `SMOKE::transcribe::` uploads → ready → entities. Sites #1–#5 open for the listed tenant, live.
- `cockpit-activity` 2/2 and `cockpit-created-document` 3/3: the `SMOKE::agent::` / `SMOKE::route=` grammars
  parse for the listed browser tenant (site #11/#12).
- `mailbox.searched` audit rows for the e2e tenant with `resultCount: 2` during `cockpit-resolve`: site #6
  served its fixture records live.
- The fanout smoke's dead letter `SMOKE_FAILURE: forced fan-out send failure` for tenant `smoke`: the send-arm
  gate (site #10) fired for the listed tenant.
- Zero `spendEvents` rows for the e2e tenant across the whole run: no sentinel turn reached a real model.
- **The negative direction, found live:** `smoke:guardrails` uses tenants `smokeA`/`smokeB`/`smokeBudget`, which
  were NOT yet listed — its `SMOKE::route=` goals went to the REAL model and produced model-written drafts
  (rows `grd-cacheHit-…` in `requests`). That is the rule working as designed and the reason the allowlist
  now names all four smoke tenants. It also confirms the debt register's warning: converting the seam moves
  every consumer, including scripts nobody had re-run.

**Pass results (`scratchpad/redrive/*.log`):** vault 4/4 · cockpit-activity 2/2 · cockpit-created-document 3/3
· vault-redesign 0/1 (needs `NEXT_PUBLIC_CONVEX_URL` in the runner env — fixed in the runner, not re-run) ·
intake 0/2, cockpit-attachment 0/2 (composer placeholder drift — the seven specs are repointed to "What
business outcome should we work on?", not re-run) · knowledge-search 0/4 (unseeded planner — seeded, not
re-run) · cockpit-briefing 0/1, cockpit-personalize 0/1, cockpit-report 0/1, cockpit-resolve 0/2,
cockpit-schedule 0/2, skill-authoring 0/1 (NOT triaged; no backend error and no model spend during any of
them, so they read as workspace-UI drift since the specs were last run, but that is inference) · smoke
pipeline and smoke fanout: the review gate and the forced failure worked, but the non-fail deliveries for
tenant `smoke` ended `failed` instead of `awaiting_reauth`, with no dead letter and no backend error line —
**NOT triaged, and it sits on the delivery path**; smoke guardrails: stopped mid-run (real spend, see
above); smoke vault: not run.

**Spec repairs landed (drift, not seam):** `vault.spec.ts` — serial mode (`fullyParallel` reordered a
shared-tenant file), the profile document now counts as a vault file (zero-state moved to the category's),
folder-picker inputs, the disabled voice-action button sharing the card's name, dialog title, "Entities &
citations", chip text "<name> <type>", two-step removal, search term persisting after the modal; seven
cockpit/intake specs — the composer placeholder.

**Status: the re-drive is PARTIAL.** Definition of done (full green) is NOT met. Next session, in order:
(1) triage `smoke:pipeline`'s `failed` terminal on local (`requests` row for the cid, `deliverApprovedPlan`
run, `gmail.send` path with no token) before anything is promoted; (2) re-run `vault-redesign`, `intake`,
`knowledge-search`, `cockpit-attachment` with the fixed runner (`scratchpad/redrive36b.sh`); (3) triage the
remaining cockpit specs against the current workspace UI; (4) `smoke:guardrails` and `smoke:vault` with the
widened allowlist. Nothing from this phase has been pushed.

## Owner steps

- **Dev / local:** `npx convex env set PIKAR_FIXTURE_TENANT_IDS "<e2e user id>,smoke"` on every
  deployment the browser or smoke suites run against. The e2e user id is `requireTenant`'s subject
  (the JWT `sub` before `|`); `media-canvas.spec.ts` shows the read, or look the user up by email.
- **Production:** nothing to set. Confirm `/admin` shows nothing under "Fixture seams ACTIVE"; if it
  ever does, the headline now reads NOT ready.
