---
phase: 19-contacts-crm-follow-ups
verified: 2026-08-10T05:45:00Z
status: passed
score: 8/8 must-haves verified
requirements:
  ACTN-05: complete (code + live browser evidence + owner sign-off)
  PIPE-01: complete (all clauses verified + owner sign-off)
gaps: []
human_verification: complete
---

# Phase 19: Contacts, CRM & Follow-ups — Verification Report

**Phase Goal:** The agent can track contacts / CRM state and follow-ups scoped to the user — read
to resolve people and surface context in-loop, write staged through the plan gate. Widened to
absorb LEADS and CONSENT: the one person store, where suppression, CAN-SPAM and lawful-basis-at-
capture get a home.
**Verified:** 2026-08-10
**Status:** passed (all eight code truths verified; owner judgement and real-inbox delivery signed off)
**Re-verification:** Yes — Plan 19-13 closed the consent-record request-path gap.

## Owner sign-off and live-inbox evidence

On 2026-08-10 the owner approved all seven recorded UAT screenshots for BRAND conformance and
message tone. The owner then authorized and approved one product-email delivery to
`joel.feruzi@gmail.com`, reporting that it arrived with the configured postal address in the
footer and an Unsubscribe link that opened the correct landing page. The final Unsubscribe button
was deliberately not pressed. This inbox result is owner-attested evidence; the automation did
not inspect the owner's mailbox or credentials.

ACTN-05 and PIPE-01 are now checked and marked Complete in `REQUIREMENTS.md`.

## What I verified first-hand

Not read from a SUMMARY. Run or queried in this session:

| Check | Result |
|---|---|
| `pnpm --filter @pikar/core test` | 34 files / **783 passed** |
| `pnpm --filter @pikar/backend test` | 72 files / **1448 passed**, exit 0 (re-measured at 19-13; it was 1446 before `consentRecord` added two cases). **First attempt in that session died with `FATAL ERROR: Zone Allocation failed - process out of memory` and a second reported 8 spurious failures — the shared-vitest-fork memory hazard the harness comment in `contacts.test.ts` already documents, not a regression. The clean run is the third, logged, exit 0.** |
| `pnpm --filter @pikar/backend test contacts` (19-13 re-verification, commit `6a2d23e`) | 1 file / **64 passed** — includes exact consent wording/context, tenant isolation, unauthenticated refusal and audit absence through `api.contacts.consentRecord` |
| `pnpm --filter @pikar/web test` | 10 files / **149 passed** |
| `node scripts/run-eval-golden.mjs --self-check` | **PASSED** — 35 fixtures valid, 12 gated skills |
| `node scripts/check-playbooks.mjs` | **exit 0** (19-13: after `contacts-crm.md`, `dashboard-pages.md` and `cockpit.md` were all bumped for the `gmail.ts` comment fix and the `e2e/pipeline.spec.ts` deletion. An earlier 19-13 pass recorded this row as "qualified/blocking" because those two extra playbooks had not been absorbed yet; they now are, and that qualification is withdrawn.) |
| `pnpm typecheck` | **8/10** — re-measured at 19-13, exit 2. The ONLY errors are `convex/cash.ts(132,9)` and `(150,7)` TS2739, surfaced once by `@pikar/backend:typecheck` and once by `@pikar/web:typecheck`. Concurrent finance lane; not phase 19's. |
| Live DB: `skills:getActiveSkill{cockpit-agent}` | **version 18**, skillId `kh74zgpwx8y9qs98dhdje2fncn8c424a`, **28,368 chars, sha `6ca4d937639c`** — exactly as claimed, and **byte-identical** to `packages/contracts/skills/cockpit-agent.md`. It teaches `stageCrmWrite`. |
| `npx playwright test e2e/pipeline.spec.ts --no-deps` | **1 failed / 1 did not run** — its own documented empty-tenant precondition. **RESOLVED at 19-13: the spec is DELETED.** See W6. |
| UAT evidence on disk | 7 PNGs + `spend.json` (`"events": 4, "usd": 0.04`) + `tenant.txt`, all timestamped 04:34–04:36 today. A real, measured run. |

## Goal Achievement

