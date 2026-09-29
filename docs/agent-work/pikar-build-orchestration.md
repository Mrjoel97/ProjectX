# Pikar AI thin-root build orchestration

Status: active project workflow

Adapted from the MIT-licensed
[Astra Flash Orchestrator](https://github.com/ethanplusai/astra-flash-orchestrator)
at commit `bcc7f9eaee051126c0ce821a55194d0b20425b22`. This is contributor workflow
guidance only. It is not shipped in the Pikar AI application and grants no runtime authority to
the upstream repository.

Scope: use this workflow to develop Pikar AI itself. Do not register Astra as an app skill,
expose it to customers, or add it as a product dependency. This is separate from the UI/UX,
taste, and eCommerce repositories requested for customer website-building capabilities.

## Purpose

Use the strongest root reasoning where it has the most leverage, while assigning implementation
volume to one bounded native worker. The root remains responsible for the product and accepts or
rejects the result; the worker never self-approves.

## Routing decision

- Keep a small fix, explanation, or explicitly single-agent task in the root session.
- For substantial implementation with a stable contract, delegate one coherent plan or vertical
  slice to one native lower-cost worker.
- Keep architecture, authentication/authorization, tenancy, payments, secrets, destructive
  migrations, production behavior, and other high-impact decisions with the root. The worker may
  implement an already-settled contract but must not invent it.
- Reuse approved `.planning`/GSD artifacts. Add an execution mapping only when needed; do not fork
  the requirements into a rival planning system.

## Route truth

Owner decision, updated 2026-09-24: **native OpenAI models remain the default**. The owner also
approved an opt-in, development-only DeepSeek V4 Flash worker using the app's existing OpenRouter
key from `.env` in process memory. This is a separate route in `pikar-flash-routing.json`; it does
not change the app's OpenRouter setup, the root model, or native worker dispatch. No global Codex
Router installation or new provider key is needed. See the development-orchestration playbook for
its bounded launcher and verification status. Do not silently substitute Flash for a native tier.

`docs/agent-work/pikar-build-routing.json` is the project dispatch policy, not a Codex host
configuration file. The orchestrator applies it through the existing native collaboration tool:
use explicit `model` and `reasoning_effort`, a clean `fork_turns: "none"`, and the advertised
`worker` role for new implementation bundles. Do not create a hidden CLI or pretend that this
JSON installs a custom role. Existing workers keep their original selected model.

- Luna (`gpt-6-luna`, high): routine bounded implementation, focused tests and dev tooling.
- Terra (`gpt-5.6-terra`, medium): straightforward low-risk docs/configuration or bounded analysis.
- Sol (`gpt-6-sol`, high): complex multi-file changes, debugging and protocol/browser integration.
- Astra stays root: architecture, sensitive decisions and one batched acceptance review.

These are task-routing heuristics, not measured price or quality rankings. Flash is an optional
choice for low-risk, bounded work, not an asserted quality-equivalent replacement for Sol or the
root. Before every new native
dispatch verify the exact model remains advertised by the host; never invent `gpt-6-terra` or
silently substitute a model. Record the choice and reason in the task brief. If unavailable,
reassess explicitly using available user-approved native models.

Verify actual selection from child `turn_context.model` and session provider metadata, not the
worker's prose. This proves host selection, not an independently observed provider response.
Use metadata-only usage measurement; no external billing, maximum savings or percentage reduction
can be inferred from model names, task counts, elapsed time or the upstream benchmark.
See `docs/agent-work/astra-routing-status.md` for current evidence and measurement limits.

For an explicitly selected Flash task, use `node scripts/dev-orchestration/flash-worker.mjs plan`
first. `quick` sends a bounded brief directly to OpenRouter and saves a proposal for root review;
it cannot edit files or run tests. `run --brief <file> --write` can execute an in-scope task through
Codex, but its larger harness may consume far more input tokens. Default `run` is read-only. The
launcher reports observed response/turn usage and never prints the key or task content. A model
probe verifies routing only, not output quality, billed savings, or production readiness.

For a machine-checked native dispatch preview, run
`node scripts/dev-orchestration/report.mjs dispatch --policy docs/agent-work/pikar-build-routing.json --tier routine`
(or `straightforward` / `complex`). Pass the resulting model/effort/context settings through the
actual native tool with the task brief; this preview does not launch a worker. See
`docs/playbooks/dev-orchestration.md` for metadata-only reports and compatible interval comparison.

## Prepare one executable brief

Before dispatch, capture:

1. Objective and visible acceptance outcome.
2. Existing plan/spec and prerequisite outputs.
3. Exact owned files or modules and forbidden changes.
4. Interfaces, failure/refusal behavior, compatibility, and negative cases.
5. Required tests, browser evidence, graph refresh, and completion report.
6. Current workspace facts needed to preserve pre-existing edits. Git absence or a dirty tree must
   be reported honestly; never invent commits, branches, or SHAs.

Keep the brief implementation-complete but not implementation-prescriptive. A worker owns routine
repository discovery and its internal test/fix loop inside the boundary.

## Dispatch and wait

- One active writer in the shared workspace is the default.
- Tell the worker it is not alone, must preserve unrelated edits, and may modify only its assigned
  paths plus explicitly named reports/status files.
- Use a clean child context when available and provide the brief plus minimum required artifacts.
- Disable recursive delegation for the worker. Do not launch another coding CLI or background agent
  harness.
- Let the worker run through implementation, tests, debugging, and routine UI validation. Use the
  longest practical native wait; do not poll, request play-by-play updates, interrupt a healthy
  run, or duplicate its investigation.
- A timeout alone is not failure. Send one targeted clarification only for a real contract or
  environment blocker.

Two writers are allowed only when the plan proves independent scopes and separate workspaces.
Shared contracts, schema, routes, dependency files, generated files, and planning state are serial.

## Root acceptance gate

Worker status is `ready_for_review`, `blocked`, or `failed`; never `accepted`.

The root performs one batched review of the actual changed and newly created files:

1. **Specification:** map every acceptance criterion and non-goal to code, tests, or observed
   behavior; check boundaries, failure states, compatibility, and missing work.
2. **Quality and risk:** inspect data flow, authorization/tenancy, error handling, lifecycle cleanup,
   concurrency, types, test realism, dependency changes, and repository conventions.

Start from the worker's recorded commands and exit statuses. Rerun only checks whose evidence is
missing, plausibly stale, integration-sensitive, or high-risk. If corrections are required, send
all file-specific findings to the same worker in one request and normally allow one correction
cycle. The root alone records acceptance.

## GSD integration

For serial GSD plans, one plan is one default worker bundle:

`verified plan → one worker → completion evidence → root acceptance → next dependent plan`

Do not start a dependent wave before the prior result is accepted. Each plan leaves its normal
SUMMARY/checkpoint artifacts. Run cross-plan suites once at the genuine integration boundary, then
perform the phase verifier. Wave 7 external enablement and Wave 8 exact-production founder
acceptance remain separate evidence layers regardless of local worker success.

## External-action boundary

This workflow does not itself authorize provider spend, production access, deployment, publication,
outbound messages, merchant/payment operations, destructive migrations, commits, pushes, or branch
integration. Apply the user's current authorization and the repository's existing gates to each
such action. Never use a cheaper-worker workflow to weaken those controls.
