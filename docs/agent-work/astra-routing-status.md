# Astra development routing — activation record

Checked: 2026-09-26. Scope: contributor tooling only; no app/runtime integration.

## 2026-09-27 current-session route check

The current collaboration tool catalog advertises `deepseek-v4.1-flash:cloud`, `glm-5.3-flash:cloud`, `glm-5.3:cloud`, `gemma4:31b-cloud` and `gemma4:26b`, but **not** the native policy's `gpt-6-sol`, `gpt-6-luna` or `gpt-5.6-terra`. Thus the checked-in native dispatch preview cannot be treated as an executable selection in this session; the September 23 Sol/Luna observations remain historical. The earlier September 25 attempts to use available lower-cost host models were rejected before work, as documented below; no retry or replacement spawn was attempted here.

Fresh `report.test.mjs` plus `flash-worker.test.mjs` pass **22/22**. `flash-worker.mjs plan` still prints an opt-in, development-only OpenRouter Responses plan pinned to `deepseek/deepseek-v4-flash-0731`; `report.mjs dispatch --tier complex` still prints `plan_only_not_executed` for native Sol. Neither command reads the app key, invokes a model, executes a worker, changes provider configuration or measures savings. The previously observed direct Flash route remains the last live route proof, not a current-task usage or quality verdict. Root must review an actual bounded worker result before attributing accepted implementation or credit savings to it.

## Current-session worker availability

The 2026-09-25 native collaboration catalog did not advertise the policy's Luna/Sol/Terra
models. One bounded commerce-editor dispatch to the advertised `deepseek-v4.1-flash:cloud`
was rejected before work because that model was not included in the account's free usage;
one retry using advertised `gemma4:26b` was rejected as not installed. Neither worker edited
files or produced a completed turn. A later read-only `glm-5.3-flash:cloud` exploration was
likewise rejected before work because it was not included in free usage. Root completed the
commerce slice and reviewed its tests; no further native lower-cost route retry is planned in
this host session.
These host refusals do not contradict the separate, previously verified OpenRouter Flash CLI
route, and they are not evidence of token or credit savings. Do not silently substitute an
unverified worker or touch the application's OpenRouter key to repair native dispatch.

## Current opt-in Flash route

On 2026-09-24 the owner approved a separate development-only DeepSeek V4 Flash route through
OpenRouter, reusing the existing root `.env` variable `OPEN_ROUTER_API_KEY` in process memory.
The native OpenAI route below remains the default. The launcher and pinned policy are
`scripts/dev-orchestration/flash-worker.mjs` and `pikar-flash-routing.json`; neither changes app
runtime routing, provider deployment variables, global Codex configuration, or product dependencies.
The full Codex synthetic probe observed a completed pinned-model turn with 51,155 input and 10
output tokens. That verifies the route but is not evidence of savings. A direct Responses quick
probe reached the pinned model (HTTP 200; 104 input, 32 output tokens) but did not return the
marker within its small output cap. One bounded 256-token-cap probe then passed: OpenRouter
reported the exact pinned model, completed status, the marker, 104 input and 59 output tokens
(49 reasoning tokens). This verifies the direct response route. Direct task usage and quality
must be measured on real, accepted comparable work before claiming savings.

## Current owner-selected route

The owner chose **native OpenAI models in this account** as the default on
2026-09-23. `pikar-build-routing.json` and `pikar-build-orchestration.md` configure the assistant's
native dispatch policy: Astra orchestrates; `gpt-6-luna`, `gpt-6-sol` and the host-advertised
`gpt-5.6-terra` take appropriate bounded work. This uses explicit native tool model selection;
it does not install a custom host role or change the root/global settings.

Native Sol and Luna selection has been observed in existing useful tasks (below). Terra is
advertised by the host but has not yet been observed executing a selected task in this audit.
Do not launch a quota-consuming identity-only probe: record its first useful task instead.
Measured savings and subscription-credit attribution remain unproven.
The native usage reporter is root-accepted after 16 regression tests and a fresh completed Sol
rollout report. See `astra-usage-review.md` for observed counters and their scope. Terra's first
useful runtime observation remains pending.

## Historical external-route preflight (not the selected setup)

This section records the earlier, unselected Router installer preflight; it does not describe the
new direct OpenRouter/Codex opt-in route or establish maximum savings.
The pinned Astra package (`bcc7f9eaee051126c0ce821a55194d0b20425b22`) was inspected locally.
Both its unmodified `install.py` dry run and static `doctor.py` failed with:

```text
No model_catalog_json was found. Confirm the existing Codex Router configuration.
```

