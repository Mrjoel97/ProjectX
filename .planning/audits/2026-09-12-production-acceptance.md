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
No model evaluation was triggered by these settings. Ordinary browser authoring still
needs a server-owned aggregate budget attachment before a truthful capped probe checkpoint.

The shared exact-corpus preflight repair is committed as `e9d69f1`: all forty cases now
pass the same case/request matcher before provisioning and evidence issuance. Thirty-nine
native tests and backend TypeScript passed. This code awaits the next qualified release;
its passing tests do not change the failed run's historical outcome or authorize a rerun.
Phase 30 requires actual bounded evaluations, authenticated semantic reviews (including required
qualified Legal/HR reviewers), all-six workflow acceptance, two evaluated versions per vertical,
and the six lifecycle drills. No human approval or expert attestation is inferred.

Phase 31's explicit A1/B1/C1 contract is approved and recorded in plan 31-00 (commit `8b18a2b`).
Plan 31-01 is qualified and committed in `7fa4fb2` and `71950e6`: six-channel availability,
safe raw counters, fixed-source/hash-only funnel storage, and tenant export/erasure including
retained file bytes. Its focused suites and core/backend typechecks passed. Link APIs and the
existing-contact lead adapter are the next parallel wave; UI and live acceptance remain open.
Provider eligibility/consent/read/revoke conditions remain open. Google Drive read
worked, but no reconnect drill was manufactured by disconnecting a usable account. Recurrence
remains deferred until its DST/OAuth evidence gates pass. Graph maintenance remains partial: the
bounded full refresh timed out after extraction, while the Convex edge fixup succeeded.

The final read-only Intuit developer-app check redirected to Intuit sign-in. This establishes
an authentication prerequisite for renewed diagnosis; it does not independently reconfirm
the older app-record defect. The tab was preserved without credentials or consent actions.
