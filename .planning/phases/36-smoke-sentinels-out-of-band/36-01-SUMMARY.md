---
phase: 36-smoke-sentinels-out-of-band
plan: 01
status: complete (code + unit proof + full local re-drive, 13/13 specs + 4/4 smokes)
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

**Pass results — FINAL (2026-09-06, second session; logs under `scratchpad/redrive/*.{c,e,f,g,h}.log`):**
vault 4/4 · vault-redesign 2/2 · intake 3/3 · knowledge-search 6/6 (+2 skipped: `PIKAR_E2E_KNOWLEDGE_MODE` live-only cases)
· cockpit-activity 2/2 · cockpit-attachment 3/3 · cockpit-briefing 2/2 · cockpit-created-document 3/3 ·
cockpit-personalize 2/2 · cockpit-report 2/2 · cockpit-resolve 4/4 · cockpit-schedule 3/3 · skill-authoring 3/3
(+1 skipped: `PHASE21_LIVE_RESULT_PATH` live checkpoint) · smoke:pipeline PASSED (3 legs) · smoke:fanout PASSED ·
smoke:guardrails PASSED (7/7) · smoke:vault PASSED. **13/13 specs + 4/4 smokes.**

**What the second session found and fixed (none of it the seam — every failure was a consumer that had
drifted since it was last run, which is exactly the debt register's warning):**
- `smoke:pipeline` / `smoke:fanout` `failed` terminal: the dead letter WAS there (`convex data`'s default row limit
  had hidden it) — `send: no unsubscribe footer could be built`. 19-05 made the CAN-SPAM footer a precondition of
  every send, ordered BEFORE the token check, and seeded the e2e tenant's postal address at its one seeder; the
  smoke tenants never got one, so both smokes had been red since 19-05. Fixed at the one smoke seeder
  (`ensureSmokePostalAddress`, smoke.ts), a real tenant's row is never touched.
- `smoke:guardrails` step 5 `at "blocked"`: the first pass was stopped mid-step and its `finally` reset never ran,
  leaving `smokeBudget` drained; `smoke:resetDailySpend` by hand, then 7/7.
- Composer sequencing (16 sites, 10 specs): `ChatPane.onSend` clears the box on SEND (03.9-04) and drops a second
  Enter while busy, so `toHaveValue("")` no longer meant "turn settled" — the second op sat in the box with no
  backend error. Every site now also waits for the "Working…" button to have count 0.
- Tenant-id key: five specs passed the FULL JWT `sub` to the fixture seeders; `requireTenant` keys on the part
  before `|` (2026-07-21), so the seeded inbox/calendar fixtures were unreachable (`briefInbox` → "mailbox isn't
  reachable"). Nine other specs already split; the five now do.
- `cockpit-report`: still written against the guided slot-filling FSM retired at 3.2.1 (a plain first turn now goes
  to the REAL model); moved onto the `SMOKE::agent::` ops and onto the rendered `awaiting_reauth` label.
- `cockpit-resolve`: single-match sections PRE-SELECT their chip; the spec's click un-picked it. The chip gained
  `aria-pressed` (its picked state was colour-only — BRAND §6) and the spec asserts the pick through it.
- `cockpit-schedule`: 2035 is beyond the SCHD-01 7-day horizon (`send_time_too_far`); now +2 days.
- `cockpit-briefing`: SC-4 control count rescoped to `briefing-body` (the masthead toggle is view chrome, 03.10-04).
- `intake` dictate: the transcript renders with its address REDACTED (`[EMAIL_1]`); the regex matched the raw address.
- Strict-mode duplicates (`.first()`): addresses/subject on the plan and report cards, the draft's `<p>` + `<pre>`,
  the CANCELED heading + sentence.

**Local-run facts that were NOT defects (recorded for the next re-drive):** the four smoke scripts are `convex run`
loops and break `auth.setup` when run CONCURRENTLY with a browser pass (run smokes first); `awaiting_reauth` and the
SCHEDULED path need a synthetic `gmailTokens` row staged BEFORE the browser session (`gmailAuth:store` from the CLI)
and that same row must be ABSENT for `knowledge-search`'s offline gap states and `cockpit-briefing` (delete it with
`gmailAuth:deleteTokens` between the two groups); `skill-authoring` needs the harness user provisioned as OWNER
(`PIKAR_E2E_PROVISION=1`). A mid-session `convex run` did NOT end the browser session on this stack (the earlier
note was overstated). Seven orphan `inboxFixtures` rows keyed by full-`sub` ids remain in the LOCAL dev DB from the
pre-fix seeds; no reader matches them.

**Status: the re-drive is COMPLETE — definition of done (code + full re-drive on dev) met.** Promoted in the
phase-close commit that follows.

## Owner steps

- **Dev / local:** `npx convex env set PIKAR_FIXTURE_TENANT_IDS "<e2e user id>,smoke"` on every
  deployment the browser or smoke suites run against. The e2e user id is `requireTenant`'s subject
  (the JWT `sub` before `|`); `media-canvas.spec.ts` shows the read, or look the user up by email.
- **Production:** nothing to set. Confirm `/admin` shows nothing under "Fixture seams ACTIVE"; if it
  ever does, the headline now reads NOT ready.
