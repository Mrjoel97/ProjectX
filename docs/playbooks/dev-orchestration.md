# Development Orchestration and Usage Reports

Last verified: 2026-09-27 — native and Flash helper tests pass 22/22, but this session does not advertise the policy's Sol/Luna/Terra worker models and both route previews remain plan-only; focused history and route details are in `docs/agent-work/astra-routing-status.md`.

The native route is the default. Its two offline helpers are a metadata-only Codex rollout summarizer and a worker dispatch-plan preview. The preview reads `docs/agent-work/pikar-build-routing.json`; it never launches a worker. Actual native collaboration remains the host's agent mechanism. The separately approved Flash route below is opt-in development tooling only.

## Opt-in DeepSeek V4 Flash route

The pinned model is `deepseek/deepseek-v4-flash-0731` through OpenRouter Responses. The launcher reads the existing `OPEN_ROUTER_API_KEY` from root `.env` into process memory and never changes that file or the application's OpenRouter deployment/runtime configuration. It prints no key, prompt, or model output. It uses no provider retries and no silent fallback. Keep secrets, customer data, production operations, architecture, tenancy, security, authentication, and payment decisions on the native/root path.

```powershell
node scripts/dev-orchestration/flash-worker.mjs plan
node scripts/dev-orchestration/flash-worker.mjs quick-probe
node scripts/dev-orchestration/flash-worker.mjs quick --brief docs/agent-work/<bounded-brief>.md --out <unique-result>.md
node scripts/dev-orchestration/flash-worker.mjs probe
node scripts/dev-orchestration/flash-worker.mjs run --brief docs/agent-work/<bounded-brief>.md
node scripts/dev-orchestration/flash-worker.mjs run --brief docs/agent-work/<bounded-brief>.md --write
```

`plan` is offline and does not read the key. `quick-probe` is a tiny synthetic direct-provider route check. `quick` sends a bounded brief without tools and saves its proposal under `docs/agent-work/flash-output/` for Astra/root review; it cannot modify code or run tests. `probe` and `run` use a process-local Codex Responses provider, not a global host/Router configuration. `run` defaults to read-only; `--write` explicitly permits bounded workspace edits. Codex's full harness may have large input-token overhead, so use the direct quick route for small proposals and the native workers when they are a better fit. Keep task briefs free of secrets and limit write tasks to named files. The root reviews changes and tests in one batch.

Each live command emits response or turn usage counters and a route status, never a dollar/credit-saving claim. Direct Responses checks compare the returned model to the pinned slug and require usage; Codex's full route reports the completed turn and marker from its JSONL stream. A probe proves routing, not task quality. Compare similarly scoped accepted tasks and actual billing records before claiming savings. A missing usage counter or model mismatch fails closed.

## Dispatch plan preview

Use an explicit tier and the checked-in policy:

```powershell
node scripts/dev-orchestration/report.mjs dispatch --policy docs/agent-work/pikar-build-routing.json --tier routine
```

The JSON response contains `status: "plan_only_not_executed"` and the native spawn parameters. The accepted worker models are `gpt-6-luna`, `gpt-5.6-terra`, and `gpt-6-sol`; the selected tier must name one of these explicitly. The checker refuses external routers/keys, silent model fallback, recursive delegation, or a policy that does not require host model verification. A plan is not evidence that a child was spawned or that a provider returned a particular model.

## Metadata-only rollout report

Provide each rollout file explicitly and assign a unique role label. Expected model values compare against the rollout's host-reported `turn_context.model` metadata:

```powershell
node scripts/dev-orchestration/report.mjs report `
  --session root=<explicit-root-rollout.jsonl> `
  --session worker=<explicit-worker-rollout.jsonl> `
  --expect-model worker=gpt-6-luna
```

The utility streams JSONL and emits one JSON object to stdout. It retains only selected session/turn metadata and token counters; it does not emit input paths, messages, prompts, tool arguments, or raw parse/read errors. Treat rollout files as sensitive and pass only files needed for the measurement. Use the `role` mapping to disambiguate root and workers; child `parent_thread_id` is joined to the supplied root's `rollout_id` when present.

`event_msg.token_count.info.total_token_usage` is cumulative. The report uses the last valid cumulative snapshot; repeated snapshots are not added. `last_token_usage` is not added again. `token_usage_record.usage` is per-response, while its thread counter is cumulative; repeated response IDs are deduplicated and disagreements make the session incomplete. Missing usage is `null`/`missing`, never zero. Malformed lines, missing final newline, absent completion markers, file changes during read, missing model metadata, and counter disagreement are surfaced as incomplete/reasons. Re-run against a stable, completed rollout for a reliable lifetime snapshot.

Models/provider are host/session observations, not provider response attestations. Model mismatch or missing expected model exits nonzero. Multiple model epochs are attributed as unknown. Token counters are lifetime rollout counters unless an interval is explicitly computed; they do not imply billed credits, dollars, or savings.

## Compatible interval comparison

Save two complete report JSON outputs outside this helper, then compare explicitly:

```powershell
node scripts/dev-orchestration/report.mjs compare --before before.json --after after.json
```

Comparison requires a complete native-provider report, the same unique role/rollout/session IDs, host provider metadata `openai`, acceptable expected-model status, complete lifetime usage, and valid allowlisted token-counter names/values. A reset/decrease or schema change is rejected rather than reported as a negative delta. The result contains usage-counter deltas only and no billing estimate. Model attribution uncertainty is retained in each interval result; different model sets across endpoints remain explicitly unknown.

The expected model check alone does not certify routing: comparison/report success also requires session provider metadata `openai`. This remains a host/session observation and not a provider response attestation.

## Verification

Run `node --test scripts/dev-orchestration/report.test.mjs`. These tests use synthetic metadata and read the routing policy without modifying it. No provider, network, application runtime, or child process is invoked.
