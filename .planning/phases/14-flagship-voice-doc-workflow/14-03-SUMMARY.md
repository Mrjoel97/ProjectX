---
phase: 14-flagship-voice-doc-workflow
plan: 03
subsystem: voice-doc
tags: [wave-3, convex-adapter, doc-scope, retrieval, tenant-isolation, refs-only-audit, lane-c]
requires:
  - phase: 14-01
    provides: "voiceSessions.docRef (schema) and the voiceDoc.ts lane-owned stub this plan fills"
  - phase: 14-02
    provides: "RETRIEVAL_CHAR_CAP / RETRIEVAL_MAX_PASSAGES from @pikar/voice's docSession.ts"
  - phase: 10-knowledge-vault-grounding
    provides: "internal.vaultGround.vaultGroundHydrated + its SMOKE:: offline seam and namespace = tenantId isolation"
  - phase: 06-live-voice-sessions
    provides: "voice.startSession / getSession, the watchdog spine, and the refs-only session audit precedent"
provides:
  - "voice.startSession({callId, docRef?}) — an ownership-and-status-validated doc scope, refused at the server"
  - "voiceDoc.searchDocument({sessionId, query}) -> {passages, found} — the doc-scoped mid-call drill-in"
  - "the voicedoc.searched audit eventType, payload {sessionId, queryHash, resultCount}"
  - "the BETA-05 two-tenant convex-test assertion for the voice-doc retrieval path"
affects:
  - "14-04 (mint: declares SEARCH_DOCUMENT_TOOL against this action; reads the same docRef)"
  - "14-05 (producer: fills the rest of voiceDoc.ts alongside searchDocument; the one-audit-call-site rule now has a precedent to extend)"
  - "14-06 (browser relay: calls api.voiceDoc.searchDocument and posts the result as function_call_output)"
  - "14-07 (vault picker: passes docRef into startSession — the UI gate is a courtesy, this is the boundary)"
  - "14-09 (static scan: voiceDoc.ts's ONE payload block and voice.ts's docRef-widened session payload)"
tech-stack:
  added: []
  patterns:
    - "bail-not-throw at a relayed tool boundary: every failure becomes an honest empty result, because a missing function_call_output hangs a voice turn"
    - "collect-then-audit-once: the collector returns [] instead of throwing, so exactly one audit call site covers both the hit and the miss path"
    - "anti-vacuous isolation testing: prove the SAME fixture IS retrievable from the other tenant's own session, so an empty cross-tenant result is a boundary and not a malformed seed"
    - "fetch stubbed to THROW in an offline suite — the no-network claim becomes structural instead of ambient"
key-files:
  created: []
  modified:
    - packages/backend/convex/voice.ts
    - packages/backend/convex/voice.test.ts
    - packages/backend/convex/voiceDoc.ts
    - packages/backend/convex/voiceDoc.test.ts
    - docs/playbooks/voice.md
key-decisions:
  - "startSession validates docRef with a direct ctx.db.get + tenantId compare, NOT internal.vault.getDoc — that query returns {text, contentHash, title} with no `status`, so it structurally cannot answer the readiness half of the check (the plan's key_link premise was factually wrong on two counts)"
  - "Open Question 2 RESOLVED: @convex-dev/rag 0.7.5 DOES support per-entry filters, but using one is a re-embed migration (no filterNames on the shared instance, vaultDocId rides as unindexed metadata), so this phase ships the post-hoc filter with both upgrade paths named"
  - "searchDocument never throws — a thrown relay leaves the model with no function_call_output and the user with silence inside a capped 15 minutes"
  - "the retrieval result is split back into passages on the same blank line vaultGroundHydrated joined them with, so RETRIEVAL_MAX_PASSAGES counts passages rather than documents"
patterns-established:
  - "a relayed Realtime tool takes NO document/scope parameter — the scope is read off the server-side session row, so a prompt injection has nothing to steer"
requirements-completed: []
duration: ~25 min
completed: 2026-07-26
---

# Phase 14 Plan 03: Doc-Scoped Session + Retrieval Summary

**A voice session can now be opened against exactly ONE ready, tenant-owned report and refuses
anything else at the server, and a mid-call query answers from that report alone — with the only new
log-plane row carrying a hash and a count.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-25T21:28:08Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 5 code/doc (+ regenerated graph artifacts)

## Accomplishments

- **`voice.startSession({callId, docRef?})` is the trust boundary for the doc scope.** The document
  must exist, be this tenant's, be `status: "ready"`, and carry non-blank `text`. Anything else
  throws `voicedoc: document not found` (missing / cross-tenant, fail-closed) or
  `voicedoc: document not ready`. Validation runs **first** — before the parallel-session guard and
  before the insert — so a rejected document can never leave an `active` row holding a watchdog
  (asserted: no active session, no scheduled function). The thrown message is a **status, never
  content**. Without a `docRef` the row and the audit payload are byte-identical to the Phase-6
  path, which the test pins with an exact `JSON.stringify` equality.