### Observable Truths (the eight ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Agent reads CRM state in-loop; a CRM write stages into the plan and executes only via Approve | ✓ VERIFIED | Read: `llm.ts:1808 resolveContacts → internal.contacts.savedForName` (an `internalQuery`, L862). Write: `stageCrmWrite → patchPlan(kind:"crm_write", status:"proposed")`; apply lives only in `executePlan`'s inline arm (`cockpit.ts:717`). Proven **live in a browser**: UAT step 5 (card, no email chrome, Approve → done) and step 7 (a dated `addFollowUp` with a finite `dueAt`, asserted off the plan row, not the DOM). |
| 2 | Tenant-scoped and unreachable across tenants; isolation assertion ships with the surface | ✓ VERIFIED | `contacts.test.ts` asA/asB block over all ten public functions, paired positive/negative. `consentRecord` uses a REAL id tenant A created: B gets `CONTACT_NOT_FOUND`, while A receives the wording from the same database. The unauthenticated case also uses a real id. An export-set pin fails if an eleventh public function ships without an isolation test. |
| 3 | CRM reads/writes log refs/ids/counts only | ✓ VERIFIED | One audit site in the module (`unsuppress`). Asserted by **key-set equality** (`Object.keys().sort()`), not substring, plus a structural single-site scan in `llmRedaction.test.ts`. `contactId` is `null` rather than absent so the key set cannot vary with the data. |
| 4 | Row carries `origin` / `consentAt` + `consentSource` / `unsubscribedAt`; **the consent record is reproducible on request — wording, timestamp, capture context** | ✓ **VERIFIED** | `contacts.consentRecord({ contactId })` is a public `tenantQuery` bounded to one `ctx.db.get`. It returns `{ at, source, wording, context }`, `null` when no consent exists, and explicit nulls for unrecorded content fields. The public-query test reproduces the exact wording/context written by `assertConsent`, pins the timestamp to the stored row, proves foreign/anonymous refusal, and proves the read adds no audit payload. Focused re-run: **64/64 passed**. |
| 5 | Suppression check lives in the SEND path, address-by-address, with a test that proves it there | ✓ VERIFIED | Two guards, both load-bearing. `executePlan` partitions with `suppressedAmong` **before the group join and before the CAS** (`cockpit.ts:851-880`); `gmail.send` carries the unbypassable backstop (`gmail.ts:175-181`) reached by **both** production callers, each handling the `suppressed` terminal explicitly. Reads `suppressions` and never `contacts` — a separate address-keyed table, so a contacts bug structurally cannot un-suppress anyone. Mutation-verified (moving the guard below the CAS reddens). |
| 6 | `tenantProfiles` gains a postal address; the drafter cannot omit the footer | ✓ VERIFIED | `schema.ts:1306`. Footer applied at the `buildMime` **call site** and **fails closed** — a missing footer throws rather than sending (`gmail.ts:231-243`), mirroring the missing-attachment throw. Pre-CAS `no_postal_address` refusal on approve. Asserted on the MIME bytes; `notifyExternal`'s service notice stays footer-free (V4 byte-identity intact). UAT steps 4 and 10. |
| 7 | The phase states IN WRITING why a contacts table does not violate "no contacts cache at rest" | ✓ VERIFIED | `docs/playbooks/contacts-crm.md` invariant 1 (L177) plus a gravestone comment on the schema block; registered in `watch.json`; `check-playbooks.mjs` exit 0. The playbook itself states that invariant 1's structural half has no automated enforcement and lists that as a gap — honest. |
| 8 | A narrow connected Pipeline route over this one store; no opportunities, stages, money or second data plane | ✓ VERIFIED | `PipelineView.tsx` (739 lines) over three bounded reads, one `useQuery` per section. Structural scan for `amountCents`/`opportunit`/`\bstage\b` across `convex/contacts.ts`, `core/src/contacts.ts` and the three schema blocks, comment-stripped, **with an explicit non-vacuity floor** (sources must load above a size threshold AND the regex is shown to match a real violation). Nav stays `soon: true`; the route is URL-only, so 26-18 still owns the flip. |

