# Phase 16: Research Sub-Agent & Web Research - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Source:** Owner decision in session (two forks resolved before planning)

<domain>
## Phase Boundary

Phase 16 delivers TWO things and nothing else:

1. **The first exemplar specialist** — a `research` route dispatched through the Phase-15
   governed dispatcher with its OWN least-privilege tool-set.
2. **A grounded web-research capability** whose findings land in the vault with a
   retrieval-date freshness stamp, unblocking the Phase-12 evaluation engine's market claims.

**Out of scope:** widening `diagnose()` to prescribe research; any second dispatch seam; a
self-fetching HTTP client; a new search vendor; source-level extraction control.

</domain>

<decisions>
## Implementation Decisions

### D1 — Web access: OpenAI's HOSTED web_search (LOCKED)

Use the hosted search tool exposed through the **already-installed** `ai@7.0.20` +
`@ai-sdk/openai@4.0.11`. **No new dependency. No new API key.** Cost rides the existing
`OPENAI_API_KEY`.

**Why this is the security decision, not just the lazy one.** Our backend never issues an
outbound HTTP request to an attacker-chosen URL, so there is no request for an injected page to
redirect at `169.254.169.254`, `localhost`, or an internal service. SC#2's SSRF half is satisfied
**structurally** — the capability is absent, not guarded. That is a stronger property than any
allow-list, and it is why the alternative (search API + our own fetcher, which would require
DNS-resolve-before-connect, private/link-local blocklists, and redirect re-validation on every
hop) was rejected for this phase.

**This must be ASSERTED, not merely asserted-in-prose.** Ship a check proving no code path in the
research tool performs an outbound fetch to a model- or page-supplied URL. "We don't do that"
is a claim; a test that fails when someone adds a `fetch(url)` is the invariant.

### D2 — One swap seam, not an abstraction layer (LOCKED)

Shape the tool's internal interface so a self-fetching provider could be slotted in later
**without touching the specialist or the vault storage shape**. This is ONE seam (a provider
boundary), NOT a plugin architecture, NOT a config-driven registry, NOT an interface with one
implementation plus a factory. Per CLAUDE.md §8, if the seam cannot be justified in a sentence,
do not build it — take the direct implementation and leave a `ponytail:` comment naming the
upgrade path.

### D3 — `research` joins the closed route union (LOCKED)

Add `"research"` to `SPECIALIST_ROUTES` (`packages/core/src/specialists.ts`) with its own
`SpecialistSpec`, and make it dispatchable **directly by the executive agent** — not only as the
terminus of a `diagnose()` prescription.