The shell reported exit 1 for both commands. Neither used `--apply`, a live model check or
`--check-local-router`. No host config/authentication files or global defaults were changed.
The pinned package's `python -B -m unittest discover -s tests -q` passed all 63 offline tests
(exit 0). Those tests validate the package against fixtures, not this machine's missing route.

| Prerequisite | Observed result |
| --- | --- |
| Python | 3.11.15 available |
| Node | 24.7.0 available |
| PowerShell language mode | FullLanguage; Add-Type not tested |
| Git on PATH | Not found |
| Router command on PATH | Neither codex-router nor model-router found |
| Standard Windows Router install/state directories | Not found in checked locations |
| Effective base config model catalog | Not configured; no selected profile |
| Custom provider in base config | Not configured |
| Upstream personal skill and named Flash role | Not installed |
| Current host exposed models/roles | Native models only; no astra_flash_builder or Flash route |
| Flash request/provider evidence | None |
| Billed savings | Unknown; token counts are not a subscription credit bill |

Negative checks describe the inspected locations, not a claim to have searched every disk path.
The upstream installer cannot finish against this configuration. Do not hand-write a catalog,
set `multi_agent_version` falsely, install the skill alone and call it activated, or rename a
native worker as Flash. Existing native smaller-model tasks are an explicitly different route.

### Observed native worker metadata

Allowlisted rollout metadata inspected on this date records evaluator thread
`01a0cddb-5f09-7093-b036-5166570ce901` with turn model `gpt-6-sol`, and cleanup/measurement
thread `01a0cd9b-3755-76c0-8408-f468bb5b9011` with turn model `gpt-6-luna`. Both identify parent
`01a0be71-092c-7bb2-b852-3e75da1c170c` and session provider `openai`. These are host-reported
selection records, not model self-reports. No provider response model was available in the
inspected records; no Flash request or billed-credit reduction is established by them.

## Earlier external Router activation path (not used)

The earlier Router proposal below is retained as history only. **Do not execute it** for the
native or opt-in Flash workflows. The new Flash route does not require Router installation or a
Flash catalog.

1. Prepare the Router's documented Windows prerequisites, including Git. Install the Router from
   its reviewed stable checkout, preserving ChatGPT authentication, native root model, permissions
   and unrelated settings. Do not run a downloaded script blindly or from a temporary service path.
2. Select an actual billing provider. The Astra package default is
   `deepseek/deepseek-v4.1-flash`; an alternate such as
   `openrouter/deepseek-v4.1-flash` must be explicitly chosen, not inferred from app credentials.
   The user enters any provider key only through the Router's private local prompt. App/provider
   secrets and the exhausted application diagnostic authorization are not reusable setup inputs.
3. Let the Router publish its supported catalog and native-subagent capability using documented
   settings. Inspect any enable command before running it: some versions perform paid certification.
   No live/certify/smoke probe is authorized by this setup record.
4. Rerun the pinned Astra offline suite and installer dry run against the actual host CODEX_HOME.
   Apply only after the exact route is advertised as supported and the change list is reviewed.
   Preserve its undo receipt; run the static doctor afterward.
5. The user fully quits and reopens the host. Confirm the named role and exact route are exposed
   in the new session; an on-disk role alone cannot change this running session's tool catalog.
6. On the first separately authorized useful task, capture child selection metadata **and**
   Router/provider request metadata identifying the serving model/provider. Verify no fallback
   or native-root redirection occurred. A worker's prose identity and a healthy endpoint do not count.

Installation/credential/restart prerequisites require the local operator. Do not claim the route
is verified before step 6, and do not send repository context to an unchosen provider.

## Usage measurement contract

Use only allowlisted metadata from explicitly selected development sessions. Keep prompts,
tool arguments, content, keys, capability URLs and raw logs out of reports. Separate root and
worker counts; deduplicate cumulative usage snapshots and calculate compatible interval deltas.
Missing data stays unknown. Report host-selected route separately from provider-confirmed route.
Measure billed currency/credits only from authoritative billing records if available; do not
convert native tokens using an invented price or transplant upstream benchmark percentages.

Compare equivalent accepted work before/after over defined intervals before claiming savings.
Avoid repeated root status-only turns, duplicate exploration and rerunning complete worker suites.
Use native waits within host limits, compact briefs, and one batched acceptance review.

Sources: [Astra package](https://github.com/ethanplusai/astra-flash-orchestrator/tree/bcc7f9eaee051126c0ce821a55194d0b20425b22),
[Router installation](https://github.com/duolahypercho/codex-router),
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