- **`voiceDoc.searchDocument({sessionId, query})` → `{passages, found}` is SC1's "drill in".** The
  document id is read off the **session row**; the model supplies only free text and the browser
  supplies only a session id, so there is no document parameter to poison. It reuses the frozen
  Phase-10 `vaultGroundHydrated` (whose `namespace = tenantId` is the BETA-05 linchpin) rather than
  reading the book-sized `vaultDocuments.text` blob or forking chunk selection, then drops every hit
  that is not `docRef` and caps the result at 3 passages / 1,200 characters.
- **It never throws.** A missing session, another tenant's session, an ended session, a session with
  no `docRef`, and any unexpected error all return `{passages: [], found: false}`. A tool call the
  browser cannot answer leaves the model waiting with no `function_call_output` and the user hearing
  silence for the rest of a turn inside a capped 15 minutes (Pitfall 5).
- **SC4 starts here and starts clean.** Exactly one `audit.log` call site in the module
  (`grep -c` = 1), `eventType: "voicedoc.searched"`, payload `{sessionId, queryHash, resultCount}` —
  keys asserted **exactly**, `queryHash` asserted to be a 64-hex digest and not the query, and the
  serialized rows asserted free of both the report's words and the `SMOKE::` sentinel. No
  `agentSteps`, no `telemetry`, no `deadLetters`.
- **BETA-05 is proven, not asserted-about.** Tenant A's session searching tenant B's document id
  returns nothing and names tenant B nowhere in the log plane — and, **anti-vacuously**, the same
  seed IS retrievable from tenant B's own session. That makes the empty result a tenant boundary
  rather than a malformed fixture. The drop happens inside `vaultGround`'s tenant-scoped
  `ownedDocsMeta`, exactly where `namespace = tenantId` would exclude it in a real search.

## Task Commits

1. **Task 1: startSession accepts a validated docRef** — `dca467a` (feat; TDD RED confirmed at 3
   failing assertions — `Validator error: Unexpected field docRef` — before implementation)
2. **Task 2: voiceDoc.searchDocument** — `fc5cd19` (feat; TDD RED confirmed on the missing export)
3. **Task 3: the full test matrix + playbook** — `f12da0f` (test)

## Files Created/Modified

- `packages/backend/convex/voice.ts` — `startSession` gains the optional `docRef` arg, the pre-write
  validation block, the row field, and the widened (still refs-only) audit payload.
- `packages/backend/convex/voice.test.ts` — +4 cases and a `seedDoc` helper.
- `packages/backend/convex/voiceDoc.ts` — the stub becomes real: `docScopedPassages` (module-private,
  never throws) + `searchDocument` (`tenantAction`, explicit `Promise<>`, V8 runtime, one audit call).
- `packages/backend/convex/voiceDoc.test.ts` — 2 → 9 tests; the Wave-0 `insertEvaluation` round-trip
  pair is kept intact.
- `docs/playbooks/voice.md` — the `startSession` trust-boundary invariant, the whole
  `searchDocument` section (scope source, never-throws, the §4 payload, the caps), the Open-Question-2
  ceiling with both named upgrade paths, both verify commands, `Last verified` bumped to 2026-07-26.

## Decisions Made

### Open Question 2 — resolved with a real answer, not a shrug

`@convex-dev/rag` 0.7.5 **does** expose per-entry filtering: `new RAG(…, {filterNames})` +
`rag.add({filterValues})` + `rag.search({filters})` (verified against the installed
`dist/client/index.d.ts`, not from memory). It is **not usable today**, for two independent reasons:

1. `vaultRag.ts` constructs the single shared `rag` instance with **no `filterNames`**, and
   `embedDoc` passes `vaultDocId` as `metadata` — which the package documents as *"not indexed or
   filtered or searched"*.
2. The package requires entries to have been **inserted** with the filter values. Adopting the
   filter therefore means changing the shared instance **and re-embedding every existing entry** —
   a migration, not a swap, and `vaultRag.ts`/`vaultGround.ts` are Phase-10-owned and frozen to this
   lane.

So this phase ships the post-hoc filter, and the `ponytail:` comment in `voiceDoc.ts` names the
honest ceiling (a top-K search across the whole tenant vault can miss this doc's best passage when
another document dominates — the `f5c279e` defect shape) plus **both** upgrade paths in cost order.
Explicitly **not** a cache: cost control for voice is time-cap-only by decision (ADR-005).

### Passages are split on the separator `vaultGroundHydrated` joined them with