**The existing comment must be corrected in the same change.** `specialists.ts:10` currently
reads "the closed set of dispatchable specialist routes — exactly the routes `diagnose()` emits."
That invariant is what this phase deliberately relaxes: the set becomes "the routes the system can
dispatch", of which the diagnose-emitted ones are a subset. Leaving the stale comment is worse
than the change itself — the next reader will treat it as load-bearing. **`diagnose()` itself is
NOT widened** (ADR-009's scope-down stands); research is reachable by dispatch, not by
prescription.

### D4 — The tool-set is the containment (derived from SC#1, non-negotiable)

`SPECIALIST_TOOLS` is currently `["searchVault"]` for all three Growth OS specialists. The
research specialist gets its own grant — web research **plus** vault read — and **NO send, no
write, no plan mutation**. This is what makes SC#1 true: an instruction injected into a fetched
page reaches an agent that is structurally incapable of sending anything. It can at most
influence a proposal that still stops at the human Approve gate.

Follow the existing precedent in `specialists.ts:29-40` exactly: the tool-set is a CAPABILITY
grant and therefore **code-owned, never DB-writable** (ADR-007). A registry row that could widen
its own tools is a privilege-escalation path. Do not grant `evaluateBusiness` — the comment there
explains why it is a write and a re-entrancy hazard wearing a read's clothes.

### D5 — CORRECTED 2026-07-27 by research. Read this whole entry; the original is wrong.

**As originally written, D5 said:** quarantine retrieved page text the way `searchVault` fences
vault chunks into the loop, reusing the shipped SC2-fence pattern.

**That is not achievable, and a plan claiming it would ship a false property.**
`openai.tools.webSearch()` is a **provider-executed** tool: OpenAI performs the search AND reads
the pages server-side. The retrieved page text **never traverses our process**, so there is no
point at which our code could wrap it in a fence. Writing a "retrieved text is fenced" assertion
would produce a test that passes because the text is absent, not because it is contained — the
worst kind of green.

**What IS achievable, and what SC#2 must therefore be read as:**

1. **The capability grant is the containment** (this is the real defense, and it is stronger than
   fencing). The research specialist holds NO send/write/plan-mutation tool, so an instruction
   injected into a fetched page reaches an agent structurally incapable of acting on it. Prove it
   with a *positive* test: script an injected write-tool call during a research turn and assert
   the plan row does not move and no step is emitted.
2. **Fence the specialist's OUTPUT** where it re-enters the executive loop — that boundary IS ours.
   A labelled `<research_findings …>` fence around the returned prose.
3. **SSRF is structurally absent, and that is assertable.** Static scan: zero `fetch(` /
   `node:http` / `undici` / `axios` / `.request(` in the research code paths, plus a non-vacuity
   assertion that exactly one `openai.tools.webSearch(` declaration exists (otherwise the scan
   passes trivially on a file that does nothing).

The D1 instruction "this must be ASSERTED, not merely asserted-in-prose" stands and now has a
concrete shape. **Do not restore the original wording.**

### D6 — §4 applies to findings and lineage alike (SC#3)

Audit/telemetry rows for research carry **refs, ids, hashes and counts ONLY** — no page content,
no grounded prose, no query text (hash it, as `vault.searched` and `mailbox.searched` already do).
The sub-agent trace keeps the Phase-15 `rootRequestId` + `parentAgentId` lineage. Ship a
cross-tenant isolation assertion for the stored findings.

### D7 — Freshness stamp is a stored field, not prose (SC#2, SC#4)

The retrieval date must be queryable, so the Phase-12 engine can cite it and later distinguish
fresh from stale. A date mentioned inside generated markdown is not a freshness stamp.

### D8 — OQ-2 RESOLVED (owner, 2026-07-27): probe before pinning the model (LOCKED)

Ship `packages/backend/scripts/run-probe-websearch.mjs` as a **Wave-0 task**, and **gate writing
the research model constant on its result.** ONE real call, ≈$0.01, answering three things that
are otherwise guesses: does the model accept `openai.tools.webSearch`, do `sources` come back with
real parseable URLs, and what are the actual per-call fee and search-context token volume.

**Why this is worth a deployment round-trip for a cent.** OpenAI's own guide and pricing page
contradict each other on whether `gpt-4o-mini` supports the non-preview `web_search` tool, and
`gpt-4.1-nano` (the current `CHEAP_MODEL`) appears in neither. And the failure mode of guessing
wrong is **silent**: an unpriced model makes `priceUsage` return `Err`, `recordModelSpend` returns
`0`, and the run draws down **nothing** against the daily rail or the Phase-15 shared envelope.
A research specialist that appears free is worse than one that errors — the governance rail this
project is built on would be silently absent for exactly the phase that spends the most.

Research gets its **own model constant and its own `PRICING` row**; do not reuse `DEFAULT_MODEL`
or `CHEAP_MODEL` and do not assume either is priced for this path.

### D9 — OQ-1 RESOLVED (owner, 2026-07-27): both return paths, and amend the guard (LOCKED)

Support **both** the in-loop return (satisfying SC#1's "returns findings to the executive agent"
literally) **and** the async memo terminal (satisfying SC#2's vault-stored findings). They answer
different success criteria and neither alone covers both.

**The non-optional half: amend the `dispatchGuard.test.ts:16-24` comment in the SAME change.**
That comment argues against exactly the `ctx.runAction` shape the in-loop path needs. The
objection is answerable — the Phase-15 **shared cost envelope is the substitute rail** the comment
was protecting, and it did not exist when the comment was written — but an unamended comment
leaves a documented rule that the code now violates, and the next reader will treat it as
load-bearing. This is the D3 discipline applied to a second file: **when you relax a documented
invariant, correct the document in the same commit.** Ship a shared-envelope test alongside,
proving two research dispatches in ONE executive turn draw down ONE envelope.

### D9-REVISED — SUPERSEDES D9 (owner, 2026-07-27, after a wall-clock finding) (LOCKED)

**D9 above is SUPERSEDED. Read this instead.** D9 asked for both return paths and the plans
collapsed to an in-loop-only path; settling that deviation surfaced a fact that changes the
decision rather than confirming either side.

**The finding.** `llm.ts:1726-1727` — `stopWhen: stepCountIs(8)` and
`abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS)` (45_000) are arguments to the SAME
`generateText` call. In `ai@7` one `generateText` **is** the entire multi-step agentic loop, so the
45-second abort covers **every step together**, not one model round-trip. (The constant's comment
says "per-call wall-clock ceiling" — accurate when a "call" meant one round-trip, misleading now.)

**Why that is fatal to in-loop research.** Hosted `web_search` is the slowest operation in the
system — OpenAI runs the search AND reads the pages server-side. Decompose → 3-5 varied searches →
cross-check → synthesise, all inside 45 seconds, is not a safe bet. **D10 makes it worse by
construction:** "search several angles" is exactly the instruction that adds wall-clock. And the
failure is a THROW, not a graceful stop — `AbortSignal` fires → `isTimeoutError` →
`throw ConvexError({kind:"agent_timeout"})` (`llm.ts:1789`) — so the whole executive turn dies and
**every partial finding is discarded**. The `incomplete` marker never fires; it covers the COST and
STEP ceilings, not the clock.

**The decision: research runs on the ASYNC MEMO TERMINAL.** It dispatches as a scheduled background
run and lands as a memo plan card, the way the Growth OS specialists already do through
`dispatchAndLand`. No 45-second envelope, so D10's multi-angle depth becomes affordable instead of
a timeout risk.

**This is REUSE, not new construction (CLAUDE.md §8 rung 2).** The scheduled dispatch, the memo
terminal, the live `agentSteps` trace and the plan card all already ship. The executive answers
immediately ("researching that now"), the trace streams while it works, and the findings arrive as
an approvable card.

**The accepted cost, stated plainly so no one rediscovers it as a defect:** findings do NOT return
inside the same conversational turn. SC#1's "returns findings to the executive agent" is satisfied
**via the plan**, not inline. A verifier must not read SC#1 as requiring an in-conversation return.

**Consequence for the plans:** 16-06 (in-loop return) and 16-07 (terminal) both change. The D9
obligation to amend the `dispatchGuard.test.ts:16-24` comment may no longer apply — if no
`ctx.runAction` in-loop path ships, the comment stays TRUE and must be left alone. Re-derive that;
do not amend a comment the code no longer contradicts.

### D10 — "SOPHISTICATED": agentic depth on hosted search (owner directive, 2026-07-27) (LOCKED)

**Owner requirement, stated directly: "the research tool has to be sophisticated and highly
reliable."** This is an EXPLICIT request, so CLAUDE.md §8's lazy ladder does not apply to it —
§8 itself exempts "anything explicitly requested". Do not minimise this away; do not ship a
one-shot search and call it research.

**Sophistication lives in the SPECIALIST LOOP and its §5 skill body — not in new infrastructure.**
The hosted tool can be called repeatedly inside the governed loop, so depth costs prompt design
and step budget, not a new subsystem. A research run must:

1. **Decompose** the question into sub-questions rather than issuing one query.
2. **Search several angles** — multiple `webSearch` calls, deliberately varied, not one rephrase.
3. **Cross-check** claims across sources; a claim carried by one source is marked as such.
4. **Flag contradictions** explicitly when sources disagree — surfacing the disagreement is the
   correct output, not silently picking one.
5. **Cite per claim**, each with its retrieval freshness — not one bibliography at the end.
6. **Return "insufficient evidence"** as a first-class outcome. A research agent that confabulates
   when search comes back empty is worse than no research agent, because Phase 12 will cite it.

**The irreducible limit, and it must be recorded in the findings document itself:** hosted search
is provider-executed, so we cannot pin or choose sources, cannot control extraction fidelity, and
cannot see what was discarded. Downstream consumers (SC#4, the Phase-12 engine) must not treat a
finding as source-audited. State this in the stored doc; do not let it be inferred.

**Two constraints the planner must solve rather than discover:**

- **Step budget.** The loop runs `stopWhen: stepCountIs(8)`. Decompose → N searches → synthesise
  may not fit in 8 steps. Determine the real budget and raise it *for this route deliberately*, or
  design within it — but do not let a multi-search design silently truncate at step 8 and return a
  confident partial answer. A truncated research run must be MARKED, using the existing
  cost-ceiling `incomplete` marker precedent (`specialistMemoBody`).
- **Cost.** Several search calls per run multiplies the per-call fee, all of it drawn against the
  ONE Phase-15 shared root envelope. This makes D8's probe *more* load-bearing, not less — the
  fee has to be real before the envelope arithmetic means anything.

### D11 — "HIGHLY RELIABLE": a degradation contract, proven two ways (owner, 2026-07-27) (LOCKED)

Reliability here is not "it usually works" — it is **every failure mode having a defined, governed
outcome**, and that outcome being tested. Enumerate and specify at least:

| Failure mode | Required behaviour |
|---|---|
| Search call errors | Governed, retried where sensible, never an unhandled throw into the loop |
| Zero results | "Insufficient evidence" verdict — never a confident answer from model memory |
| Sources contradict | Contradiction surfaced in the findings, not silently resolved |
| Cost ceiling hit mid-run | Partial findings returned and MARKED incomplete (the `specialistMemoBody` precedent) |
| Step budget exhausted | Same — marked, never a silent truncation presented as complete |
| **Wall-clock budget approached** (added 2026-07-27) | **Same — partial findings returned and MARKED incomplete, NEVER a throw.** See below; this is the failure mode most likely to actually fire. |

**The wall-clock row is not a sixth item of equal weight — it is the one most likely to occur, and
today it is the only one that DISCARDS work.** `AbortSignal.timeout(45_000)` on the `generateText`
call aborts the whole loop and `llm.ts:1789` converts it to a thrown `agent_timeout`, so a run that
had already gathered four good sources returns nothing at all. Moving to the async terminal
(D9-REVISED) makes a timeout rarer; it does not make it a governed outcome. Both are required.

Reuse the `specialistMemoBody` incomplete-marker already used for the cost and step ceilings — a
research run that ran out of clock is exactly as "incomplete" as one that ran out of budget, and it
must be distinguishable in the marker text (the plans already assert cost-vs-steps produce DIFFERENT
text; make it three, not two). Test it offline with a scripted slow run — no live call needed.

**Proven two ways, both required:**

1. **Offline, deterministically** — scripted `MockLanguageModelV4` responses for each failure mode
   above, asserting the governed outcome. No deployment, no network, $0.
2. **`pnpm eval:golden` (the Phase-3.6 EVAL_GATE)** with golden fixtures, proving the §5 skill body
   *actually behaves* this way with a real model — specifically that it honours the
   untrusted-data instruction and returns "insufficient evidence" rather than confabulating.
   A skill-body change without an eval-gate run is not shippable in this repo, and this body's
   whole value is behavioural.

The deterministic half proves the CODE degrades correctly; the eval gate proves the PROMPT does.
Neither substitutes for the other — that split is the point.

### Claude's Discretion

- The exact vault document `kind` for findings, and whether findings reuse the existing ingest
  path or need their own.
- How the executive agent surfaces the research route (tool name, argument shape).
- Whether the `agentSteps.tool` literals are one (`dispatchResearch`) or two (plus a
  `webResearch` step) — driven by what the activity trace should show the user.
- Test topology, fixture choice, and which assertions get mutation-checked.

</decisions>

<specifics>
## Specific Ideas

- `specialists.ts` is the model to copy: `resolveSpecialist` fails closed to `unknown_route`,
  `wouldCycle` is unit-testable without a Convex harness, and the `as const satisfies Record<...>`
  table pattern makes a missing entry a COMPILE error rather than a silent fall-through. Extend
  those, do not parallel them.
- Wave-0 discipline applies: this phase and Phase 17 both add `agentSteps.tool` literals, `VERB`
  entries in `cards.tsx`, and possibly `ACTION_TYPES` members. See `.planning/PARALLELIZATION.md`
  — the shared unions land in ONE freeze commit on `main` before either lane executes.

</specifics>

<deferred>
## Deferred Ideas

- A self-fetching provider with a real SSRF guard (D1/D2) — deferred until something needs
  source-level control over which pages are read.
- Widening `diagnose()` to prescribe research as a gap remedy — ADR-009 territory; needs its own ADR.
- Source-level extraction/ranking control, and any second search vendor.

</deferred>

---

*Phase: 16-research-sub-agent-web-research*
*Context gathered: 2026-07-27 (owner decisions D1 and D3 resolved in session)*
