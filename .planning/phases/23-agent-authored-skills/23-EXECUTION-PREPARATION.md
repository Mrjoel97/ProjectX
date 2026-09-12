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

The native aggregate budget for two ordinary browser submissions is deployed at `644408df`
(CI `34692922592`, deployment `34693161766`). It binds one exact thread, refuses unsupported
paid side paths and preserves unknown-cost holds. This is probe containment, not proof that
unrestricted runtime policy refused an adversarial instruction. The concrete 23-06 Task 2
authorization remains pending before any owner grant or model turn. The synthetic golden-suite
envelope below is a separate run; historical qualification discussion below is not a new receipt.

This is preparation, not a completion summary. No authored-candidate, paid-evaluation,
owner-activation or rollback observation is created by these offline changes.

The nonmutation prerequisite review confirmed the 1,338-probe artifact validator, checked
`SKILL-01`, and the Phase 21 exact passing run `de976d8e` on candidate
`qx73bwshbfds5nk7hd40vsf5y18cm7z0`. Its live records contain non-owner refusal, owner activation,
and exact-baseline rollback; the explicitly unobserved runtime-attribution limitation remains
accepted. The current golden self-check covers no-model inspector ordering. The A/B baseline
at `2026-09-12T10:32:30Z` on `0c258885` witnessed both fresh sign-ins and native owner=false,
but is historical authentication evidence, not fresh `644408df` storage-state verification.
Actual fixed-path export and fresh reauthentication remain separate readiness checks.

## Ready locally

- The browser spec now prepares one native `authoringProbe` only after its authorization/free-gate
  checks and fresh non-owner witnesses, then navigates the exact returned thread before both
  ordinary sends. Native zero/one/two-turn controls, exact tenant/thread/authorization/cap binding,
  settled usage and zero containment are mandatory. Native closure precedes the unchanged immutable
  handoff. A separate bounded attachment links budget facts and their hash to the handoff hash;
  it does not add fields to the fixed handoff schema or certify policy from counters alone.
- On failure, native closure is attempted only for terminal controls with no unresolved usage or
  breach. Unknown work remains held. No paid retry, re-registration, force-close, grant rollback,
  candidate deletion, evaluation, or activation is part of recovery.
- Five offline probe-control tests and a web TypeScript check passed. Playwright `--list --no-deps`
  discovers exactly one intended spec without executing auth or model work. These are harness
  checks, not authenticated acceptance.

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

## Concrete future two-turn checkpoint — proposed, not authorized

Tenant A is `qd7bqyyt3yked865nd2b3fm1s18e917z`; tenant B is
`qd79msa8e29c2nkg629cvxp5xd8e8gk1`. The proposal grants A owner after its fresh non-owner UI
witness, keeps B non-owner, and allows exactly two ordinary Executive submissions: one inert
business-skill candidate request and one adversarial activation/self-evaluation/grant request.
No evaluation evidence or activation is permitted. Proposed aggregate cap: **100 cents ($1)**,
explicitly selected through `PIKAR_PHASE23_CAP_CENTS`, expiring one hour after native registration.
This amount is not approved by this document. Native maximum remains 1,000 cents.

The ordinary primary is `or/openai/gpt-4o-mini`, with eligible fallback
`or/openai/gpt-4.1-nano`; at most eight SDK steps per loop, bounded 8,192 output tokens and
45-second attempts apply. Two submissions do not mean two provider calls. Supported immediate
descendants share the aggregate envelope; unsupported execution is contained and disqualifies
adversarial acceptance. Ambiguous provider attempts retain holds and do not trigger an automatic
paid retry. Tavily remains explicitly Free with observed-credit accounting.

Required local preparation uses the existing controlled credentials; do not ask the user to
repeat credentials they never received. The bundle is
`output/playwright/phase23-acceptance/credentials.dpapi` (Windows CurrentUser DPAPI), with A/B
email/password fields. A trusted local launcher can decrypt it directly into child process
environment variables `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_FOREIGN_USER_EMAIL`, and
`E2E_FOREIGN_USER_PASSWORD`, without printing values or creating plaintext credential configs.
Do not rerun the credential-generation helper. The live agent owns the already authenticated
`phase23-a`/`phase23-b` browser profiles; export actual native Playwright storage states to
`apps/web/e2e/.auth/user.json` and `apps/web/e2e/.auth/foreign.json` before invocation. Their fixed
handoff labels are unchanged and must name real files, not placeholder references.

The spec signs out and performs a fresh native password sign-in with each exact address after
the server's unique email-to-user lookup matches the separately supplied exact A/B IDs. It never
extracts or decodes a stored JWT. Storage-state reuse alone is not treated as a fresh durable-ID
witness. Existing `auth.setup.ts` is deliberately bypassed: it still contains legacy JWT decoding
and profile seeding, which are not part of this acceptance continuation.

After all Task 1 prerequisites are accepted and the fresh Task 2 approval is recorded, set
`PIKAR_PHASE23_BROWSER_PROBE=1`, `PIKAR_PHASE23_TWO_IDENTITIES=1`,
`PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP=1`, exact `PIKAR_PHASE23_PRIMARY_USER_ID` /
`PIKAR_PHASE23_FOREIGN_USER_ID`, the explicit cap, the recorded authorization SHA-256, and a
private canary. Set the production base URL, `PIKAR_CONVEX_TARGET=prod`, and the existing private
production `CONVEX_URL`; do not set provisioning or storage-state override flags. From `apps/web`:

```text
node node_modules/@playwright/test/cli.js test e2e/agent-skill-authoring.spec.ts --project=chromium --no-deps --workers=1
```

`--no-deps` is required, not optional. Listing that command with `--list` is free; executing it
requires the pending approval and performs the disclosed owner/candidate writes. The remaining
user action is that concrete authorization after prerequisite review, not a credential request.

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
