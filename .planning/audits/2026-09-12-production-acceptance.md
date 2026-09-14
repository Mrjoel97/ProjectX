# Production acceptance follow-up — 2026-09-12

This continues [the merged audit review](2026-09-10-merged-audit-codebase-review.md) and
[the live acceptance record](2026-09-10-live-acceptance-continuation.md). Results below are
bounded observations, not completion of Phases 23, 30, 31 or the provider lanes.

## Verified release

Commit `1127573adb2ae8982e416dfd146eb1609e44711e` was committed and pushed to main.
CI [34684218302](https://github.com/Mrjoel97/ProjectX/actions/runs/34684218302) and production
deployment [34684438168](https://github.com/Mrjoel97/ProjectX/actions/runs/34684438168) succeeded.
The durable production probe passed at `08:56:32Z`; GitHub production deployment `6407878477`
reported success at `08:56:36Z` for `https://www.pikar-ai.com` and that exact commit.

Follow-up commit `000bbace92b12c59f19e2d0e97db8eef666b74e6` also passed full
CI [34685394403](https://github.com/Mrjoel97/ProjectX/actions/runs/34685394403) and production
deployment [34685680915](https://github.com/Mrjoel97/ProjectX/actions/runs/34685680915).
Its durable probe passed at `09:25:06Z`; deployment `6408100993` reported success at
`09:25:09Z`. This promotes the parser, notice and caption-copy repairs described below.

Exact-plan navigation release `0c258885e51181f2b76b2394a0538a27cb0b376b` passed
CI [34687054541](https://github.com/Mrjoel97/ProjectX/actions/runs/34687054541) and deployment
[34687271971](https://github.com/Mrjoel97/ProjectX/actions/runs/34687271971). The durable probe
passed at `10:02:23Z`; production deployment `6408389517` reported success at `10:02:26Z`.

The later research-control release `93d905d5ae652d6996ed3f0080b968da6f8f156a` passed full CI
[34756673585](https://github.com/Mrjoel97/ProjectX/actions/runs/34756673585) and production deployment
[34756978362](https://github.com/Mrjoel97/ProjectX/actions/runs/34756978362). The workflow checked out
that exact SHA, deployed Convex, promoted Vercel deployment `dpl_9Cj3xrYCCNYGALV5VnfPr3b7uE2h`
and successfully fetched `https://www.pikar-ai.com`. This is release evidence for the request-level
page-read controls; their signed-in behavioral acceptance remains separate and open.

The full backend qualification before the final acceptance repairs passed 4,358 tests.
The subsequent research repair passed 392 affected tests, media terminal repair passed 324,
and media UI repair passed 142. CI then qualified the complete committed tree. The strict
local Convex dry-run passed with native TypeScript enabled and no deleted indexes. Earlier
compiler lookup failures led to declaring the existing TypeScript version in the backend.

## Media: failure made durable, successful video still absent

The single accepted synthetic render used plan `p573bm94xqt94mkv299msgcby98e932n`, thread
`m57dytskag9wah3zjy2d63d4q18e9sg0`, and batch `8568f695-a20b-4072-9144-d9ed1796bbf7`.
Two voice jobs were blocked by `tts_not_verbatim`; the submission path had left the parent
pending. No retry, external send, or weakening of the integrity check was performed.

At `08:57:44.731Z`, the reviewed bounded reconciliation verified the exact plan and terminal
batch, then recorded `renderStatus=failed`, `renderReason=incomplete_batch`,
`captionStatus=failed`, and `captionReason=incomplete_takes`. It cannot schedule rendering,
transcription or another provider purchase. The browser subsequently showed failed voice,
assembly and caption states instead of the unrelated email Sending/recipient report.

That browser inspection exposed another presentation defect: captions copy said the reel was
published even though no video existed. The follow-up copy repair requires a current rendered
artifact and validated URL before saying a reel is ready without captions; otherwise it reports
caption failure alone. It passed 145 focused tests and web TypeScript before promotion.
The failed voice attempt is not completed-video, sidecar, Vault-video or publication evidence.

## Research: provenance improved, semantic acceptance still failed

One ordinary post-deployment research retest saved report `qh7225ppx7gpkq5byy6xgzc57n8e982p`
and findings `qh7dhv2xn4w8ghbqg4jv2xb7zx8e9djn`; both were ready. Its visible code-owned
labels distinguished matched page excerpts, matched search excerpts and unverified references.
Claims remained explicitly model assessments with unverified support. This is an observed
presentation improvement, not proof of correctness or independent corroboration.

The run again read three pages despite the natural-language maximum of two. It also created
wrong-content PDF `qh76tt0sw6a6e4d3w8853fs58n8e8a73`, an acceptance-test plan containing an
invented timeline and a 125-character rule. That parallel artifact did not satisfy the requested
concise WAI research deliverable. No further paid attempt was made to erase the failure.

The exact trace identifies premature independent drafting by the root cockpit, not a breach
of the researcher's read-only grant. The root dispatched research at `09:00:44.779Z` and
started document drafting two milliseconds later. The PDF existed at `09:00:56.927Z`, before
the researcher's page reads at `09:00:59.125Z` and final findings at `09:01:15.234Z`.
The prompt did request a draft; the defect is its content and missing research dependency,
not proof that creating any artifact was unauthorized. Unrelated parallel drafting should
remain supported.

The durable next controls are a typed per-request page budget enforced before extraction, and
a requested-deliverable contract that binds parent completion/artifact saving to the delegated
research result. Their tests must include duplicate/late results, explicitly requested parallel
outputs, instruction injection and rejected saves. Prompt/method changes require exact-version
semantic evaluation before activation; source-access labels alone cannot close these gaps.
The [request-control implementation plan](2026-09-12-research-request-controls.md) records
the concrete admission, reservation, dependency, lifecycle and regression-test work still required.

Live review also exposed duplicate notices and literal backslashes from the new safe literal
encoder meeting the existing simplified Markdown parser. The follow-up parser repair decodes
escaped punctuation within inline tokenization, after block classification, so escaped model
text cannot become forged headings or formatting. General notices are assigned once to each
outer artifact wrapper; claim-support and quote-matching limitations remain explicit.
The parser/wrapper repair passed 111 tests and core TypeScript before promotion. Existing stored
duplicate notices are retained as historical content; the corrected client parser renders their
escaped punctuation without altering the stored evidence. No new paid run was used to qualify
this follow-up presentation repair.

The authenticated post-promotion mobile preview at 390 by 844 rendered the exact saved
research document with zero added literal backslashes. Historical duplicate notices remain.
The historical media plan could not be reopened through the existing latest-plan thread
view after research replaced the visible plan; therefore the final caption-copy browser
check remains unverified at this checkpoint. A successful current video is still absent.

The next frontend repair adds an exact-plan Canvas link using the existing tenant-scoped
`plans.byId` query: `/dashboard/workspace?thread=<thread>&plan=<plan>&view=canvas`.
Missing, malformed, inaccessible and wrong-thread IDs never fall back to a newer plan.
Navigation and conversation selection keep the URL and selected artifact consistent.
This opens the currently stored row; it cannot reconstruct media if that row itself was later
changed into another kind of plan. A read-only browser check after promotion remains necessary.
The route/navigation repair passed eighteen focused route/layout tests and web TypeScript;
the existing media tests had already passed. Formatting, planning and playbook checks passed.

After promotion, the authenticated exact-plan desktop check reopened the preserved media
artifact and showed failed voices, `incomplete_batch` assembly and `incomplete_takes` captions.
The caption copy correctly stated that captions could not be prepared; it made no publication
claim. This closes the narrow historical-navigation/caption-presentation check, not successful
video-generation acceptance. No generation, retry or save was performed in this check.
Mobile also passed: Show work opened the exact canvas without document overflow, and Back
to workspace removed the plan pin while preserving the thread and Work view. The local closed
receipt is `output/playwright/production-acceptance/exact-media-final-result.json`.

## Phase 30: dormant publication and representative preflight

The explicit candidate publisher created or reused the six immutable v1 candidates. At
`08:59:40.026Z`, one representative native preflight per candidate passed under run
`fd8f98ce-f1ee-462b-aaba-5a6cb844dad7`:

| Candidate | Representative case |
| --- | --- |
| Data v1 | `data-typed-xlsx-profile` |
| Product v1 | `product-supported-prd` |
| Design v1 | `design-visible-artifact` |
| Legal v1 | `legal-cited-comparison` |
| HR v1 | `hr-role-brief` |
| Engineering v1 | `engineering-architecture-evidence` |

These reads checked immutable candidate identity/body and fresh isolated tenant references.
They did not provision sources, run models, review semantic correctness or activate candidates.
The local closed corpus still contains forty cases; six representative reads are not forty
observed evaluations. Ignored local publication, preflight and repair receipts are in `.tmp/`.

A later query-only pass completed at `09:43:11.732Z`: all forty corpus cases passed native
`verticalEvalSources:preflight` against the same six candidate references. The closed receipt
is `.tmp/phase30-full-dormant-preflight-2026-09-12.json`. This extends preflight coverage to
the whole corpus without provisioning sources, calling models, reviewing semantics, publishing
again or activating anything. Forty preflight passes remain distinct from forty evaluations.

The owner subsequently clarified that Pikar uses only an ordinary OpenRouter API key, with no
separate upstream keys in OpenRouter's BYOK settings, and instructed that Tavily remain on Free.
This resolves the operator billing-mode prerequisite; no provider credentials or account settings
were changed. The Phase 30 collector uses fixed synthetic sources and does not call Tavily,
embeddings or connectors. One native observation run started at `10:05:03.541Z` against
release `0c258885`, with an aggregate ceiling of 1,000 cents and activation disabled.
Run `9bd1865a-58dd-4de0-be97-053383ca1a9b` terminated incomplete after two qualified Data
observations (`data-typed-xlsx-profile` and `data-truncated-multisheet`), each retaining a native
receipt and output archive. The aggregate ledger closed at `$0.00406801`: four settled calls,
zero unsettled calls and no breach. All forty fixtures remain retained for authenticated review.
The collector recorded `COLLECTION_OPERATION_FAILED` and an unknown remote outcome; later
bounded production-log inspection identified `VERTICAL_EVIDENCE_CORPUS_PIN` in the third
case's `beginCase` and `evaluateCase`, before its model execution. No automatic rerun occurred.
The first case's offline numeric/source comparison found no mismatch against the recomputed
profile, but this is review preparation, not an authenticated semantic pass or a complete lane.

The pin failure was reproduced locally: SheetJS added hyperlink display metadata to a shared
fixture cell during compilation. The collector then hashed the mutated recipe, while the native
corpus retained the pristine recipe hash. Cloning each supplied cell before serialization fixes
the shared compiler without weakening the native guard. All forty source manifests remain
byte-identical, and the full-corpus regression checks recipe immutability and collector/native
pin equality. Only the vertical evaluator revision changes; the golden evaluator's dependencies
and revision remain unchanged. The two earlier observations remain historical and cannot stand
in for evaluation of the corrected revision. No paid rerun has been made after the repair.

Both completed Data cases have immutable offline review packets. Advisory inspection found no
obvious numeric, source or truncation-scope mismatch; neither inspection is an authenticated
human review, expert attestation or release approval.

## Remaining gates

The later Phase 23 mutation supplement adds five direct writer/independent-entry proofs to the
seventeen preserved historical-target receipts. Each new case passed clean, deliberately rejected,
and byte-restored controls. The owning skills suite passed 187 tests; the mutation harness passed
six checks over 22 anchors. The browser probe now uses an explicit native envelope and exact
thread for its two submissions, rejects containment or unresolved cost as acceptance, and closes
the envelope before freezing the existing handoff schema. Its five offline control tests pass;
this is prepared browser plumbing, not an owner grant or a paid/live observation. The artifact
validator passed 1,338 checks again, and the accepted Phase 21 prerequisite bundle was rechecked.
The new probe-control check is explicitly registered as the twenty-second free gate.

Release `41d9551b35ee9508015767cb03084679c5a7ebcf` subsequently passed CI `34694946587`
and automatic deployment `34695175270`. The durable production probe passed at `13:02:16Z`;
production deployment `6409885713`, status `18263065577`, succeeded at `13:02:19Z`.
The separate receipt is `.tmp/qualification-2026-09-12/acceptance-controls-production-deployment-receipt.json`.
This release contains test, harness and evidence changes; runtime code and evaluator identities
remain those previously qualified. Fresh native A/B sign-in and non-owner readback also passed;
fixed private auth states were exported without decoding or replaying tokens. Their readiness
receipt is `output/playwright/phase23-acceptance/fixed-auth-state-readiness.json`. A subsequent
sign-in-first/case-insensitive-button harness correction is separately qualified for commit.

Phase 23 now has two distinct controlled accounts with fresh password sign-in and authenticated
non-owner `/ops` observations, independently confirmed by native `owner:false` reads. Credentials
are DPAPI-encrypted locally; no owner grant or model probe has occurred. The genuine authored
candidate handoff, concrete bounded-probe/evaluation approvals and activation/rollback remain open.
The owner confirmed ordinary OpenRouter access and Tavily Free. Explicit Free accounting support
now qualifies zero-dollar calls only with observed credit counts, retaining positive reservations
and unknown-usage holds. Its 56 focused tests passed; this separate accounting change refreshes
both evaluator identities and includes the ledger writer in their source inventories.
Release `ba920a3e79bbf2b4d91761848af6af4824f4d5ca` is verified in production: CI
`34689434764` and deployment `34689700017` succeeded, the durable probe passed at
`10:57:49Z`, and production receipt `6408832408` succeeded at `10:57:51Z`.
The native production CLI then set the three explicit non-secret attestations:
`GOLDEN_OPENROUTER_BILLING=standard`, `GOLDEN_TAVILY_BILLING=free`, and
`GOLDEN_TAVILY_CREDIT_USD=0`. This records the owner's confirmed billing contract;
it does not independently inspect provider account balances or upgrade Tavily.
No model evaluation was triggered by these settings. The server-owned two-turn budget attachment
is now committed as `89b6fb5`. It binds an exact thread, refuses unsupported paid routes before
egress, preserves unknown-cost holds and closes independently of unrelated owner work. Its 276
focused tests and backend typecheck passed; both evaluator identities were regenerated and their
free checks passed. Whole-tree qualification and production promotion passed in `644408df`. Budget
containment is not passing adversarial policy evidence; no owner grant or probe ran.

The shared exact-corpus preflight repair is committed as `e9d69f1`: all forty cases now
pass the same case/request matcher before provisioning and evidence issuance. Thirty-nine
native tests and backend TypeScript passed. This code is deployed in `644408df`;
its passing tests do not change the failed run's historical outcome or authorize a rerun.
Phase 30 requires actual bounded evaluations, authenticated semantic reviews (including required
qualified Legal/HR reviewers), all-six workflow acceptance, two evaluated versions per vertical,
and the six lifecycle drills. No human approval or expert attestation is inferred.

Phase 31's explicit A1/B1/C1 contract is approved and recorded in plan 31-00 (commit `8b18a2b`).
Plan 31-01 is qualified and committed in `7fa4fb2` and `71950e6`: six-channel availability,
safe raw counters, fixed-source/hash-only funnel storage, and tenant export/erasure including
retained file bytes. Its focused suites and core/backend typechecks passed. Link lifecycle is
committed in `1dac82f`, authenticated lead recording in `4b7eaf7`, and the public GET route plus
paginated file picker in `9c8cbf7`. Tests cover tenant isolation, token secrecy, raw concurrent
counts, missing/replaced files, uncached responses, HEAD refusal and both suppression convergence
points. The narrow privacy guard follow-up is `223ca7d`. The frontend and unsent workspace
prefill are implemented in `64c6d70`, with the three-scenario live suite prepared in `ffb03e2`.
Whole-tree local qualification is recorded in `31-06-SUMMARY.md`. Release
`644408df4c2c630346c5909aac23f9a352ede287` passed CI `34692922592` and deployment
`34693161766`; the durable production probe passed at `12:17:48Z`, followed by production
deployment `6409489035`, status `18262186525`, at `12:17:51Z`. The ignored receipt is
`.tmp/qualification-2026-09-12/marketing-production-deployment-receipt.json`.
Live preparation verified the original synthetic 243-byte stored file against its independent
SHA-256. The first browser scenario passed desktop/mobile, keyboard and channel checks. The
next scenario failed authenticated readiness before creating any funnel; a continuous-context
rerun also failed, and the original browser subsequently required sign-in. Correct-origin
diagnostics rule out an apex/www mismatch; refresh replay is a possible cause, not an established
diagnosis. Fresh owner sign-in is requested. A synthetic contact created before session loss
remains deliberately suppressed and retained, with no consent or send. No funnel was created.
See `31-07-SUMMARY.md` for the preserved failed-run and partial-evidence records. Navigation
remains absent pending complete live evidence and the separate owner activation checkpoint.
No live lifecycle pass is inferred from CI, prerequisite preparation, or the first UI scenario.

The owner then renewed sign-in. Direct Playwright assertions in that existing browser passed
desktop/mobile, keyboard and channel-state checks; the anonymous three-stage matrix returned
the exact original bytes and counters `[1,0,0]`, `[1,1,0]`, `[1,1,1]`. HEAD returned 405 with no
increment. A source-tampered visit retained the fixed source and changed only visits, yielding
`[2,1,1]`. After deactivation, all three stages returned empty 404s and the counters stayed fixed.
Separate unknown-token, invalid-stage and malformed-token requests returned empty uncached 404s.
Suppressed lead recapture preserved one user-entered row and absent consent; the workspace handoff
produced an unsent draft, consumed its closed intent, and was cleared without sending.

The owner replied exactly `APPROVE MARKETING NAV ACTIVATION` after reviewing this evidence and
the disclosed standalone-session-restoration limitation. Normal desktop/mobile navigation is now
implemented and awaiting its final deployment/click checks. Direct-browser evidence is not relabelled
as a passing standalone three-test suite. `31-07-SUMMARY.md` retains timestamps, release scope,
receipts, method deviation and cleanup. The owner separately authorized the Phase 23 bounded
probe with **"do it"**; `23-06-SUMMARY.md` records the exact $1/two-submission scope before execution.

Navigation release `7c1a15865c7df23ec9925ee1df1f69761f03884f` did not deploy. CI `34696425959`
passed types, lint and free gates, then failed the existing compact-navigation assertion that
expected four tabs; the approved Marketing entry makes five. Web reported 1,015 passes, that
one failure, and the two existing recurrence skips. Deployment `34696530912` was skipped and
production remained on `41d9551`. The failed release receipt is preserved separately as
`.tmp/qualification-2026-09-12/marketing-nav-production-deployment-receipt.json`; the correction
must retain an exact five-tab inventory rather than weaken the count or discard the old tabs.

The first Phase 23 launch stopped before Node, browser, owner grant or model execution: encrypted
credential unlocking failed in the escalated execution context. Matching original null-entropy,
CurrentUser DPAPI parameters succeeded in the default context, without printing credentials or
downgrading their storage. No attempt lock or native probe was created. Execution remains held
until the navigation regression is corrected and the required free gates pass.

The correction shipped in `4df076dbdc8330c54ace5a3996259f3e71318024`. CI `34696845981`
and deployment `34697141228` passed; the durable probe passed at `13:44:19Z`, followed by
production deployment `6410261035`, status `18263904787`, at `13:44:23Z`. Actual desktop
1440px and mobile 390px navigation checks passed at `13:48:12.226Z`, including keyboard,
pointer, active state, focus, fit and retired-link readback. Phase 31 and MKTG-01/02/03 are
complete, as certified in `31-VERIFICATION.md`. The failed release and standalone auth-restoration
results remain preserved rather than rewritten.

The Phase 23 runner subsequently received its credentials through a reviewed one-use local
encrypted handoff. Eleven synthetic cross-context and rejection checks preceded the actual
handoff; no private key or plaintext credential file was written. Attempt
`3de192cf-9ffa-427e-a7f7-83a0d33910f0` is running its real free prerequisites on frozen
`4df076db`. Its once-only lock is retained. No owner/probe/model result is inferred from the
successful handoff; `23-06-SUMMARY.md` owns subsequent execution evidence.
Provider eligibility/consent/read/revoke conditions remain open. Google Drive read
worked, but no reconnect drill was manufactured by disconnecting a usable account. Recurrence
remains deferred until its DST/OAuth evidence gates pass. Graph maintenance remains partial: the
bounded full refresh timed out after extraction, while the Convex edge fixup succeeded.

The final read-only Intuit developer-app check redirected to Intuit sign-in. This establishes
an authentication prerequisite for renewed diagnosis; it does not independently reconfirm
the older app-record defect. The tab was preserved without credentials or consent actions.

## September 14 working-tree follow-up — no production claim

Phase 30's native evidence layer and admin surface now implement a closed review console keyed by
exact run UUID. Receipts bind exact output hash/UTF-8 length, stable criterion IDs and observed
outcome/tool facts. Mechanical facts may resolve deterministically; semantic criteria require an
explicit byte-bound reviewer decision. Stale evaluator/candidate pins block finalization,
finalization cannot activate a candidate, and Legal/HR remain blocked until a separately qualified
external attestation mechanism exists.

The research-control Stage 3 implementation now admits an explicit memo/PDF contract. PDF requests
wait for the exact completed research artifact and deterministically attach PDF bytes to the same
`web_research` Vault row using tenant/request/plan/type/hash checks and compare-and-swap replay
handling. It performs no second model transformation and creates no duplicate document. Incomplete,
missing, deleted, mismatched or canceled dependencies refuse explicitly.

Focused local validation passed: Stage 3 **6** tests, Phase 30 **23**, admin **12**, workspace
controls **19**, backend/web typechecks, and one dispatch integration test. The full release gate
passed **7,841** tests (two recurrence checks intentionally skipped) plus the production build.
Exact source `07350fc122ece7d2fbb5ddc5051e699fb2e81d57` passed CI
[34826131926](https://github.com/Mrjoel97/ProjectX/actions/runs/34826131926) and production deployment
[34826722003](https://github.com/Mrjoel97/ProjectX/actions/runs/34826722003), including Convex deploy,
registry verification, staged probe, Vercel promotion and durable production URL verification. The
September 12 wrong-content PDF, the incomplete two-case paid run, all authenticated semantic
reviews, qualified Legal/HR review, all-six workflow UAT, two-version evidence, lifecycle drills,
provider gates and recurrence DST/OAuth gates remain open.

The authorized Phase 23 continuation against `07350fc` failed closed during A's second native sign-in
after the initial authoring/refusal sequence. A/B sign-in and non-owner checks, owner bootstrap, and
the first candidate authoring turn passed; the browser then remained on the sign-in form in
`Signing in…`. No certified handoff, full evaluation or activation exists; source integrity held.
Repair the auth-flow race before retrying the one-shot live authorization.