**Score: 8/8 verified. Owner judgement and the real-inbox delivery gate are complete.**

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `core/src/index.ts` | `core/src/contacts.ts` | barrel re-export | ✓ WIRED |
| `convex/contacts.ts` | `lib/functions.ts` | `tenantQuery`/`tenantMutation` — no raw builders (CLAUDE.md §2) | ✓ WIRED |
| `convex/contacts.ts` | `core` `normalizeAddress` | one identity function shared by contacts, suppressions and the guard | ✓ WIRED |
| `convex/contacts.ts` | `internal.audit.log` | refs-only payload on `unsuppress` | ✓ WIRED |
| `cockpit.ts executePlan` | `internal.contacts.suppressedAmong` | pre-join, pre-CAS | ✓ WIRED |
| `gmail.ts send` | `internal.contacts.{isSuppressed,footerFor}` | between `getForDelivery` and `buildMime` | ✓ WIRED |
| `http.ts` | `internal.contacts.{resolveUnsubToken,suppressFromUnsubscribe}` | inert GET, mutating POST only | ✓ WIRED |
| `llm.ts buildCockpitTools` | `schema.ts agentSteps.tool` | `stageCrmWrite` literal + `cards.tsx` VERB, asserted both ways | ✓ WIRED |
| `llm.ts resolveContacts` | `internal.contacts.savedForName` | saved-contact READ that never writes | ✓ WIRED |
| `executePlan` | `plans.withheldRecipients` → `withheldNote()` → cockpit card **and** Approvals row | the withheld report as a persisted fact | ✓ WIRED |
| all 5 web callers | `useSendCockpitMessage.ts` | trusted clock on every browser turn | ✓ WIRED |
| `contacts.ts assertConsent` | `api.contacts.consentRecord` | bounded point read through `tenantQuery`, exact content-plane reproduction, no audit write | ✓ WIRED (19-13) |

## The six defect closures — confirmed, not taken on trust

1. **`internal.gmail.send` had two production callers.** ✓ **Closed.** Both `deliverApprovedPlan.ts:37` and `pipeline.ts:379` handle the `suppressed` reason and terminate the row (`recordDeliveryTerminal` / `blocked`) rather than stranding it at `delivering`. The guard is inside the action, so the second caller was covered from the moment it landed; the fix was making the terminal honest at both sites. *(Stale comment remains — see W3.)*
2. **`llm.ts` falsely claimed compile-time coverage.** ✓ **Corrected honestly** at `llm.ts:1093-1099`: the comment now says plainly that `PlanRow` never declares `kind`, that `media` proved it by shipping without reaching the union, and that a new action type must be added by hand. No compile-time guard was added and none is claimed. *(No test enumerates ACTION_TYPES against the context branches — see W7.)*
3. **`eval:golden --self-check` red since Phase 20.** ✓ **Green** — I ran it: 35 fixtures, 12 gated skills. The `media-director` exemption is now **derived** from `skill.ts`'s written justification rather than re-listed, with two non-vacuity assertions pinning the derivation. *(The structural half — `runLive()` still never calls `selfCheck()` — is deliberately open and logged; see W4.)*
4. **Trusted clock `undefined` in `runAgentLoop`.** ✓ **Closed at the shared seam.** `llm.ts:4146` passes `effectiveClientContext` into the loop's own tool build, and `useSendCockpitMessage.ts` is the single browser door for all five callers. Guarded two ways: an app-tree scan in `crmCard.test.ts` (with its own non-vacuity test) and, crucially, UAT step 7 — the only observer that can see this class of bug, because every offline layer supplies its own clock.
5. **No web caller sent `clientContext`.** ✓ **Closed.** Five callers verified by grep, all routed through the hook; `Date.now()` read at call time inside `useCallback`, `tz` degrading to `"UTC"` so a `v.string()` cannot throw the turn away.
6. **The withheld-recipients report was unreachable.** ✓ **Closed.** `plans.withheldRecipients` (schema L268), written by `executePlan` in the same patch as the counters, rendered by one pure `withheldNote()` on both post-approve surfaces. The dead `res.withheld → setNote` branch is gone. Unit-asserted both ways (present and absent) and browser-asserted at UAT step 9(b).

## Applying the "green and meaningless" lens

The phase found five instances of that pattern. I looked for a sixth and mostly did not find one — the suites here are unusually self-aware:

- The no-opportunities scan ships a **non-vacuity floor** (source must load above a size threshold; the regex is shown to match a real violation).
- The isolation block is **paired** — every "B sees nothing" has an "A sees exactly one" beside it.
- The group-drop test uses **three** recipients deliberately, because with two the joined string contains the survivor either way.
- The contacts-first test's "zero header searches" assertion is made non-vacuous by a sibling test proving the header path DID run with nothing saved.
- Fixture 36 documents its own two prior vacuous greens and the exact hole each one hid.
- UAT step 7 asserts off the **plan row**, not the DOM, and step 9(a)'s blanket "appears nowhere" was **narrowed rather than weakened** once 9(b) made the blanket form logically impossible.

Where the lens does bite:

- **The eval gate's 35/35 is a splice of two runs.** Gate `086f8267` (35/35, $0.3505) ran at 19-09 — **before** `datedFollowUpCount` existed (19-10) and **before** the tool-shape fix (19-11). Fixture 36 was then re-verified **alone** (`--only 36`, run `0b2b6b22`, $0.0057, PASS). The skill body is byte-unchanged so the *body's* certification legitimately stands, but **no single run has ever been green across all 35 cases with the strengthened key and the post-19-11 code.** The risk is small (only fixture 36 touches CRM) but it is not zero, and "35/35" reads as one run when it is two.
- **`__seedOnboardedTenant`'s postal address is still reasoned, not observed.** `onboarding.ts:654` seeds it with a comment naming the nine specs that would fail without it. Only five specs call the seeder, and no run of the other e2e specs was performed in this session or recorded in the phase docs. Harmless — the seeder is correct either way — but the "nine specs" figure remains an inference.

## Anti-Patterns and Warnings

| # | File | Severity | Finding |
|---|---|---|---|
**Every warning below was written before Plan 19-13. W1, W2, W3 and W6 are CLOSED — their
"Resolution" line is the only part of the row that is current. W4, W5 and W7 remain open and are
deliberately not closed (W5 is recorded as a caveat rather than paid for; W4 and W7 are logged
deferrals). Nothing here was closed by weakening an assertion.**

| # | File | Severity | Finding |
|---|---|---|---|
| W1 | `19-VALIDATION.md` | ✅ **CLOSED (19-13)** | **Stale and now actively false.** Frontmatter says `status: closed-out (offline); owner browser UAT PENDING`; the body says "**So: 22/22 green and ACTN-05 is still not met**", "fixture 36 is now RED against the active body", "a full gate is 34/35", and the manual-verification row reads **NOT RUN**. All three were overtaken by 19-11 and 19-12. Plan 19-10's must-have (22 rows filled, none blank) *is* satisfied — but a reader landing on this file today gets the wrong answer about the phase's headline capability. **RESOLUTION (19-13):** every false sentence in that file is corrected in place, struck through with a superseding line, or replaced — the frontmatter status, the ACTN-05 verdict, the fixture-36 RED box, the browser-gate paragraph, the per-row test counts, the manual-verification row and the sign-off box. The two caveats (the spliced 35/35 and the `__seedOnboardedTenant` inference) are recorded there plainly rather than closed. |
| W2 | `docs/playbooks/contacts-crm.md` | ✅ **CLOSED (19-13)** | The 19-12 `Last verified` line names **no sha**. 19-10's must-have was "the Last verified line names the commit the whole phase was verified against"; the 19-10 line carries `@ 12bde78`, the two newer ones carry only a date. The 19-11 block also still reads "The owner browser UAT still has not run" without a superseded marker (the 19-12 block above it corrects it, but only by ordering). **RESOLUTION (19-13):** 19-12's line now carries `@ d575b3f` (the last 19-12 commit, and the tree the 15/15 UAT ran against), 19-11's carries `@ b73bff8`, the new 19-13 line carries `@ 6a2d23e`, and 19-11's stale UAT sentence is struck through with an explicit SUPERSEDED marker rather than left to ordering. |
| W3 | `gmail.ts:167` | ✅ **CLOSED (19-13)** | Comment still asserts "(deliverApprovedPlan.ts is the sole caller of this action)" — the precise false claim defect #1 was about. Functionally harmless; the guard is inside the action. The sentence should go. **RESOLUTION (19-13):** it is gone. The comment now names BOTH callers (`deliverApprovedPlan.ts:37` and `pipeline.ts:379`), records that an earlier version claimed a sole caller, and tells the next reader to grep the callers rather than trust the sentence. Verified by grep: those are the only two non-test `internal.gmail.send` call sites. No behaviour changed. |
| W4 | `run-eval-golden.mjs` | ℹ️ Info (logged) | `runLive()` still never calls `selfCheck()`, so the offline gate can go silently red again exactly as it did for two phases. Deliberately deferred and recorded in `deferred-items.md`. |
| W5 | eval gate | ⚠️ **OPEN — recorded, deliberately NOT paid for** | The spliced 35/35 described above. 19-13 states it plainly in `19-VALIDATION.md` rather than spending $0.35 on a gate to erase it. The 19-13 spend ceiling was $0.00 and was met. |
| W6 | `apps/web/e2e/pipeline.spec.ts` | ✅ **CLOSED (19-13)** | **Not re-runnable — I ran it and it failed** (1 failed, 1 did not run, serial). Its own header documents this: the shared e2e tenant is no longer empty, so test 1's precondition can never hold again. It is a one-shot receipt, not a regression guard. Fully superseded by `pipeline-uat.spec.ts` steps 1+2 and 3, which provision throwaway tenants through the real `/signup` form and assert strictly more (including the `soon: true` nav pins). Recommend deleting it or giving it the reset seam its own `ponytail:` note describes — carrying a permanently-red spec is worse than carrying neither. **RESOLUTION (19-13): DELETED**, along with its `watch.json` entry under `dashboard-pages.md`. The reset seam was NOT built — `pipeline-uat.spec.ts` already signs up throwaway tenants through the real `/signup` form, which is the same seam by another route, and `pipelineView.test.ts` covers the two assertions the UAT does not carry (the two-click un-suppress arming, and the empty state having no mailbox suggestions). `contacts-crm.md`, `dashboard-pages.md` and `cockpit.md` all record the deletion. |
| W7 | `llm.ts buildAgentContext` | ℹ️ Info | No test enumerates `ACTION_TYPES` against the context branches, so a sixth action type still gets announced to the model as an email. The comment says so plainly; the cheap guard (iterate `ACTION_TYPES`, assert each yields a non-email header) does not exist. Not a phase-19 gap — `crm_write` has its branch and is covered — but it is the same shape of trap that produced the `media` miss. |