`vaultGroundHydrated` returns ONE chunk per document, concatenating a document's several matched
passages with a blank line. Filtering to a single `docRef` therefore yields exactly one string, and
`RETRIEVAL_MAX_PASSAGES` (3) would have been dead. Splitting on that same `\n\n` is the honest
inverse of the join and makes both caps mean what they say.

## Deviations from Plan

### 1. [Rule 1 — the plan's stated interface was wrong] `startSession` validates via `ctx.db.get`, not `internal.vault.getDoc`

- **Found during:** Task 1, reading `vault.ts:380` before writing the validation.
- **Issue:** The plan's `<interfaces>` block and its `key_links` entry both specify
  `internal.vault.getDoc` for the ownership + readiness check, described as *"fail-closed: returns
  null when the doc is not that tenant's"*. Both halves are false:
  - `getDoc` **throws** `vault: doc not found` on a cross-tenant/missing doc — it never returns null.
  - `getDoc` returns `{text, contentHash, title}` with **no `status` field**, so it structurally
    cannot answer the `status !== "ready"` half of the required behavior. The only query that
    carries `status` is `getDocForExtraction`, which carries no `text`.
- **Fix:** `startSession` is a `tenantMutation` with direct `ctx.db` access, so it reads the row once
  and checks `doc.tenantId !== ctx.tenantId` / `doc.status` / `doc.text` — which is **this file's own
  existing idiom** (`endSessionClean:183`, `abortSession:221`, `recordUsage:276` all do exactly
  `if (!s || s.tenantId !== ctx.tenantId) throw`). Ponytail rung 2: reuse the pattern already here,
  rather than two internal round-trips that between them still cannot answer the question.
- **Impact:** the `key_links` row `voice.ts → internal.vault.getDoc` is not satisfied and cannot be.
  The behavior it was meant to guarantee — ownership + readiness validated before persistence — is
  satisfied and tested. **Phase verifier: this is the one intentional `must_haves` miss.**
- **Commit:** `dca467a`

### 2. [Rule 3 — blocking, environment] The copied `_generated/api.d.ts` predates `voiceDoc.ts`

- **Found during:** Task 2, at `tsc --noEmit` (53 errors vs. the 52 baseline).
- **Issue:** This worktree has **no `CONVEX_DEPLOYMENT`**, so `npx convex codegen` refuses to run
  (confirmed again this session, including with `--typecheck disable`). `convex/_generated/` was
  copied from the main worktree at 14-01 and its `api.d.ts` module map was generated **before**
  `voiceDoc.ts` existed — so `api.voiceDoc` did not typecheck even though the module does.
- **Fix:** added the two lines codegen itself emits (`import type * as voiceDoc from "../voiceDoc.js";`
  and `voiceDoc: typeof voiceDoc;`) to `convex/_generated/api.d.ts`. The file is **gitignored**, so
  this never entered a commit — it only makes the local gate honest. Back to exactly 52 errors, all
  pre-existing test-file ones, **0 non-test errors**.
- **Explicitly NOT fixed (out of scope):** the same staleness produces the pre-existing
  `voiceToken.test.ts` `mintClientSecret` errors inside the 52. Those are the documented baseline;
  chasing them is not this plan's work.
- **Next Lane-C session:** the cleanest resolution is still `npx convex dev` once, to give this
  worktree its own deployment. Until then, every new Convex module needs this two-line manual
  registration.

### 3. [Rule 3 — blocking] Registering the workflow component to silence stderr made the suite exit non-zero

- **Found during:** Task 3.
- **Issue:** Calling `startSession` several times for one tenant in a single `convexTest` instance
  trips the parallel-session guard, whose force-end schedules `storeBrief` → the ingest **workflow**
  component, which logged `Component "workflow" is not registered` from a scheduled function (noisy
  but harmless). Registering `workflow` + `workpool` (the `voice.test.ts` set) silenced that but
  produced a worse outcome: a teardown-time `ReferenceError: process is not defined` in the vitest
  fork worker, so `pnpm test voiceDoc` exited **1** with `Errors: 1` despite 9/9 passing.
- **Fix:** removed the component registrations and stopped tripping the guard instead — a
  `seedSession` helper inserts the session row directly for the three cases where the session is
  *fixture, not subject* (unscoped / ended / foreign). `startDocSession` (the real public path) is
  still used once per tenant per instance wherever the `docRef` guard is part of what is under test.
  Clean exit, no stderr, and the helper's docstring records the constraint for 14-05.

## Issues Encountered

- **The known parallel-load flake fired again, on a new victim.** The full `pnpm test` run showed
  backend 507/509 — the pre-existing `audit.test.ts` red plus `voice.test.ts > storeBrief …`
  timing out at 5,000 ms. That test takes ~3.4 s in isolation, so it has little headroom under
  full-suite contention. Re-run: **508/509**, sole red the documented `auditCounts` row. Same class
  as the `runCockpitAgent.test.ts` flake 14-01 and 14-02 each recorded once. Not a regression — but
  it is now two different tests, so the shared cause is load, not a specific test.
