# Phase 23 execution preparation — 2026-09-11

## September 12 continuation

Both controlled accounts completed fresh password sign-in and authenticated non-owner `/ops`
checks, independently confirmed by native owner-state reads. Private credentials remain locally
encrypted; committed records contain no email or password. No owner grant, model authoring probe,
candidate handoff, evaluation, activation or rollback has occurred for this Phase 23 acceptance.

The owner confirmed ordinary OpenRouter API-key access with no upstream BYOK keys and instructed
Tavily Free. Production `ba920a3` passed CI/deployment and its durable probe; the native production
CLI then successfully set `GOLDEN_OPENROUTER_BILLING=standard`,
`GOLDEN_TAVILY_BILLING=free`, and `GOLDEN_TAVILY_CREDIT_USD=0`. These are explicit owner
attestations, not an independent inspection of provider balances. Free usage still requires observed
credit counts and retains positive reservations when usage is unknown.

A native aggregate budget for two ordinary browser submissions is under qualification. It binds
one exact thread, refuses unsupported paid side paths and preserves unknown-cost holds. This is
probe containment, not proof that unrestricted runtime policy refused an adversarial instruction.
Final current-source pins, whole-tree checks and the concrete 23-06 Task 2 authorization still
precede any owner grant or model turn. The synthetic golden-suite envelope below is a separate run.

This is preparation, not a completion summary. No authored-candidate, paid-evaluation,
owner-activation or rollback observation is created by these offline changes.

## Ready locally

- The existing candidate-only browser spec and its two-user auth setup now forward
  `PIKAR_CONVEX_TARGET=prod` to their direct Convex CLI calls, matching the golden inspector.
- `phase23-operator.mjs preflight <handoff|eval|live> <artifact-path> --forbid-env
  PHASE23_PRIVATE_NEEDLE` validates the closed artifact/hash chain and reads source, exact
  candidate and provenance twice. It compares immutable identity, effective/global/foreign state,
  baseline and governing state where applicable. It never writes to a deployment. Production
  inspection additionally requires the explicit deployment URL privately in `CONVEX_URL`, because
  the legacy inspector otherwise can fingerprint a dev configuration label while using `--prod`.
- Golden model-driving CLI calls now create durable local recovery receipts under
  `.tmp/golden-paid-attempts` before calling. Empty/malformed/error responses stop with code 2,
  leave the attempted run's server state intact, and never retry that paid attempt or write passing
  evidence. Receipts contain an attempt id, function name, request/response hashes, timestamps and
  known returned cost only. They are not a second spend ledger and are not release evidence.

## Required live prerequisites

1. Two distinct fresh password-authenticated controlled tenants, both observed as non-owner before
   A's separate owner bootstrap; B remains non-owner. A pre-existing owner login cannot supply
   that historical witness. The private adaptation needle and auth storage states stay uncommitted.
2. All Phase 23 free gates and previous implementation mutation records; the accepted Phase 21
   bundle remains the prerequisite, without inventing an unobserved runtime-attribution requirement.
3. A real ordinary Executive authoring turn that calls `authorSkillCandidate` exactly once,
   followed by the refusal/browser checks and immutable exact-row handoff. No direct publication
   mutation is a substitute.
4. A full, unfiltered current 46-case agent suite on that exact row, followed by the public
   non-owner refusal, observed owner UI approval, exact readback and baseline rollback.

The runner now opens a native aggregate $2.00 envelope before corpus embedding, covers the
main and authoring-attempt tenants, and carries it through chat, child actions, RAG, ingest and
Tavily. Unknown provider costs retain reservations and disqualify evidence. Closure refuses
unfinished descendants. Paid readiness remains false: account billing verification, exact current
candidate/authenticated evidence and fresh approval of the displayed paid run remain outstanding.
Offline tests prove control behavior only; they are not semantic evaluation or provider receipts.

## Paid-call graph covered by the new aggregate envelope

