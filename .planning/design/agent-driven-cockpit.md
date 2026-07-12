# Design — Agent-Driven Cockpit (capability #1)

**Status:** proposed (brainstormed 2026-07-12)
**Scope:** Replace the deterministic FSM cockpit with an Executive Agent tool-loop so the
conversation is flexible ("remove Bob", "make it more formal, add Jane"), while every
governance invariant survives. This is **capability #1** of a three-part vision.
**Deferred (separate later milestone):** #2 campaign approval (approve-once-for-many),
#3 standing pre-authorized rules. Both depend on #1 and are out of scope here.

---

## 1. Problem

The current cockpit *looks* like a chat but is a deterministic finite state machine
(`emailIntent`: `parseAnswer` → `applyAnswer` → `nextQuestion`). The `@convex-dev/agent`
object is an inert message store — its `languageModel` is never called. The only LLM call
in the flow is the body draft (`draftCockpit`). Consequence: the agent cannot reason about
anything the user says. Typing "remove one of the recipients" does nothing useful — the FSM
maps the text to whichever slot is pending, and if it is already at `ready`, it just
re-renders the plan. This rigidity is what the user hit.

This was a deliberate call ("DECISION #2 — no LLM tool-loop") that bought safety/predictability
by spending flexibility. #1 buys the flexibility back **without** giving up the safety.

## 2. Goal

The Executive Agent drives the conversation by calling **governed tools**. Any reasonable
edit or instruction works conversationally. Approval stays exactly per-plan (unchanged). The
`plans` row stays the single source of truth the cards render from.

**Explicitly NOT in #1** (YAGNI): the scoped-approval / grant abstraction. Approval remains a
single per-plan human click. The scope object is a #2 concern; building it now is speculative.

## 3. Fixed frame — invariants that hold no matter what

1. **Redaction-before-draft:** the body-draft tool still runs `scanText` before the drafting
   sub-call; no raw PII reaches the drafting model (GRDL-01/02, §4).
2. **Human Approve before any send:** `executePlan` stays a `tenantMutation`, **never** an
   agent tool. It remains the sole `workflow.start(deliverApprovedPlan)` call site — the
   grep-able "zero sends before Approve" invariant.
3. **Structural facts never model-invented:** a recipient address is validated (`isValidEmail`)
   or resolved from a real mailbox match (`gmail.search` + `rankCandidates`). The model cannot
   hallucinate an address into the plan — enforced at the tool boundary, not by trusting the model.
4. **Refs-only logs (§4):** audit/DLQ/telemetry carry hashes/ids/counts only. The model
   *seeing* content ≠ *logging* it. No PII honeypot.

## 4. Architecture

**Tool-loop location.** A new internalAction `runCockpitAgent` lives inside the existing
`"use node"` `llm.ts` module — it MUST stay the only node module (a second one re-triggers the
TS circular-inference cliff, per the cockpit playbook / guidelines §96). It runs
`generateText({ model, tools, system, maxSteps })` where:
- `system` = a new **`cockpit-agent` skill** loaded from the registry (no hardcoded prompt, §5).
- `tools` = thin wrappers that call back into Convex via `ctx.runMutation`/`runAction`.

**`sendCockpitMessage` becomes a thin driver** (tenantAction, unchanged signature): save the
user turn → `preCall` gate → `runCockpitAgent` → tools mutate the `plans` row → save the
assistant reply → `recordSpend` → return `threadId`. The FSM path
(`parseAnswer`/`nextQuestion`/`questionText`/inline resolve-turn) is **retired**. Its validation
logic (`isValidEmail`, recipient bounce, `parseAddress`, `rankCandidates`) survives inside tools.

**Tool set** (each wraps an existing governed primitive):

| Tool | Wraps | Governance kept |
|------|-------|-----------------|
| `resolveContacts(name)` | `gmail.search` + `rankCandidates` + `writeCandidates` | headers-only; one `mailbox.searched` refs-only audit |
| `addRecipients` / `removeRecipient` / `setRecipients` | validate → `patchPlan` | `isValidEmail` bounce; names route through `resolveContacts`; ops by **index/label** (see §5) |
| `setSubject`, `setMode` | `patchPlan` | user-derived, never invented |
| `draftBody` | `scanText` (redact) → `draftCockpit` | redaction-before-model |
| `proposePlan` | `proposeEmailPlan` → status `proposed` | renders PLAN card |
| **(not a tool)** `executePlan` | human Approve mutation | **send stays a human click** |

**Data flow (one turn).** User types anything → agent reasons over history + plan state →
calls zero+ tools (which update the `plans` row; the resolution card / PLAN card re-render
reactively) → agent produces a natural reply → when it judges the plan complete it calls
`proposePlan` → human clicks Approve → `executePlan` fans out (unchanged).

**Cards are untouched.** `ResolutionCard` and the PLAN/REPORT cards already render reactively
off the `plans` row. Whether the FSM or an agent tool mutated that row is invisible to the UI.
#1 is almost entirely a backend swap: the conversational *engine* changes, the *surfaces* stay.

## 5. PII / redaction in the reasoning loop