- **`node scripts/check-playbooks.mjs check` can take >100 s** when the graphify background rebuild
  is running (a commit hook launches one). It exits 0; it just needs a generous timeout.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/backend test voiceDoc` | **9/9** green (was 2; +7 new) |
| `pnpm --filter @pikar/backend test voice` | **12/12** green (was 8; +4 new) |
| Backend full suite | **508/509** — baseline held; sole red the documented pre-existing `audit.test.ts` `auditCounts` row. Was 497/498; **+11 new green** |
| `pnpm --filter @pikar/backend exec tsc --noEmit` | exactly **52** errors, all pre-existing test-file ones (**+0 new**); **0** non-test errors |
| `pnpm --filter @pikar/web typecheck` | exit 0 — no Pitfall-9 API collapse |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `npx biome check` on the 4 changed source files | clean (2 warnings, both pre-existing non-null assertions in untouched `voice.test.ts` lines) |
| `grep -c "audit.log" convex/voiceDoc.ts` | **1** |
| `grep "use node" convex/voiceDoc.ts` | header prose only — no directive (V8 runtime held) |
| Frozen files this plan | `llm.ts`, `evaluations.ts`, `deliverApprovedPlan.ts`, `vaultGround.ts`, `schema.ts`, `run-eval-golden.mjs` — **zero diff** over `324d6c9..HEAD` |
| Diff scope | exactly the 5 files in the plan's `files_modified`, nothing else |

**14-VALIDATION rows now green:** SC1 "doc-scoped session refuses a non-`ready` / cross-tenant
document" (14-03 T1, T3), SC1 "retrieval action returns passages from this doc only, over the
`SMOKE::` seam, no network" (14-03 T2, T3), BETA-05 "tenant A's voice-doc session can never retrieve
or cite tenant B's document" (the 14-03 half).

## User Setup Required

None. `npx convex dev` in this worktree remains optional-but-recommended (see Deviation 2); nothing
in this plan needs a live deployment.

## Next Phase Readiness

- **14-04 (mint):** declare `[SEARCH_DOCUMENT_TOOL]` — the action it names is now real and public as
  `api.voiceDoc.searchDocument`. Read the doc for `buildDocDigest` off the SESSION ROW's `docRef`;
  `startSession` has already guaranteed it is ready, tenant-owned and non-empty, so do **not**
  re-validate and do **not** fail closed on it a second time.
- **14-05 (producer, same file):** `voiceDoc.ts` now has one `audit.log` call site and 14-09 will pin
  a payload-scan against this file. Your `voicedoc.reviewed` row is the second call site — it must be
  as clean as this one, and `citationExcerpt` is illegal in it. Also inherit the never-throw rule if
  your producer is relayed; if it is not, say so explicitly. The `seedSession` helper and the
  one-`startDocSession`-per-tenant-per-instance constraint are already in `voiceDoc.test.ts`.
- **14-06 (relay):** call `api.voiceDoc.searchDocument({sessionId, query})` and post
  `JSON.stringify({passages, found})` back as the `function_call_output`. It never rejects, so there
  is no error branch to write — but there IS a `found: false` branch, and the persona should cover
  it verbally rather than the relay inventing a message.
- **14-07 (picker):** pass `docRef` into `startSession` and surface the two thrown messages as
  user-facing copy. The picker should only offer `ready` docs, but treat that as UX, not safety —
  the server already refuses.
- **14-09 (scan):** `voiceDoc.ts` has exactly ONE `payload:` block, and `voice.ts`'s
  `voice.session_started` payload now legitimately contains `docRef`. The mutation-verified scan
  should plant a `citationExcerpt` and a passage string into the `voicedoc.searched` payload and
  confirm RED.

## Self-Check: PASSED

All 5 modified files exist on disk. All 3 task commits (`dca467a`, `fc5cd19`, `f12da0f`) resolve in
`git log`. `must_haves` artifacts verified: `voiceDoc.ts` 135 lines (min 80) exporting
`searchDocument`; `voice.ts` contains `docRef` (8 hits); `voiceDoc.test.ts` 388 lines (min 120).
`key_links` patterns present in `voiceDoc.ts`: `vaultGroundHydrated` (3 hits), `queryHash` (1 hit).
**One `key_links` row is deliberately unmet and documented as Deviation 1** —
`voice.ts → internal.vault.getDoc` could not implement the required readiness check.

---
*Phase: 14-flagship-voice-doc-workflow*
*Completed: 2026-07-26*
</content>
</invoke>
