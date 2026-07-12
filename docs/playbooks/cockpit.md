# Playbook: Email Chat Cockpit

> Last verified: 2026-07-12 against c577890
> Build history: `.planning/phases/03.1-cockpit-core/` (numbered `03.1-NN-PLAN.md` docs, `03.1-VALIDATION.md`, `deferred-items.md`) · Design: `.planning/design/email-chat-cockpit.md` · Related ADRs: [001](../decisions/001-convex-data-orchestration-plane.md), [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

A two-pane email workspace where the user drives a governed email send by chatting.
A deterministic guided conversation fills slots (recipients → subject → body intent →
mode), the LLM drafts a body once, a PLAN card is proposed, the user clicks Approve
**once**, and a live REPORT fills per-recipient as a fan-out workflow sends. It is a
wiring layer over the existing governed spine (gmail.send, audit, telemetry, DLQ,
WorkflowManager, `email-drafter` skill) — not a separate engine.

## Key files

Frontend (`apps/web/app/(app)/dashboard/workspace/`):
- `page.tsx` — cockpit page; holds the shared `threadId` state, Gmail-status gate, renders SplitPane(ChatPane, CardList)
- `ChatPane.tsx` — left pane; `useThreadMessages` + composer calling `sendCockpitMessage`; lifts the minted threadId via `onThread`
- `cards.tsx` — right pane; `CardList` dispatcher + `PlanCard` (Approve button), `DraftCard`, `ReportCard`
- `SplitPane.tsx` — native resizable split (a11y separator, ≥20% clamp, localStorage persist)

Backend (`packages/backend/convex/`):
- `cockpit.ts` — orchestration seam: `cockpitAgent`, `sendCockpitMessage` (guided turn), `parseAnswer` (pure), `proposeEmailPlan`, `executePlan` (the human approve gate), `listThreadMessages`
- `plans.ts` — content-plane adapter: `insertPlan` / `patchPlan` / `setPlanStatus` (internal), `byThread`, `reportForPlan` (live REPORT projection)
- `deliverApprovedPlan.ts` — the sole delivery workflow; per-recipient fan-out with try/catch isolation
- `llm.ts` → `draftCockpit` — the ONLY `"use node"` module; loads the `email-drafter` skill; `SMOKE::` offline short-circuit
- `schema.ts` — `plans` table (`by_thread`), `requests.planId` + `by_plan` index

Pure core: `packages/core/src/emailIntent.ts` — `nextQuestion` / `applyAnswer` slot logic.

Tests: `packages/backend/convex/cockpit.test.ts`, `packages/core/src/emailIntent.test.ts`,
`packages/backend/convex/llmRedaction.test.ts`, `apps/web/e2e/cockpit-report.spec.ts`,
`apps/web/e2e/connect-gmail.spec.ts`, `apps/web/e2e/cockpit-render.spec.ts`,
`apps/web/e2e/cockpit-split.spec.ts`, `packages/backend/scripts/run-smoke-fanout.mjs`.

## Dependencies & blast radius

`graphify query "cockpit"` for the subgraph (note: it centers on `cockpit.ts`; the plan
row and delivery workflow live in `plans.ts`/`deliverApprovedPlan.ts` — include them
when assessing blast radius). Couplings graphify cannot see:
- `email-drafter` skill row must be seeded (see skill-registry playbook)
- Gmail token via `gmailAuth.getTokens`; no token → `gmail_not_connected` refusal
- `AI_GATEWAY_API_KEY` absent ⇒ only `SMOKE::` drafts work (this is the E2E mode)
- Pinned components: `@convex-dev/agent@0.6.4` (in BOTH `packages/backend` and `apps/web`), `@convex-dev/workflow@0.4.4` — do not bump (CLAUDE.md §6; the agent's `languageModel` is an inert cast past an AI SDK version guard and breaks on bump)

## Data flow

1. ChatPane → `sendCockpitMessage`. First turn mints a `threadId` (`cockpitAgent.createThread`) and inserts ONE `plans` row at status `collecting`; threadId returns → page state → shared with CardList.
2. Each turn: `parseAnswer(nextQuestion(state), text)` maps free text to a typed answer for the slot last asked; `applyAnswer` (pure core) folds it in; `patchPlan` persists. Invalid recipients are never stored — valids persist, first bad address is re-asked.
3. Not ready → deterministic assistant question saved to the thread; no card yet.
4. Ready → `scanText(bodyIntent)` redacts (fail-closed) → `draftCockpit` produces the body (the ONLY LLM call) → `proposeEmailPlan` flips plan → `proposed`.
5. CardList reactively (`api.plans.byThread`) shows PlanCard + DraftCard.
6. Approve → `executePlan`: CAS on `proposed` only; Gmail-token check; seeds one `requests` row per recipient (individual) or one comma-joined row (group), each with its own server-minted `correlationId` and shared `planId`; starts `deliverApprovedPlan` with `onComplete: onPipelineComplete`; plan → `delivering`.
7. `deliverApprovedPlan` loops rows: `gmail.send` (workpool retries) → `sent` + terminal telemetry; no token → held `awaiting_reauth`; throw → `deadLetterRecipient` for that row only, loop continues. Then plan → `done`.
8. REPORT: `reportForPlan` is a pure live projection over `requests` (`by_plan`) joined to `gmail.sent` audit rows — nothing stores a report array.

## Invariants — what must never break

- **Shared threadId contract**: page owns `threadId`; ChatPane lifts it via `onThread`; both panes receive it. Break the lift and cards desync from the conversation. Enforced only by E2E (`cockpit-report.spec.ts`) — no unit test.
- **Deterministic control**: the agent thread is a message store ONLY; the agent never runs generateText/streamText. The LLM is invoked exactly once, for the body draft. Slot logic is pure code (`emailIntent.ts`), tested in `emailIntent.test.ts`.
- **`executePlan` is a human gate, not an LLM tool.** Idempotent CAS: only `proposed → approved` proceeds; double-approve is a no-op. Tested in `cockpit.test.ts` (SC4).
- **Zero sends before Approve**: `gmail.send` is called only inside `deliverApprovedPlan`, which is started only by `executePlan`. Tested in `cockpit.test.ts`.
- **Per-recipient correlationId**, server-minted, never client-supplied — a shared cid collapses audit/telemetry/DLQ isolation (telemetry is write-once per cid). Exercised by `smoke:fanout`.
- **Redaction (CLAUDE.md §4)**: recipients/subject/body live only in content-plane `plans`/`requests`; audit/DLQ/telemetry payloads carry refs only. Enforced statically by `llmRedaction.test.ts`; at runtime by `assertNoRawPiiFanout` in `smoke:fanout`.
- **Single `"use node"` module**: `draftCockpit` must stay inside `llm.ts`; a second node module re-triggers a TS circular-inference cliff (see `03.1-RESEARCH*.md` §6).
- **`SMOKE::` sentinel** (`SMOKE::route=<route>::`, parsed in `llm.ts`): deterministic offline draft path used by all E2E; contains no PII and must survive redaction verbatim.
- **Tenant wrappers only** (CLAUDE.md §2): all cockpit functions use `tenantQuery`/`tenantMutation`/`tenantAction`. Enforced by biome + `importGuard.test.ts`.

## How to change safely

- **Adding a slot to the guided conversation**: change `emailIntent.ts` (pure) first + its test; then `parseAnswer` mapping in `cockpit.ts`; then the `plans` schema column. The slot order and never-ready-early property are what `emailIntent.test.ts` protects.
- **Touching `executePlan` or delivery**: re-read the CAS and per-cid invariants above; re-run `cockpit.test.ts` AND `smoke:fanout` (convex-test cannot execute the workflow component — the unit suite never drives the successful `proposed → delivering` path, only the smoke script does).
- **Adding any new logging/telemetry in the cockpit path**: payloads must be refs/hashes/ids/counts only; extend `llmRedaction.test.ts` to cover the new write.
- **UI changes**: keep the threadId lift intact; re-run `cockpit-render` / `cockpit-split` / `cockpit-report` specs.

## How to verify

- `pnpm --filter @pikar/core test` — slot ordering, invalid-email re-ask, never-ready-early
- `pnpm --filter @pikar/backend test` — approve-gate invariants, `parseAnswer`, redaction static scan
- `pnpm --filter @pikar/backend smoke:fanout` — needs a running `convex dev` + seeded skills; proves fan-out isolation, one-terminal-per-recipient, no raw PII in any log plane
- Playwright E2E (needs `convex dev` non-`--once` + `next dev` on :3111, signed-in via `auth.setup.ts`; see `apps/web/e2e/README.md`): `pnpm exec playwright test cockpit-report` (full chat→plan→approve→report over `SMOKE::`), `connect-gmail`, `cockpit-render`, `cockpit-split`
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
