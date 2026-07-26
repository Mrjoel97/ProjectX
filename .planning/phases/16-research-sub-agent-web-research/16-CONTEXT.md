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
