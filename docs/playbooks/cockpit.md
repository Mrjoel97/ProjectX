# Playbook: Email Chat Cockpit

> Last verified: 2026-07-13 against 03.2.1-06 (Phase 3.2.1 Agent-Driven Cockpit, Wave 5 — PHASE CLOSE: the FSM→agent CUTOVER is complete and this playbook now documents the agent tool-loop as the LIVE runtime, not the retired FSM. The conversation engine is `runCockpitAgent` — a governed `generateText` tool-loop in `llm.ts` — driven by `sendCockpitMessage`, now a thin driver: ensure thread + `plans` row → save the user turn → `internal.llm.runCockpitAgent` in try/catch → save the reply as the assistant turn (a caught throw becomes a non-dead-ending error turn — nothing sent, partial plan valid; a `blocked` governed stop returns AS the paused reply). The deterministic `emailIntent` FSM glue (`parseAnswer`/`toIntentState`/`questionText`/`advance`/inline resolve-turn + the `@pikar/core` FSM imports) is DELETED — no dual engine; only the pure validators survive in `@pikar/core` (`isValidEmail`, `parseAddress`, `rankCandidates`, contact types, `buildRecipientView`, `applyRecipientEdit`). `resolveRecipients` (card pick) folds a pick directly via `applyRecipientEdit({op:'add'})` over held `pendingValid` + picks + `greetingName` from pick #1, then `clearCandidates`; the next user turn drives the agent. Send-safety spine UNCHANGED: `executePlan` approve-gate + `proposeEmailPlan` + `listThreadMessages`; `workflow.start(` remains the single call site in `executePlan`. Human-verify (Task 2) confirmed a real multi-turn conversational edit (resolve a name → ResolutionCard pick → "remove <name>" by name a turn later) reasons correctly on the live Gmail-connected backend and NOTHING sends before Approve (AGNT-01/AGNT-02). Rails reused VERBATIM: `guardrails.preCall` gates BEFORE the loop (a governed kill-switch/budget stop returns a conversational "paused" reply as DATA — never a throw/DLQ), `stopWhen: stepCountIs(8)` bounds the loop, `recordSpend` consumes the priced usage after, and an `isFallbackEligible` failure retries once on `CHEAP_MODEL`. A `SMOKE::agent::<op>` sentinel drives ONE governed tool call per user turn offline (the E2E path — no gateway). Mock-model loop test (`runCockpitAgent.test.ts`) proves a scripted edit sequence reaches a `proposed` plan, a kill-switch stop pauses without a DLQ, and the CHEAP_MODEL fallback + recordSpend both run — offline via the `__runCockpitAgentWithScript` shim. Prior (03.2.1-04, Wave 3): `llm.ts` gained `runCockpitAgent` as the ENGINE (not yet wired — the cutover was Plan 05). Prior (03.2.1-03, Wave 2): `llm.ts` exports `buildCockpitTools(ctx, tenantId, planId)` — the governed Executive-Agent tool set (resolveContacts / add·remove·set·Recipients / setSubject / setMode / draftBody / proposePlan), each a thin wrapper preserving its primitive's governance (invalid address bounces at the boundary, remove resolves a 1-based #index server-side, draftBody `scanText`-redacts BEFORE `draftCockpit`, proposePlan reads structural facts from the ROW) — plus `buildAgentContext` (index+label recipient view, address-free). `plans.getById` added so the node action reads the row by id. No `generateText` loop yet (Plan 04). Per-tool tests in `cockpitTools.test.ts`; static index/label proof added to `llmRedaction.test.ts`. Prior (03.2.1-01/02): the cockpit reasoning prompt loads from the registry as the `cockpit-agent` skill — 03.2.1-01 — and 03.2.1-02 added the pure `buildRecipientView` + `applyRecipientEdit` recipient tool-internals in `emailIntent.ts` that the Executive Agent tool-loop drives. Prior (03.2-06) — Phase 3.2 CLOSED: this playbook + watch update bless the phase's watched-file changes per §9 — `gmail.ts` is watch-protected under cockpit.md, the headers-only mailbox-read path, resolution flow, `resolveRecipients`, and transient candidate fields are documented, and CKPT-01 is confirmed by a real mailbox read that resolves a correspondent with nothing sent. Prior (03.2-05): the resolution CARD UI landed — `cards.tsx` `ResolutionCard` renders one chip-section per unresolved name (address + count/last-contacted hint) plus a pre-selected `pendingValid` "already valid" row, and calls `api.cockpit.resolveRecipients` on the pick; `ChatPane` shows a "Searching your mailbox…" activity chip while `plan.candidates` are parked; `cockpit-resolve.spec.ts` proves name→card→pick→PLAN offline with nothing sent; `cockpit-report.spec.ts` recipients line is comma-separated for the new tokenizer. Prior (03.2-04): resolution turn WIRED — cockpit runs `gmail.search`→`rankCandidates`→`writeCandidates` on an unresolved name, `resolveRecipients` folds the pick, `greetingName` threads to the drafter; DECISION #2 preserved, one LLM call; `/gmail/callback` 303-redirects to the app; `draftCockpit` SMOKE path honors `greetingName` so the resolution E2E asserts the greeting offline)
> Build history: `.planning/phases/03.1-cockpit-core/` (numbered `03.1-NN-PLAN.md` docs, `03.1-VALIDATION.md`, `deferred-items.md`) · Design: `.planning/design/email-chat-cockpit.md` · Related ADRs: [001](../decisions/001-convex-data-orchestration-plane.md), [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

A two-pane email workspace where the user drives a governed email send by chatting.
An **Executive Agent tool-loop** (`runCockpitAgent`) reasons over the conversation and
calls **governed tools** to fill the plan — the user can edit conversationally at any
turn ("remove Bob", "make it more formal, add Jane"), not walk a rigid slot script. The
tools (resolve contacts, add/remove/set recipients, set subject/mode, draft body, propose
plan) mutate the single `plans` row; a PLAN card is proposed, the user clicks Approve
**once**, and a live REPORT fills per-recipient as a fan-out workflow sends. It is a
wiring layer over the existing governed spine (gmail.send, audit, telemetry, DLQ,
WorkflowManager, `email-drafter` + `cockpit-agent` skills) — the agent engine reasons, but
every structural fact and send stays governed at the tool boundary and the human Approve gate.

## Key files

Frontend (`apps/web/app/(app)/dashboard/workspace/`):
- `page.tsx` — cockpit page; holds the shared `threadId` state, Gmail-status gate, renders SplitPane(ChatPane, CardList)
- `ChatPane.tsx` — left pane; `useThreadMessages` + composer calling `sendCockpitMessage`; lifts the minted threadId via `onThread`; 3.2: a "Searching your mailbox…" activity chip while `plan.candidates` are parked
- `cards.tsx` — right pane; `CardList` dispatcher + `PlanCard` (Approve button), `DraftCard`, `ReportCard`; 3.2: `ResolutionCard` (chip-section per unresolved name + `pendingValid` row → `resolveRecipients` on pick), dispatched during `collecting` BEFORE `proposed`
- `SplitPane.tsx` — native resizable split (a11y separator, ≥20% clamp, localStorage persist)

Backend (`packages/backend/convex/`):
- `cockpit.ts` — orchestration seam: `cockpitAgent` (message store), `sendCockpitMessage` (3.2.1: the THIN DRIVER over the agent loop — ensure thread + plans row → save user turn → `internal.llm.runCockpitAgent` in try/catch → save the assistant reply; a caught throw is a non-dead-ending error turn, a `blocked` governed stop returns AS the paused reply), `resolveRecipients` (folds a contact card pick via `applyRecipientEdit` — the next user turn drives the agent), `proposeEmailPlan` (code-invoked PLAN write, NOT a tool), `executePlan` (the human approve gate), `listThreadMessages`. The deterministic FSM glue (`parseAnswer`/`toIntentState`/`advance`/`questionText`/inline resolve-turn) is DELETED (3.2.1 cutover — no dual engine)
- `plans.ts` — content-plane adapter: `insertPlan` / `patchPlan` / `setPlanStatus` / `getById` (internal), `byThread`, `reportForPlan` (live REPORT projection); 3.2: `writeCandidates` / `clearCandidates` — the TRANSIENT contact-candidate store (`candidates` / `pendingValid` / `greetingName`, all optional plan fields). `getById` (3.2.1) is the by-id reader the `llm.ts` tool set uses (the node action has no `ctx.db`; `byThread` needs identity+threadId)
- `deliverApprovedPlan.ts` — the sole delivery workflow; per-recipient fan-out with try/catch isolation
- `llm.ts` (the SOLE `"use node"` module) → `runCockpitAgent` (3.2.1 — the LIVE conversation engine: `preCall` gate BEFORE the loop → `cockpit-agent` skill body as `system` → `buildAgentContext` + user text → `generateText({tools, stopWhen: stepCountIs(8)})` → `priceUsage`→`recordSpend`; `CHEAP_MODEL` fallback via the shared `runAgentLoop`; `SMOKE::agent::<op>` offline path) + `buildCockpitTools` (the governed Executive-Agent tool set) + `buildAgentContext` (index+label, address-free recipient view §2-D) + `draftCockpit` (loads the `email-drafter` skill; `SMOKE::` offline short-circuit; optional `greetingName` arg — resolved display name ONLY, never a header hint) + `__invokeCockpitTool` / `__runCockpitAgentWithScript` (test-only shims). The tools wrap `gmail.search` / `applyRecipientEdit` / `scanText`→`draftCockpit` / `proposeEmailPlan` — each preserving that primitive's governance
- `packages/contracts/skills/cockpit-agent.md` + `packages/contracts/src/skills/cockpitAgent.ts` — the Executive-Agent tool-loop system prompt (seeded as the `cockpit-agent` skill row; body loaded at runtime as `system`, never hardcoded §5); watch-protected under the skill-registry playbook
- `gmail.ts` (`"use node"`) — `send` (delivery) and 3.2's `search` (headers-only inbox read: `messages.list` + `format=metadata`, bodies never fetched); both share the single `freshAccessToken` refresh root
- `gmailAuth.ts` + `http.ts` `/gmail/callback` — the one-consent `gmail.modify` OAuth flow (state-token mint/verify, token store); callback bounces the browser back to the app, never dead-ends on the Convex site origin
- `schema.ts` — `plans` table (`by_thread`), `requests.planId` + `by_plan` index

Frontend prerequisite: `apps/web/app/(app)/connect-gmail/page.tsx` — the consent entry page (cockpit composer is gated on `gmailStatus`).

Pure core: `packages/core/src/emailIntent.ts` — 3.2.1: slimmed to the SURVIVING pure validators only (the `applyAnswer`/`nextQuestion` FSM state machine is DELETED): `isValidEmail`, `parseAddress`, `rankCandidates` (mailbox-header ranking), the `ContactMatch`/`NameCandidates`/`HeaderRecord` types, and the recipient tool-internals `buildRecipientView` (index+label, address-free) + `applyRecipientEdit` (add/remove/set with validation bounce) that the Executive-Agent tools drive. These live here (a sibling file would escape this playbook's watch).

Tests: `packages/backend/convex/cockpit.test.ts`, `packages/core/src/emailIntent.test.ts`,
`packages/backend/convex/cockpitTools.test.ts` (per-tool governance),
`packages/backend/convex/runCockpitAgent.test.ts` (mock-model loop),
`packages/backend/convex/llmRedaction.test.ts`, `apps/web/e2e/cockpit-report.spec.ts`,
`apps/web/e2e/cockpit-resolve.spec.ts`, `apps/web/e2e/connect-gmail.spec.ts`,
`apps/web/e2e/cockpit-render.spec.ts`, `apps/web/e2e/cockpit-split.spec.ts`,
`packages/backend/scripts/run-smoke-fanout.mjs`.

## Dependencies & blast radius

`graphify query "cockpit"` for the subgraph (note: it centers on `cockpit.ts`; the plan
row and delivery workflow live in `plans.ts`/`deliverApprovedPlan.ts` — include them
when assessing blast radius). Couplings graphify cannot see:
- `cockpit-agent` (reasoning loop, §5 fail-closed unseeded) + `email-drafter` (body draft) skill rows must be seeded (see skill-registry playbook)
- Gmail token via `gmailAuth.getTokens`; no token → `gmail_not_connected` refusal
- `AI_GATEWAY_API_KEY` absent ⇒ only the `SMOKE::agent::`/`SMOKE::` sentinel paths work (the E2E mode); REAL conversational reasoning (every turn is now an LLM call) needs the gateway
- Pinned components: `@convex-dev/agent@0.6.4` (in BOTH `packages/backend` and `apps/web`), `@convex-dev/workflow@0.4.4` — do not bump (CLAUDE.md §6; the agent's `languageModel` is an inert cast past an AI SDK version guard and breaks on bump)

## Data flow

1. ChatPane → `sendCockpitMessage`. First turn mints a `threadId` (`cockpitAgent.createThread`) and inserts ONE `plans` row at status `collecting`; threadId returns → page state → shared with CardList.
2. Each turn (`sendCockpitMessage`, the thin driver): save the user turn to the thread → `internal.llm.runCockpitAgent({tenantId, threadId, planId, text})` in a try/catch → save the returned reply as the assistant turn. A caught throw → a fixed "nothing was sent, try again" error turn (non-dead-ending; the partial plan row stays valid).
3. `runCockpitAgent` (one turn): `guardrails.preCall` gates BEFORE the loop (a governed kill-switch/budget stop returns a conversational "paused" reply as DATA — never a throw/DLQ) → loads the `cockpit-agent` skill body as `system` (fails closed unseeded, §5) → feeds `buildAgentContext(plan)` (index+label recipient view, address-free §2-D) + the user text to `generateText({model, system, tools: buildCockpitTools(...), stopWhen: stepCountIs(8)})` → the model calls zero+ governed tools that mutate the `plans` row (`resolveContacts`/add·remove·set recipients/`setSubject`/`setMode`/`draftBody`/`proposePlan`) → `priceUsage`→`recordSpend` → returns the assistant reply.
3a. **Contact resolution**: when the model calls `resolveContacts(name)`, the tool runs `gmail.search`→`rankCandidates`→`writeCandidates` (headers-only; one refs-only `mailbox.searched` audit) and returns display-name LABELS only. The candidates park on the plan row → `ResolutionCard` renders → the human picks a chip → `resolveRecipients` folds held `pendingValid` + picked addresses via `applyRecipientEdit`, captures `greetingName`, `clearCandidates` wipes on pick. The next user turn drives the agent from the updated row.
4. `draftBody` runs `scanText(bodyIntent)` (fail-closed redaction) BEFORE `draftCockpit` (the drafting sub-call). `proposePlan` → `proposeEmailPlan` reads recipients/subject/mode/body from the ROW (never model args) → flips plan → `proposed`.
5. CardList reactively (`api.plans.byThread`) shows PlanCard + DraftCard.
6. Approve → `executePlan`: CAS on `proposed` only; Gmail-token check; seeds one `requests` row per recipient (individual) or one comma-joined row (group), each with its own server-minted `correlationId` and shared `planId`; starts `deliverApprovedPlan` with `onComplete: onPipelineComplete`; plan → `delivering`.
7. `deliverApprovedPlan` loops rows: `gmail.send` (workpool retries) → `sent` + terminal telemetry; no token → held `awaiting_reauth`; throw → `deadLetterRecipient` for that row only, loop continues. Then plan → `done`.
8. REPORT: `reportForPlan` is a pure live projection over `requests` (`by_plan`) joined to `gmail.sent` audit rows — nothing stores a report array.

## Invariants — what must never break

- **Shared threadId contract**: page owns `threadId`; ChatPane lifts it via `onThread`; both panes receive it. Break the lift and cards desync from the conversation. Enforced only by E2E (`cockpit-report.spec.ts`) — no unit test.
- **The reasoning loop is governed, not free (3.2.1)**: every turn runs `runCockpitAgent`, and the rails bound it — `guardrails.preCall` gates BEFORE `generateText` (a governed kill-switch/budget stop returns a conversational "paused" reply as DATA, NEVER a throw/DLQ), `stopWhen: stepCountIs(8)` caps the loop (ceiling without a proposal → the agent asks rather than looping), `recordSpend` prices every call, and an `isFallbackEligible` failure retries once on `CHEAP_MODEL`. A loop exception is caught in `sendCockpitMessage` → a non-dead-ending assistant error turn (nothing sent, partial plan valid). Tested offline in `runCockpitAgent.test.ts` via the `__runCockpitAgentWithScript` mock-model shim.
- **`executePlan` is a human gate, not an LLM tool.** Idempotent CAS: only `proposed → approved` proceeds; double-approve is a no-op. Tested in `cockpit.test.ts` (SC4).
- **Zero sends before Approve**: `gmail.send` is called only inside `deliverApprovedPlan`, which is started only by `executePlan`. Tested in `cockpit.test.ts`.
- **Per-recipient correlationId**, server-minted, never client-supplied — a shared cid collapses audit/telemetry/DLQ isolation (telemetry is write-once per cid). Exercised by `smoke:fanout`.
- **Redaction (CLAUDE.md §4)**: recipients/subject/body live only in content-plane `plans`/`requests`; audit/DLQ/telemetry payloads carry refs only. Enforced statically by `llmRedaction.test.ts`; at runtime by `assertNoRawPiiFanout` in `smoke:fanout`.
- **No NEW `"use node"` modules**: `draftCockpit` stays inside `llm.ts`, `search` stays inside `gmail.ts` (the two pre-existing node modules); adding another re-triggers a TS circular-inference cliff (see `03.1-RESEARCH*.md` §6; Convex guidelines §96).
- **Contacts are transient (3.2)**: `candidates`/`pendingValid` are held on the plan row only between search and pick — `clearCandidates` unsets BOTH on pick ("no contacts cache at rest" is structural); `greetingName` alone survives to the draft turn. Candidate payloads live on the content plane only and are NEVER audited (CLAUDE.md §4); the sole search audit is refs-only `mailbox.searched {queryHash, resultCount}`.
- **Inbox reads are headers-only (3.2)**: `gmail.search` fetches `format=metadata` (From/To/Cc/Subject/Date) — message bodies never leave Gmail; read-time auth failure returns `{ok:false, reason}` WITHOUT throwing (a dead token is a reauth prompt, not a DLQ entry).
- **The search audit lives in `gmail.ts` (3.2)**: the sole `mailbox.searched` write is emitted by `gmail.search` itself (refs-only `{queryHash, resultCount}`, SC3) so `cockpit.ts` stays `audit.log`-free — the orchestration seam never touches the audit plane, and there is exactly one audit per search.
- **The drafter gets the display name ONLY (3.2, SC3)**: `draftCockpit`'s single mailbox-derived arg is `greetingName`; header hints (`lastSubject`/`lastDateMs`/`count`/raw `matches`) MUST NOT reach the LLM. Enforced statically by `llmRedaction.test.ts` (a scoped scan of the `draftCockpit` code surface).
- **The tools ARE the enforcement boundary — structural facts are never model-invented (3.2.1)**: `buildCockpitTools` never trusts a structural fact from the model. An invalid address bounces in `applyRecipientEdit` and never enters `recipients` (the tool does NOT patch on a bounce); a named person routes through `resolveContacts` (real `gmail.search` match), never a hallucinated address; `removeRecipient` takes a 1-based `#index` ONLY and resolves the address server-side; `draftBody` runs `scanText` (fail-closed) BEFORE `draftCockpit`; `proposePlan` reads recipients/subject/mode/body from the ROW, never from model args. Enforced by `cockpitTools.test.ts` (per-tool) + `llmRedaction.test.ts` (redact-before-draft scan).
- **The model never sees a raw address (§2-D, 3.2.1)**: `buildAgentContext` emits the `buildRecipientView` index+label view (`#1: Bob`); addresses live in the `plans` row and are substituted server-side inside the tools. Display *names* reach the model (already accepted for greeting personalization); raw addresses never do. Enforced statically by `llmRedaction.test.ts` (index/label context scan).
- **`SMOKE::` sentinel** (`SMOKE::route=<route>::`, parsed in `llm.ts`): deterministic offline draft path used by all E2E; contains no PII and must survive redaction verbatim.
- **Tenant wrappers only** (CLAUDE.md §2): all cockpit functions use `tenantQuery`/`tenantMutation`/`tenantAction`. Enforced by biome + `importGuard.test.ts`.

## How to change safely

- **Changing the agent's conversational behavior**: tune the `cockpit-agent` skill row (registry, §5) — NOT code; rollback = activate a prior version. Never hardcode the prompt in `llm.ts`.
- **Adding/changing a governed tool**: add the `tool()` wrapper in `buildCockpitTools` + its `cockpitTools.test.ts` case (validation bounce / redaction / refs-only audit); a new structural field also needs the `plans` schema column and `buildAgentContext` if the model must reason over it. The tool — never the model — validates or resolves the fact.
- **Touching `executePlan` or delivery**: re-read the CAS and per-cid invariants above; re-run `cockpit.test.ts` AND `smoke:fanout` (convex-test cannot execute the workflow component — the unit suite never drives the successful `proposed → delivering` path, only the smoke script does).
- **Adding any new logging/telemetry in the cockpit path**: payloads must be refs/hashes/ids/counts only; extend `llmRedaction.test.ts` to cover the new write.
- **UI changes**: keep the threadId lift intact; re-run `cockpit-render` / `cockpit-split` / `cockpit-report` specs.

## How to verify

- `pnpm --filter @pikar/core test` — the surviving pure validators: `isValidEmail`, `parseAddress`, `rankCandidates`, `applyRecipientEdit` (add/remove/set bounce), `buildRecipientView`
- `pnpm --filter @pikar/backend test` — approve-gate invariants, per-tool governance (`cockpitTools.test.ts`), the governed loop (`runCockpitAgent.test.ts` — scripted edit → `proposed`, kill-switch pause without a DLQ, CHEAP_MODEL fallback), redaction static scan (incl. index/label context + the `mailbox.searched` payload assertion: exactly `{queryHash, resultCount}` — no name/address/subject, SC3)
- `pnpm --filter @pikar/backend smoke:fanout` — needs a running `convex dev` + seeded skills; proves fan-out isolation, one-terminal-per-recipient, no raw PII in any log plane
- Playwright E2E (needs `convex dev` non-`--once` + `next dev` on :3111, signed-in via `auth.setup.ts`; see `apps/web/e2e/README.md`): `pnpm exec playwright test cockpit-report` (full chat→plan→approve→report over `SMOKE::`), `cockpit-resolve` (name→resolution card→pick→PLAN over `SMOKE::`, nothing sent), `connect-gmail`, `cockpit-render`, `cockpit-split`
- Manual-only: a real Gmail send (the E2E harness user has a stale token, so sends settle at `awaiting_reauth` by design; see `03.1-VALIDATION.md`)

## Operational notes

- Seed skills or drafting fails: `npx convex run skills:seedSkills` (the `dev` script auto-runs it)
- Offline/E2E mode = no `AI_GATEWAY_API_KEY` on the backend deployment
- Divider position persists per-browser (localStorage), not cross-device

## Known gaps & deferred work

- Attachments: `AttachmentPicker` uploads only; wiring storageIds into the plan is deferred (Phase 4, INTK-02)
- DraftCard has no inline editor — edits arrive as new guided-conversation turns
- `rejected` is transient, not a plan column; cross-turn per-address re-ask needs a schema change
- Divider persistence ceiling: localStorage → Convex userPrefs if cross-device matters
