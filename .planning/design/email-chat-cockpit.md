---
title: Email Chat Cockpit — approved design
status: approved-design (feeds future GSD phase planning)
approved: 2026-07-11
sequencing: v1 milestone, AFTER Phase 3 (Guardrails). Cockpit REPLACES the Phase 2
  form/queue UX; the governed backend spine is reused unchanged.
decisions:
  - Chat cockpit over the existing governed engine (not a rewrite)
  - Approval moves to the PLAN (approve once, then hands-off autonomous execution)
  - Intake is GUIDED conversational (known email checklist, asks only what's missing)
---

# Email Chat Cockpit

Reshapes intake/approval from the manual `/submit` form + `/review` queue into a
conversational cockpit, WITHOUT rebuilding the governed engine (auth, Gmail, audit,
telemetry, DLQ, tenant scoping, skills registry, durable workflows all reused).

## Slices (each becomes a GSD phase)
1. **Cockpit core** (this design) — chat workspace, guided conversation, plan-approval,
   hands-off multi-recipient send, report.
2. **Inbox reading** — search/read the mailbox to find people & context.
3. **Attachment generation** — agent creates a document and attaches it.
4. **Per-recipient personalization** — tailored wording per person.
- Groundwork: fix the Connect-Gmail infinite-loading bug (client auth token not
  attaching on the Google-authed session) — prerequisite for any cockpit use.

## Layout & visual system
- `/dashboard/workspace`, two panes: **chat 30% / workspace 70%**, **draggable divider**
  (min ~20% each; persisted per user).
- Teal design tokens (sampled from the reference screenshot):
  - `teal-900 #0B4F4A` — left rail / dark frame
  - `teal-600 #009689` — primary action (send, active tab, Approve, CTAs)
  - `teal-400 #40CAD0` — highlight / logo / glow
  - `slate-50 #F8FAFC` — app canvas / panels · `#FFFFFF` cards & bubbles
- **Left = conversation**: thread + live activity chips ("Drafting…", "Awaiting your
  approval", "Sending to 5", "Sent ✓") + composer (text, attach, mic, teal send).
- **Right = workspace canvas**: artifacts render as cards, "synced to workspace history":
  - **PLAN** card — recipient chips, mode, subject, body preview, steps, one **Approve**.
  - **DRAFT** (`EMAIL`) card — full email; editable via chat.
  - **REPORT** card — per-recipient send status + message id + audit link.

## Guided conversation (slot-filling)
Pure, testable `emailIntent` module (`packages/core`) tracks slots; the agent asks only
for what's missing, one topic at a time:
| Slot | Required | 
|---|---|
| recipients (≥1 valid email) | yes |
| subject | yes |
| body intent (→ agent drafts wording) | yes |
| attachment | optional (upload only in slice 1; generation is a later slice) |
Invalid email → re-ask that one. Ambiguous goal → one focused question. Never guesses a
recipient or sends on assumption. Slots complete → drafts body → assembles PLAN card.

## Multiple recipients
Collect 1…N recipients. For >1, the agent asks the one question that matters:
- **Individual copies** (safe default) — each person gets their own private email.
- **Group email** — one email, all in `To:`, mutually visible.
Same content to all in slice 1 (personalization = later slice). PLAN card shows recipients
+ mode explicitly before approval. REPORT card fills per-recipient, live.

## Backend flow & reuse map
1. Goal → **agent thread** (`@convex-dev/agent`, already installed).
2. Guided conversation (driven by `emailIntent`), drafts via the registry **drafter skill**
   (no hardcoded prompts).
3. `proposeEmailPlan` tool → PLAN artifact → PLAN card.
4. **Approve** (single gate) → `executePlan`.
5. Lean **`deliverApprovedPlan` durable workflow** fans out: per recipient runs existing
   `gmail.send` + retrier + audit + telemetry + DLQ.
6. REPORT artifact updates per recipient, live.

| Reused as-is (governance) | New (cockpit) | Kept, retired later |
|---|---|---|
| `gmail.send`, `gmailAuth`, reconnect | agent thread + guided conversation | `/submit` form |
| `audit`, `telemetry`, `deadLetters` | `emailIntent` (core, tested) | `/review` queue |
| tenant scoping wrappers | `proposeEmailPlan`/`executePlan` tools | `pipelineWorkflow` review-gate pause |
| skills registry (drafter) | plan/draft/report artifacts table | |
| durable Workflow + retrier | `deliverApprovedPlan` fan-out workflow | two-pane cockpit UI |

**Key decision:** old pipeline paused mid-run at a review gate; the cockpit approves at the
PLAN (before execution), so execution is a straight, hands-off, governed fan-out. The
review-gate pause is NOT reused for this flow; the delivery/audit/telemetry/DLQ primitives are.

## Scope of slice 1
IN: cockpit UI (resizable), guided conversation, plan-approval, multi-recipient
(individual + group, same content), artifacts/history, governance reuse, Connect-Gmail bug fix.
OUT (later slices): inbox reading, attachment generation, per-recipient personalization,
voice, retiring the old pages.

## Error & edge handling (nothing sends on an assumption)
| Situation | Behavior |
|---|---|
| No Gmail connected | stop, prompt to connect before planning |
| Invalid recipient | re-ask that one; never send to a bad address |
| Ambiguous goal | one focused clarifying question |
| Token expired mid-send | that recipient row shows "reconnect"; reconnect resumes |
| One recipient fails (fan-out) | dead-lettered + shown on its row; the rest still send |
| Draft/LLM failure | reported in chat, retryable; `SMOKE::` path works offline |
| Not yet approved | hard rule: zero sends before Approve |
| Double-approve | idempotent — sends once |

## Testing
- `emailIntent` slot logic → pure assert-based unit tests.
- `deliverApprovedPlan` fan-out → smoke script (Windows-safe `smokeRun`): per-recipient
  audit/telemetry, forced failure lands in DLQ.
- Playwright E2E: chat → plan → approve → per-recipient report (offline `SMOKE::` path).
- Governance invariant: no raw email content in any audit/DLQ payload.
