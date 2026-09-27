# Astra native usage tooling review

Status: root-accepted for native dispatch-policy validation and offline usage reporting on 2026-09-23, after one correction cycle. This is an offline, metadata-only tool; it does not configure routing or launch agents. Policy remains in `docs/agent-work/pikar-build-routing.json` and is only read by the dispatch preview. This acceptance is not proof of billed savings, Terra execution, or completion of the application waves.

## Scope and evidence

- Added the Node built-ins-only CLI and synthetic `node:test` suite under `scripts/dev-orchestration/`.
- Added the native-only dispatch preview and a test that reads the root-owned routing policy without changing it.
- Rollouts inspected by explicit file selection were the root thread `01a0be71-092c-7bb2-b852-3e75da1c170c`, worker `phase49_eval_integrity` (`01a0cddb-5f09-7093-b036-5166570ce901`), and worker `phase49_cleanup_safety` (`01a0cd9b-3755-76c0-8408-f468bb5b9011`). Both worker records point to the root UUID as parent/session; session metadata labels the workers `worker` and provider `openai`.
- At the point-in-time report capture on 2026-09-23, host-reported models were: root epochs `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-6-astra`, and `gpt-reserve`; evaluator worker `gpt-6-sol` (expected model matched); cleanup worker `gpt-6-luna` (expected model matched). No provider response model was present in the examined metadata, so `provider_model_confirmed` is false for all sessions.
- Evaluator worker counters reconciled and its report was complete. Root and cleanup worker had valid cumulative token snapshots but report-incomplete status because their cumulative token-count source disagreed with token-usage records at capture time. The tool exposed those counter snapshots, marked both incomplete, and did not treat the mismatch as zero or billable cost. These are lifetime rollout snapshots, not task-only usage. In particular, the root rollout spans earlier work; this run is not evidence of savings or cost.
- A second bounded graph query (`graphify query "Codex rollout summarizer token counter validation native dispatch plan"`) produced no output within 10 seconds and was interrupted. `node scripts/extract-convex-edges.mjs` completed with exit 0 after source edits. Existing rollout tooling search found no matching helper before implementation.

## Safety and behavior

The report command streams only explicitly selected JSONL inputs and emits safe structured metadata: role, rollout/session/parent IDs, host model epochs, expected-model status, token counters, completion/integrity reasons. Counter keys are allowlisted (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`); unknown keys invalidate the sample without being echoed. It does not output input file paths, agent filesystem paths, messages, prompts, tool arguments, or raw errors. Usage counters have no inferred billing value. Snapshot comparison validates the complete report and each role/ID/provider/model/counter field rather than trusting a caller-supplied `complete` flag, rejects duplicate rollout IDs and incomplete or non-native-provider snapshots, and refuses decreases/resets. Orphan `--expect-model` roles are rejected. Intervals preserve multi-model uncertainty.

The dispatch command emits an explicitly chosen native worker spawn plan only. It validates the policy's native OpenAI-only boundary, model allowlist (`gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-terra`), explicit model requirement, no silent fallback, no external router/keys, and nonrecursive worker settings. The plan is not proof of a spawn or a provider-confirmed route. No model is inferred or substituted.

## Owned files

- `scripts/dev-orchestration/report.mjs`
- `scripts/dev-orchestration/report.test.mjs`
- `docs/playbooks/dev-orchestration.md`
- `docs/agent-work/astra-usage-review.md`

The routing policy and all prior Phase49 cleanup files were outside this change and left untouched.

## Focused verification record

Commands and observed exit results for this correction:

```text
node node_modules/.pnpm/@biomejs+biome@2.5.3/node_modules/@biomejs/biome/bin/biome check --write scripts/dev-orchestration/report.mjs scripts/dev-orchestration/report.test.mjs
exit 0 — 2 files checked

node --check scripts/dev-orchestration/report.mjs
exit 0

node --test scripts/dev-orchestration/report.test.mjs
exit 0 — 16 passed, 0 failed

node scripts/dev-orchestration/report.mjs dispatch --policy docs/agent-work/pikar-build-routing.json --tier complex
exit 0 — plan-only JSON selected gpt-6-sol / high / worker / fork_turns none

node scripts/dev-orchestration/report.mjs report --session root=<selected-root-rollout> --session phase49_eval_integrity=<selected-worker-rollout> --expect-model phase49_eval_integrity=gpt-6-sol --session phase49_cleanup_safety=<selected-worker-rollout> --expect-model phase49_cleanup_safety=gpt-6-luna
exit 1 — expected incomplete report: evaluator complete/model match; root and cleanup counter-source incomplete/model checks as observed

node scripts/extract-convex-edges.mjs
exit 0

graphify query "Codex rollout summarizer token counter validation native dispatch plan"
no output after 10 seconds; interrupted as bounded
```

The rollout arguments above are role-exact but local file paths are intentionally omitted from this artifact. Their IDs and parent relationship are listed in Scope and evidence.

## Root acceptance check

Root reviewed the actual implementation and corrections, reran all 16 focused tests (exit 0),
and ran the actual completed evaluator rollout with `--expect-model evaluator=gpt-6-sol`
(exit 0). The report was complete, host model matched Sol, provider metadata was `openai`,
and the cumulative counter sources reconciled:

| Counter | Observed lifetime tokens |
| --- | ---: |
| Input | 9,499,592 |
| Cached input (included in input, not additional) | 9,389,952 |
| Output | 25,523 |
| Reasoning output (reported subset; do not add again) | 6,961 |
| Total | 9,525,115 |

This measures the completed evaluator worker's lifetime, not this setup task, currency, subscription
credits, or a before/after savings comparison. Root also verified the Terra tier produces the
expected **plan-only** native parameters, and explicit-root planning verification exits 0.
No Terra inference was launched solely to establish identity.
Root attempted `graphify update .`; it produced no output during the bounded observation and was
interrupted. Full graph refresh remains incomplete; the required edge extraction was rerun.