**Unavoidable truth:** an agentic cockpit means the user's own typed messages reach the
reasoning model — that is what "chatting with an agent" is. GRDL-01/02 ("the model only ever
sees redacted `safeText`") was written for the one-shot pipeline; it does not literally survive
an interactive agent, and cannot (you can't redact "remove Bob" before the agent acts on Bob).
Approach A widens the data-to-LLM surface; we adopt it with eyes open.

**Decision (§2-D — index/label-based reasoning):** the agent sees recipients as `#1: Bob`,
`#2: Sarah` (display names + positions) and calls e.g. `removeRecipient(1)`. **Raw email
addresses never enter the model context** — they live in the `plans` row and are substituted
server-side inside the tool. Display *names* do reach the model, which is already accepted
(greeting personalization sends the display name today). Cost: an index→address lookup in the
tool. This preserves the crispest protective property ("no raw address reaches any model") for
little complexity, and avoids the tool-calling-accuracy hit of opaque placeholders.

**What stays intact:** refs-only logs (§4), the zero-retention/no-training LLM provider
contract (already a hard restricted-scope constraint), and `draftBody`'s redaction sub-call.

**Legal to-do (Phase-9 legal pass, not a build blocker):** confirm the privacy-policy processor
list covers *interactive* message content reaching the LLM (message content is already
disclosed; recipient display names in a live chat should be explicitly in scope).

## 6. Guardrails, error handling, testing

**Guardrails on the loop.** Every turn runs an LLM reasoning call (cost change vs one draft).
`runCockpitAgent` reuses the rails verbatim: `guardrails.preCall` gates before `generateText`
(a governed stop → "paused, try later" assistant message, never a DLQ); `maxSteps ≈ 8` bounds
the loop (ceiling without a proposal → agent asks rather than looping); `recordSpend` after the
call; `isFallbackEligible` → `CHEAP_MODEL` fallback, unchanged.

**Error handling** (every mode is conversational and non-dead-ending; the Approve gate is the
ultimate backstop — a misbehaving agent cannot send, only produce a rejectable `proposed` plan):
- Tool failure (e.g. `gmail.search` reauth) → structured error to the agent → reconnect banner
  (`notify`) + ask for the address.
- Hallucinated address → `addRecipients` validates → bounce → "not a valid email" back to the
  agent → re-ask.
- Loop exception → caught, saved as an assistant error turn, nothing sent; the partial `plans`
  row stays valid and continuable.

**Testing.** Tools are the governed units — each gets a unit test (validation bounce,
redaction-before-draft, refs-only audit), reusing the surviving `isValidEmail` /
`rankCandidates` / `parseAddress` tests. The loop gets an integration test with the AI SDK mock
model returning scripted tool calls (deterministic, no gateway). E2E stays on the `SMOKE::`
offline path (extended so a sentinel drives a fixed tool sequence); the resolution/PLAN card
specs are unchanged.

## 7. Rollout — clean cutover

Delete the FSM; ship the agent engine. Justified because the Approve gate contains the blast
radius, the cards are unchanged, and E2E + a human-verify checkpoint cover it. No dual-engine
maintenance. The new `cockpit-agent` system prompt is seeded into the skills registry; behavior
tuning + rollback flow through the registry (activate a prior version), never code edits (§5).

## 8. What changes (files)

- `packages/backend/convex/llm.ts` — add `runCockpitAgent` (the `generateText` tool-loop) + the
  tool wrappers. Stays the only `"use node"` module.
- `packages/backend/convex/cockpit.ts` — `sendCockpitMessage` becomes the thin driver; FSM
  glue (`parseAnswer`, `toIntentState`-driven question selection, `questionText`, inline
  resolve-turn) removed. `resolveRecipients` (card pick), `proposeEmailPlan`, `executePlan`,
  `listThreadMessages` unchanged.
- `packages/core/src/emailIntent.ts` — slim to the surviving pure helpers (`isValidEmail`,
  `parseAddress`, `rankCandidates`, contact types); the `applyAnswer`/`nextQuestion` state
  machine is retired.
- New skills-registry row: `cockpit-agent` system prompt (+ the seed constant kept in sync with
  its canonical `.md`, mirroring the router/drafter skills).
- `docs/playbooks/cockpit.md` — rewrite the "conversation engine" section (FSM → agent tool-loop),
  bump `Last verified`.
- Tests: per-tool unit tests, a mock-model loop integration test, extended `SMOKE::` E2E.

## 9. Out of scope / deferred

- **#2 campaign approval** (one approval authorizes many sends over a window; scheduling/
  sequencing) — new milestone. Introduces the scope/grant abstraction.
- **#3 standing pre-authorized rules** (agent acts within categories set once) — new milestone;
  a policy engine + revocation + per-action audit against a standing grant; largest CASA surface.
- The scoped-approval abstraction generally — built with #2, not #1.

## 10. Open questions

- **Contact-pick UX under the agent:** keep the clickable `ResolutionCard` for picks (agent
  triggers the search, human clicks the chip → `resolveRecipients`), vs. the agent asking in
  prose. Recommendation: keep the card (better UX, already built). Confirm during planning.
- **`SMOKE::` extension shape** for driving a deterministic tool sequence offline — pin the exact
  sentinel grammar during planning.