## Environmental caveat (NOT a phase-19 gap)

`packages/backend/convex/cash.ts` has 2 × TS2739 from the concurrent finance lane (`CashInputState`
missing `origin`, `actor`, `basis`). Confirmed by running `pnpm typecheck`: **8/10 tasks green, the
only failures trace to that file.** It also blocks `convex deploy` and the web production build;
the watcher on `:3210` is currently running with `--typecheck=disable`. `graphify-out/*` is dirty
from before this session. Neither is phase-19 work.

## Gaps Summary

**No code gap remains. Plan 19-13 closed SC#4's second sentence with the smallest request path.**

Everything else in this phase is real. The substrate is three tables with the right split (the
send-path guard reading `suppressions` and only `suppressions` is genuinely the thing that makes
SC#5 clean rather than merely implemented). The guards are doubled where a single guard would have
a hole, and both halves are mutation-proven. The tool is registered, gated, taught by an active
body I confirmed byte-for-byte against the DB, and — the part that matters most, given this
phase's own history — **proven to work from a real browser turn**, not from a fixture that supplies
its own clock. ACTN-05 is met.

`consentRecord` reads exactly one contact through `ctx.db.get`, then enforces the authenticated
tenant before returning the exact stored wording, timestamp, source and context. The public-query
tests prove the positive record, no-consent null, absent-context null, foreign-tenant and anonymous
refusals, and the absence of any new audit payload. The point-read ceiling and whole-book export
upgrade path are now written in `contacts-crm.md`, so the compliance record is reachable without
quietly widening this gap closure into an export feature.

The human gates are complete: the owner approved the seven UAT judgements and attested that the
authorized product email arrived with its postal footer and working unsubscribe landing-page link.
ACTN-05 and PIPE-01 are checked and marked Complete in `REQUIREMENTS.md`; Phase 19 has no remaining
implementation, verification, or owner-sign-off gap.

---

_Verified: 2026-08-10_
_Verifier: Claude (gsd-verifier)_
