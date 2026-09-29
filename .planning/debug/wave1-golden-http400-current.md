---
status: investigating
trigger: "Wave 1 synthetic golden run on 2026-09-24 failed at the first case with EVAL_MODEL_RESPONSE_FAILED_CONSERVATIVE_HTTP_400. Diagnose without paid replay."
created: 2026-09-23T23:10:16Z
updated: 2026-09-25T17:53:58Z
---

## Current Focus

hypothesis: A committed change before the failed run, or a mismatch between deployed and local source, altered the first golden chat request.
test: Compare exact request-path revisions with the partial September 20 run, then inspect run manifests for source/deployment provenance.
expecting: A changed model, provider option, tool schema, or exact deployment digest would distinguish a request regression from an unknown upstream rejection.
next_action: Read focused git history and the graph-located request path; compare retained reconciliation identities.

## Symptoms

expected: 46 executable synthetic cases finish under cockpit-agent@26 and inbox-digest@2, yielding certifying evidence.
actual: Case 01-happy-single starts, then GOLDEN_PAID_CALL_FAILED with zero verdicts; the budget closed with $0.00000392 observed and $0.03 conservative settlement.
errors: Sanitized Workflow code EVAL_MODEL_RESPONSE_FAILED_CONSERVATIVE_HTTP_400; raw provider response is intentionally not emitted.
reproduction: `node scripts/run-eval-golden.mjs --skill cockpit-agent@26 --skill inbox-digest@2 --no-retry --max-usd 2.00` from `packages/backend` against local Convex. Do not replay during this diagnosis.
started: Older 2026-09-20 attempts also returned HTTP 400; the recent adapter removal of undocumented `n:1` and `transforms:[]` did not clear the 2026-09-24 failure.

## Eliminated

- hypothesis: The current source still emits the previously implicated `n`, `plugins`, `transforms`, or `require_parameters` fields.
  evidence: The existing mocked-fetch wire test on current source emitted only `max_tokens`, `messages`, `model`, `provider`, `tool_choice`, and `tools` at top level, with none of those four fields; it passed without a paid call.
  timestamp: 2026-09-23T23:17:24Z
- hypothesis: The dated OpenAI endpoint lacks tools or cannot accept 8,192 output tokens.
  evidence: The current public endpoint readback reports OpenAI status 0, `tools` and `tool_choice` support, and 16,384 maximum completion tokens.
  timestamp: 2026-09-23T23:17:24Z
- hypothesis: A stale `@pikar/cost` compiled `dist` export necessarily explains the mismatch.
  evidence: `packages/cost/package.json` exports source TypeScript directly (`./src/index.ts` and `./src/*.ts`), not a compiled dist file.
  timestamp: 2026-09-23T23:17:24Z