| Entry/edge | Actual paid work | Required reservation seam |
| --- | --- | --- |
| `run-eval-golden` → `vaultSmoke.seedCorpus` → `rag.add` | Document embeddings before the first cockpit turn | Each low-level embedding request, including each retry |
| `llm.runCockpitAgent` → `runAgentLoop` | Every executive step and eligible model fallback | Existing native SDK middleware, extended to the code-owned golden models |
| Cockpit drafting tools → `llm.draft` / `draftDocument` / `draftReply` / `digestInbox` | Independent toolless generation and fallback actions | Forward the trusted envelope across action arguments; wrap each low-level call |
| Evaluation tools → `evaluations` → `vaultGround` | Live query embeddings | Forward envelope into the existing RAG adapter |
| `searchVault` → `vaultGround` → `rag.search` | Live query embeddings, potentially repeated per turn | The same low-level embedding seam |
| Native dispatch/workflows → `runSpecialistTurn` | Specialist steps/fallbacks that can finish after the initiating call | Persist trusted envelope in native dispatch arguments; retain it through child work |
| Research `webResearch` / `readPage` | Tavily search/extract HTTP calls | Reserve verified worst-case credit cost before each HTTP call, including failure semantics |
| Tool-driven saved document → ingest workflow | Classification, graph extraction and document embedding if that path executes | Propagate through native ingest args or refuse unsupported evaluated operation before paid work |

The currently selected chat routes include `or/openai/gpt-4o-mini`,
`or/openai/gpt-4.1-nano`, `or/openai/gpt-5.6-luna` and `or/openai/gpt-4.1-mini`.
The embedding adapter currently selects OpenRouter `openai/text-embedding-3-small`; historical
Gemini comments are not its current route. Evaluated embedding requests disable automatic retries,
reserve before transport and inspect actual provider usage. Evaluated Tavily requests use their
own reservation on the same ledger. Ordinary production transport behavior remains unchanged.

## Implemented reservation design and remaining billing verification

Reuse `spendEvents` envelopes and the existing rate-limiter component. Open one envelope before any
corpus/model work; enumerate the exact main and authoring-attempt fixture tenants. Extend the
existing typed reservation kinds to the verified chat models, embedding requests and paid search
tools. Preserve the fixed total window and durable unknown holds. The native terminal budget
close must succeed before passing evidence or cleanup; a breach or unresolved hold blocks both.

Carry an optional trusted `evalBudgetId` through existing `TOOL_CONTEXT_ARGS`, dispatch/workflow
arguments and the paid child-action seams. Existing production calls omit it. Do not infer authority
from an `eval-` prefix alone, accept it from model tool input, or create a parallel router/credential
path. Reuse `resolveModel` and the existing RAG component with a scoped embedding adapter that has
the action context and envelope. Every SDK retry or raw HTTP retry must reserve separately; an
unresolved attempt retains its whole hold. Report exact provider dollars where available and retain
the full reserved amount when the provider omits authoritative cost.

Before authorizing a live hard-cap run, independently verify account terms and official bounds for the two additional
chat models, embedding input/batch size and pricing, Tavily search/extract credit charging on partial
and failed responses, and account billing mode (including external BYOK invoices). Enforce those
bounds on the provider wire. Unknown models/provider tools and unsupported paid action paths must
fail before the subcall, not after observing spend. Source or budget failures must poison later
steps even where ordinary production code intentionally catches tool/grounding errors.

The backend requires trusted `GOLDEN_OPENROUTER_BILLING=standard` metadata. Tavily standard
billing requires a positive `GOLDEN_TAVILY_CREDIT_USD <= 0.008`; explicitly declared Free billing
requires `GOLDEN_TAVILY_BILLING=free` and a nonblank zero rate. Missing rates never imply Free.
Setting these values does not itself prove provider account terms. OpenRouter response usage must
identify standard (non-BYOK) billing and an authoritative nonnegative cost. Tavily usage credits are
retained separately from dollars, including zero-dollar Free settlements; unknown usage keeps its
reservation. Each extract request reserves whole credit batches, including a one-URL request.

Reusing a stored real corpus could save initial document embedding, but cannot remove live query
embedding or paid research. Replacing RAG with fixed-source callbacks, or substituting tool fixture
responses, would change the held-out suite's claim. That requires a new suite revision and evidence
review and cannot certify the unchanged Phase 23 suite.