- hypothesis: OpenAI's strict-mode root-`anyOf` prohibition by itself proves this request invalid.
  evidence: The captured Chat Completions wire carries no `strict: true`, and [OpenAI's function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling) says omitted `strict` defaults to non-strict in Chat Completions. The strict-schema prohibition is not sufficient evidence for this request.
  timestamp: 2026-09-23T23:21:19Z
- hypothesis: The retained September 24 local evaluator logs include a provider rejection category or generation ID for run `eadd4317`.
  evidence: The latest file in `packages/backend/.eval-runs` predates that run (September 20); a scoped search of `.eval-runs`, `.eval-logs`, and `.planning`, followed by a hidden-file workspace filename search excluding dependencies/build artifacts, found the run ID only in summary/test/source records. The reconciliation explicitly says the raw response body was not emitted.
  timestamp: 2026-09-24T22:12:33Z

## Evidence

- timestamp: 2026-09-25T17:53:58Z
  checked: Compared the golden chat `provider.max_price` body to OpenRouter's current provider-routing documentation and removed the unused text-chat `audio: 0` ceiling, which that documentation does not list among prompt, completion, request and image fields.
  found: The whole-context reservation, per-run cap, OpenAI-only route and no-retry behavior remain unchanged. Cost wire tests passed 6/6, focused backend budget tests 24/24, cost TypeScript, strict planning/playbook/diff checks and the full Graphify refresh plus Convex edge fixup exited 0; both edited cost files match nonempty current graph-manifest entries.
  implication: The current request now uses only documented `max_price` fields. This is a wire-contract alignment, not proof that `audio: 0` caused the historical HTTP 400. No provider or paid replay occurred.

- timestamp: 2026-09-25T11:43:37Z
  checked: Ran the repository-mandated Graphify query, scoped worktree/status and timestamp inspection, plus a retained-artifact ID search.
  found: Graphify located `llm.ts`, `cockpit.ts`, `evalBudgetModel.ts`, and the golden runner path. Current `llm.ts` is modified at 2026-09-25T03:15:12Z; its working-tree diff against HEAD only changes two Google Drive error-result strings. The scoped retained search still finds `eadd4317` only in reconciliation/planning records, not a raw request or provider response.
  implication: The post-record `llm.ts` mtime does not itself identify a new chat-wire invalidity. Historical source and deployment identity require narrower comparison.

- timestamp: 2026-09-25T05:21:34Z
  checked: Read the current bundled computer-use guidance and confirmation policy, then attempted read-only browser inventory through the browser-control runtime and initialized the Windows helper once as a fallback.
  found: Both stopped before listing any tab/app with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. No authenticated page, provider activity record, model request, key or customer content was accessed or sent.
  implication: The already-failed Activity entry remains unavailable through the current UI tools. The historical HTTP 400 cannot be classified from this attempt; no paid replay is inferred or authorized.
- timestamp: 2026-09-25T03:41:30Z
  checked: Dirty baselines, current `runAgentLoop`, the complete `replyToMessage` tool, existing SDK mock-fetch test, and `git diff 275c360f9c0086470153cd28cfbe04f8454fd8d1 HEAD -- packages/backend/convex/llm.ts`.
  found: The source diff adds only `minLength` and a root `anyOf` to model-visible tool schemas; other edits are closure/runtime logic. The first `generateText` call passes `system` and `prompt`, not a prior tool-call/result transcript. The relevant source files are dirty shared files, so no source edits are being made during diagnosis.
  implication: A first-call message/tool-result pairing defect is contradicted by the call construction. The changed schema remains a testable, not confirmed, candidate.
- timestamp: 2026-09-25T03:47:01Z
  checked: Isolated Vitest with `createOpenRouter` mock fetch, the installed `ai` SDK, current `buildCockpitTools`, executive grants, and synthetic system/user text; no network or provider call.
  found: SDK serialization passed with 37 unique function names under current full executive lineage, 22,871-byte synthetic request body, valid object-shaped parameter roots, and required/`anyOf` selector references that point to declared properties. `replyToMessage` retained `anyOf` and `minLength` as authored. Messages serialized as one system and one user role, with no tool-call/result pair. A no-lineage test emitted 31 tools. The prior debug note's 30-tool/17,304-byte wire was not reproduced under either tested current context; the failed deployment's exact source/grant identity was not retained.
  implication: SDK-side serialization and simple local schema structure do not reproduce an invalid request. The count mismatch makes the historical synthetic capture weaker as proof of the actual 2026-09-24 failed request, but does not identify an upstream rejection cause.
- timestamp: 2026-09-25T03:54:43Z
  checked: Temporary diagnostic-test cleanup, targeted worktree status, and repository graph maintenance.
  found: The temporary test was removed and no application source file was edited by this investigation. `graphify update .` completed AST extraction for 3,195 files but did not return from final processing, so it was interrupted after several minutes; `node scripts/extract-convex-edges.mjs` exited 0 with +0 edges. The pre-existing dirty `llm.ts`, `evalBudgetModel.ts`, and its test remain untouched.
  implication: The only retained change owned by this investigation is this debug record. Graph update completion is not claimed.

- timestamp: 2026-09-23T23:17:24Z
  checked: 2026-09-24 retained reconciliation and previous 2026-09-20 diagnostic record.
  found: The failed cockpit workflow emitted only `EVAL_MODEL_RESPONSE_FAILED_CONSERVATIVE_HTTP_400`; five synthetic embedding calls succeeded, the single failed chat call was conservatively settled, and no upstream response body was retained by the application path.
  implication: Credential/transport worked for embeddings, but this does not identify the chat rejection reason.
- timestamp: 2026-09-23T23:17:24Z
  checked: Complete `goldenChatWireOptions`, `evalBudgetModel`, `resolveModel`, and `runAgentLoop` request path; reran existing ignored mocked-fetch wire test offline.
  found: Current synthetic wire shape has 30 function tools, 17,304 bytes, `max_tokens: 8192`, provider `only/order: [openai]`, `allow_fallbacks: false`, `max_price: {prompt:0.15,completion:0.6,request:0,image:0,audio:0}`; no removed request fields. The resolver maps the alias to `openai/gpt-4o-mini-2024-07-18` for the live call.
  implication: Local serialization is known, but the mock deliberately returns HTTP 400 and cannot establish upstream acceptance.
- timestamp: 2026-09-23T23:17:24Z
  checked: Public OpenRouter `GET /api/v1/models/openai/gpt-4o-mini-2024-07-18/endpoints` and [provider-routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection).
  found: One OpenAI endpoint is live, with $0.15/$0.60 per million prompt/completion pricing, `tools`, `tool_choice`, `max_tokens` support, 128,000 context, and 16,384 completion limit; documented `max_price` units match local numeric values.
  implication: Model existence, advertised tool support, output ceiling, and obvious price-unit mismatch are not supported as causes.
- timestamp: 2026-09-23T23:21:19Z
  checked: Git diff from source revision `275c360f9c0086470153cd28cfbe04f8454fd8d1`, associated with the 2026-09-20 run reaching 26 passing cases, to current `llm.ts`.
  found: The broad tool set remains; `replyToMessage` newly adds `minLength: 1` to two selector fields and a root `anyOf` requiring either selector. This is a plausible regression candidate, not an established rejected field.
  implication: The generic count of 30 tools is not a strong new-cause hypothesis. The one changed schema deserves targeted rejection-detail inspection, but its validity cannot be inferred from a bare HTTP status.
- timestamp: 2026-09-23T23:21:19Z
  checked: [OpenAI function-calling documentation](https://developers.openai.com/api/docs/guides/function-calling), [OpenRouter Activity/BYOK debugging guidance](https://openrouter.ai/docs/guides/overview/auth/byok), and available browser inventory.
  found: Chat Completions omitted `strict` is non-strict; OpenRouter says Activity raw metadata can contain provider response statuses. Computer-use inventory returned no existing browser or authenticated tab to inspect. The documented activity aggregation API requires a management key and is not a per-failure error feed.
  implication: A read-only Activity inspection is the bounded non-paid next diagnostic; neither the 30-tool schema nor routing is proven from available retained state.
- timestamp: 2026-09-24T01:05:51Z
  checked: Safe diagnostic implementation and offline verification after the failed run.
  found: `closedGoldenFailureToken` now maps only allowlisted structured HTTP 400 codes and tool-parameter paths to closed `TOOL_SCHEMA`, `ROUTING`, `MODEL`, `CONTEXT`, or `UNKNOWN` suffixes. Realistic wrapped-provider and ambiguity/secret-safety tests pass (18/18 focused tests); backend typecheck, source-derived golden self-check, all 28 free gates and the Phase 49 repository/local aggregate pass on its new digest. No paid replay occurred.
  implication: A future authorized run can retain a bounded category without a provider message or response body; this does not retroactively categorize the 2026-09-24 failure or establish root cause.
- timestamp: 2026-09-24
  checked: Read-only browser inventory for the already-failed OpenRouter Activity record; retried once after resetting the browser-control runtime.
  found: Both attempts failed before tab discovery with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. No account page was opened and no provider request or paid replay occurred.
  implication: The existing Activity record remains uninspected; the precise HTTP 400 cause remains unconfirmed. Resume this non-paid check only after browser control is available.
- timestamp: 2026-09-24 (continuation)
  checked: The updated Windows computer-use helper, after reading its bundled safety/runtime guidance; initialized once, reset its JavaScript kernel and retried once.
  found: Both initializations failed with the same kernel-assets path error before listing apps or opening an OpenRouter page. The listed in-app browser skill file was absent from its declared path, so it could not be used. No paid call, login or account-state change occurred.
  implication: The browser tooling failure is repeated and independent of the golden request. Do not convert it into an inferred HTTP 400 cause or retry the closed diagnostic.
- timestamp: 2026-09-24 (retained-ID check)
  checked: Searched the current Wave 1 reconciliation, budget, workflow and planning artifacts for run `eadd4317`, its workflow/attempt references and any OpenRouter generation or request ID; compared the documented read-only OpenRouter generation and activity API contracts.
  found: The retained local records expose run/workflow/budget references but no provider generation ID. [The generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-generation) requires that ID. [The activity API](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity) needs a management key and groups by endpoint, so it cannot isolate the failed request's rejection reason. Neither API was called; no app key or customer content was exported.
  implication: A per-generation API lookup cannot recover this historical 400 from the identifiers currently retained. The authenticated Activity UI remains a possible read-only path if available; otherwise only a future separately bounded diagnostic with the new closed-category classifier can distinguish causes.
- timestamp: 2026-09-24T22:12:33Z
  checked: Resumed the current session, read both Wave 1 plans and State, ran `graphify query` before source exploration, reviewed the September 24 reconciliation and corrected September 21 diagnosis, searched retained evaluator/planning artifacts, and inventoried available browser surfaces.
  found: Run `eadd4317` has one failed chat workflow, zero verdicts, five successful embeddings, only the closed `EVAL_MODEL_RESPONSE_FAILED_CONSERVATIVE_HTTP_400` token, and no emitted provider body. The retained `.eval-runs` files stop at September 20. The browser inventory returned `apps: []` and `browsers: []`; no authenticated OpenRouter tab was available. No provider, budgeted evaluator, retry, or prompt/tool request was made.
  implication: The current evidence still cannot distinguish tool-schema, routing, model, context, or other HTTP 400 causes. No application request change has a confirmed basis.

## Resolution

root_cause: Unconfirmed. The application intentionally discarded the upstream error body and retained only HTTP 400, which is insufficient to distinguish request-schema rejection from provider-routing or another bad-request category. Current offline SDK serialization did not reproduce a deterministic invalidity, and the actual failed request's tool-count/source identity was not retained.
fix: Diagnostic-only closed classifier; no request semantics, budget, settlement or retry change. The upstream cause remains unconfirmed.
verification: Prior focused tests, backend typecheck, golden self-check, free gates and Phase 49 repository/local aggregate passed; this continuation's isolated offline SDK-wire test passed 1/1 before its temporary file was removed. No paid replay performed. Existing mocked-fetch wire test and read-only endpoint/provider inspection remain applicable.
files_changed: [packages/backend/convex/lib/evalBudgetModel.ts, packages/backend/convex/goldenBudget.test.ts, packages/contracts/src/skill.ts, packages/backend/scripts/eval-suite-manifest.json, packages/contracts/src/verticalEvalCorpus.ts]
