# Phase 8: Self-Improvement - Research

**Researched:** 2026-07-21
**Domain:** Feedback capture → offline text-space prompt optimization (Microsoft SkillOpt) → eval-gated candidate write-back into the versioned skill registry
**Confidence:** HIGH (Pikar-side seam — verified against live source) / MEDIUM (SkillOpt upstream API — verified against README + docs, not run)

<user_constraints>
## User Constraints (from 08-CONTEXT.md)

### Locked Decisions
- **Feedback primitive (IMPR-01):** thumbs up / thumbs down + an **optional free-text comment**. NO 1–5 stars. Placed on the **delivered response** surface (delivered PlanCard / request row). Feedback row tied to the **originating request (requestId)** and through it to the **skill name + version** that produced the response. Feedback is editable/undoable.
- **Self-edit posture (IMPR-02) — HUMAN-IN-THE-LOOP:** a SkillOpt run that passes the held-out eval writes the new skill version as a **`candidate`**, NOT `active`. Owner does the **one-click activate** (existing `activateSkill`/`EVAL_GATE`). Kill switch **default OFF** at ship. Rollback = `activateSkill` on the prior version. Kill switch = disable the CI schedule.
- **Trigger (IMPR-02):** threshold breach (rolling negative-rate over a **minimum sample floor**) **+ manual kick**. Nightly "sleep" schedule **deferred**.
- **Scope/timing:** build the FULL loop, **ship it DORMANT** (kill switch off) until Phase 9. Prove the seam with **ONE manual dry-run** on the `cockpit-agent` skill (export → SkillOpt → held-out eval → candidate write-back → owner activate).
- **Deployment:** offline SkillOpt **batch job on a CI cron (GitHub Actions)**, NOT a hosted sidecar. Trajectory-export + registry-write-back endpoints (`convex/http.ts`) are the integration surface.
- **Optimizer must NOT see the held-out set.**

### Claude's Discretion
- Exact breach thresholds / cooldown values and their config surface.
- Held-out validation set curation mechanics (which tasks, how many).
- Precise shape of the trajectory-export JSON and the write-back endpoint contract.
- Feedback control's exact visual treatment (within BRAND.md).

### Deferred Ideas (OUT OF SCOPE)
- Full auto-activate on green eval (no owner click) — one config change later.
- Nightly SkillOpt-Sleep schedule.
- Per-user / per-tenant skill variants (personalization).
- 1–5 star / richer feedback taxonomy.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IMPR-01 | User feedback (rating/comment) captured on delivered responses | New `feedback` table + `tenantMutation`; record active skill name+version on the plan at propose-time so a rating is attributable (§"Feedback Capture"). |
| IMPR-02 | Feedback-threshold breach triggers the autonomous prompt-optimization loop, gated by automated eval checks, one-click rollback + kill switch | SkillOpt CI batch job + breach-eligibility query + kill-switch config row; the held-out gate is the EXISTING `eval:golden` harness; rollback/kill switch already exist (§"SkillOpt Integration Seam", §"Trigger", §"Kill switch/rollback"). |
| IMPR-03 | Prompts versioned; every optimization records before/after versions + triggering evidence | `skills` table is already immutable-per-version; write-back inserts a new candidate row (before = prior active, after = new candidate); triggering evidence = breach snapshot + SkillOpt runId in an insert-only `audit` row + the `evidence` JSON on the row (§"Versioning & Evidence"). |
</phase_requirements>

## Summary

Phase 8 has an unusually favorable substrate: **the hard parts already exist and are load-bearing in production.** The versioned skill registry (`skills` table + `activateSkill`/`EVAL_GATE` + `recordEvalEvidence` + rollback-by-reactivation) is the IMPR-03 substrate verbatim. The independent held-out gate is the shipped `run-eval-golden.mjs` harness (23 golden cases, plan-state assertions, cost cap, evidence recording). PII scrubbing is a pure-TS `scanText` in `packages/pii`. So Phase 8 is mostly **plumbing**: a feedback table + control, two authenticated `convex/http.ts` endpoints (scrubbed trajectory export + candidate write-back), a small Python SkillOpt env package glued to those endpoints, a GitHub Actions cron, and owner-facing controls on the existing ops page + Phase 7 notification surface.

The single real integration risk is **how SkillOpt scores edits.** SkillOpt's accept-gate re-runs rollouts against a validation split; "running the cockpit skill" means executing `runCockpitAgent` (Convex/Node), while SkillOpt's `rollout.py` is Python. The seam is: the Pikar SkillOpt env's `rollout.py` calls the Convex deployment exactly the way `eval:golden` already does (`convex run llm:runCockpitAgent` with a `skillVersions` pin), scoring resulting plan state. This is heavy (LLM calls per edit iteration) but requires **no new execution engine** — it reuses the eval harness's proven invocation.

**Primary recommendation:** Build the Convex-side seam FULLY and independently (feedback table + control, scrubbed export endpoint, candidate write-back endpoint routed through the registry's candidate-insert path, breach-eligibility query, kill-switch config, ops controls, notification). Pin the Python side to SkillOpt v0.2.0's documented `SplitDataLoader` / `EnvAdapter` / `run_batch` contract. Treat the held-out set as **the golden `eval-cases/` set, which is never exported to SkillOpt** — that partition IS the "optimizer never sees it" guarantee. Prove the whole seam with one manual `cockpit-agent` dry-run; do not chase a real quality gain on near-zero beta data.

## Standard Stack

### Core (all already in-repo — REUSE, do not rebuild)
| Asset | Location | Purpose | Phase-8 role |
|-------|----------|---------|--------------|
| Skill registry | `packages/backend/convex/skills.ts` | `activateSkill` (candidate→active through `EVAL_GATE`), `recordEvalEvidence`, `getSkillVersion`, rollback=re-activate prior | IMPR-03 substrate + the write-back activation choke point |
| Golden eval harness | `packages/backend/scripts/run-eval-golden.mjs` + `eval-cases/*.json` | 23 scripted cockpit conversations, plan-state assertions, `$1.00` cost cap, `--skill name@ver` pin, `recordEvalEvidence` on green | THE held-out validation gate + the independent partition SkillOpt never sees |
| PII redaction | `packages/pii` (`scanText`) | Deterministic fail-closed structured-PII scrub → `SafeText` + counts | Scrub the trajectory export before it leaves the system |
| HTTP surface | `packages/backend/convex/http.ts` | `httpRouter` + `httpAction`; Convex Auth routes already mounted | Home for the export + write-back endpoints |
| Notification choke point | `packages/backend/convex/notifications.ts` (`notify`) | In-app row + best-effort external email, refs/counts-only message | "Candidate ready" owner notification |
| Ops page | `apps/web/app/(app)/ops/page.tsx` + `opsSignals.ts` | Eval-signals tiles + dead-letter surface | Host the kill-switch toggle + "activate candidate" + before/after diff |
| Skill contract | `packages/contracts/src/skill.ts` | `GATED_SKILLS`, `isGatedSkill`, `EvalEvidence`, `hasPassingEvidence` | Gate semantics for the write-back |

### Supporting (external — Python CI side only)
| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `skillopt` (Microsoft SkillOpt) | v0.2.0 (PyPI `skillopt`, MIT, 2026-07-02) | Text-space skill optimizer: rollout→reflect→aggregate→select→bounded-edit→held-out-accept→emit `best_skill.md` | The CI batch job only; never in the request path |
| Python | 3.10+ | SkillOpt runtime | GitHub Actions runner |
| GitHub Actions | — | Cron schedule + manual `workflow_dispatch` | The batch runner + kill switch (disable schedule) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SkillOpt CI batch | Hosted Python sidecar | Rejected in SKILLOPT.md 2026-07-12 update — the PRD dropped the Python-sidecar plane; a sidecar would carry the whole platform cost alone. Batch-over-service is the ponytail answer. |
| eval:golden as the gate | SkillOpt's own internal `valid_unseen` split as sole gate | Keep BOTH: SkillOpt's internal validation gates each edit inside the loop; `eval:golden` is the independent third gate that records the `EVAL_GATE` evidence for `activateSkill`. Belt-and-suspenders is correct for a self-rewriting system. |
| New candidate-insert mutation | Reuse `seedSkills` | `seedSkills` only publishes from in-source derived constants — it cannot take an external body. A new minimal internalMutation is required (see Pitfall 4). |

**Installation (CI side):** `pip install skillopt` (pin `==0.2.0`).

## Architecture Patterns

### The end-to-end loop (data flow)
```
[user] thumbs±comment on delivered response
   └─> feedback table (tenantMutation; requestId + skillName + skillVersion)
        │
   [breach query] rolling negative-rate ≥ threshold over ≥ sample floor  ──(manual kick also)
        │
   [GitHub Actions cron] reads killSwitch (default OFF) ─ if enabled + eligible:
        │  GET  /skillopt/export   (authenticated)  ──> scrubbed trajectory JSON  [packages/pii]
        │  run  skillopt train ... ──> best_skill.md   (optimizer sees TRAIN split only)
        │  POST /skillopt/writeback (authenticated)  ──> inserts skills row (status=candidate, maxVer+1)
        │  run  pnpm eval:golden --skill cockpit-agent@<newVer>  ──> recordEvalEvidence on green
        │  notify(owner, "candidate ready", before/after diff + evidence refs)
        ▼
   [owner] ops page: review diff+evidence → activateSkill (EVAL_GATE checks evidence) → LIVE
                    or discard; kill switch toggles killSwitch; rollback = activateSkill(prior)
```

### Pattern 1: Attributing a rating to a skill version
**What:** A rating is only training signal if it maps to the exact skill version that produced the response. Nothing records this today — `loadSkill`'s own doc comment says *"Callers must record { name, version } in telemetry/audit for every use (Phase 8)."*
**When:** At propose-time in the cockpit loop, when `proposePlan` flips `plans.status` → `proposed`.
**How (recommended, ponytail-minimal):** add `plans.skillVersion: v.optional(v.number())` (optional → no migration, matches the `sendAt`/`attachments` precedent) set to the active `cockpit-agent` version at propose. Copy it onto the per-recipient `requests` rows at `executePlan` (exactly like `threadId`/`inReplyTo` are copied). Feedback then reads `skillName="cockpit-agent"` + `request.skillVersion`.
```typescript
// plans row gains one optional field; feedback row keys off it.
// feedback: { tenantId, requestId, skillName, skillVersion, rating: "up"|"down", comment?: SafeText, createdAt }
```

### Pattern 2: Scrubbed trajectory export (the SEPARATE export plane)
**What:** The export carries REAL delivered bodies + user comments — a distinct plane from the refs-only audit log (CLAUDE.md §4). It must be PII-scrubbed *before it leaves the system*.
**Where scrubbing happens:** inside the authenticated `httpAction` in `http.ts`, right before serialization: run every text field (delivered body, user comment, the user goal/turns) through `scanText` and emit ONLY `.safeText` + `.counts`. Raw `.value`/`.entities` never leave. Fail-closed: a scan `Err` drops that trajectory from the export rather than shipping raw text.
```typescript
// http.ts /skillopt/export (authenticated, owner/CI token):
//   for each delivered response with feedback:
//     const g = scanText(goal); const b = scanText(body); const c = comment ? scanText(comment) : ok(...)
//     if (any isErr) continue;             // fail-closed: never ship unscrubbed
//     push({ id: requestId, task_description: g.safeText, conversation:[...safeText...], hard: rating==="up"?1:0, soft: ... })
```

### Pattern 3: Candidate write-back through the registry's gate
**What:** SkillOpt emits `best_skill.md`; the CI POSTs it back. It MUST become a new **candidate** version (immutable-per-version), never patch the registry, and only reach `active` through `activateSkill`'s `EVAL_GATE` after a green eval + owner click.
**How:** a new `internalMutation` (e.g. `skills.insertCandidate({ name, body })`) that mirrors `seedSkills`' gated-candidate branch (insert `version=maxVersion+1, status:"candidate"`) but accepts an EXTERNAL body. Guard: reject if `!isGatedSkill(name)` (only gated skills go through the eval gate) and if `body` is byte-identical to the newest row (idempotence, Pitfall 1 precedent). The write-back `httpAction` authenticates then calls this via `ctx.runMutation`.

### SkillOpt env-package contract (Python CI side, pinned to v0.2.0)
A benchmark/env package `skillopt/envs/pikar_cockpit/` must contain (verified against `docs/guide/new-benchmark.md`):
| File | Interface (verbatim) | Pikar implementation |
|------|----------------------|----------------------|
| `__init__.py` | package init | — |
| `dataloader.py` | `class …(SplitDataLoader): def load_split_items(self, split_path) -> list[dict]` (items need `"id"`) | loads the scrubbed trajectory JSON pulled from `/skillopt/export`, split into train/valid |
| `rollout.py` | `def run_batch(*, items, skill_content, out_root, workers=4, max_completion_tokens=4096) -> list[dict]`; persist `<out_root>/predictions/<id>/conversation.json`; return dicts with `"id"`, `"hard"` (0/1 or [0,1]), `"soft"` ([0,1]) | **calls `convex run llm:runCockpitAgent` with `skillVersions` pinned to a temp candidate carrying `skill_content`**, scores resulting plan state with the SAME assertions eval:golden uses |
| `adapter.py` | `class …(EnvAdapter)`: `build_train_env`, `build_eval_env`, `rollout`, `get_task_types`; inherits `reflect()` | thin wiring |
| `configs/pikar_cockpit/default.yaml` | hyperparameters (`learning_rate` = max edits, `lr_scheduler`) | conservative defaults |
| `skills/initial.md` | starting skill | the current active `cockpit-agent` body (pulled at run start) |

**CLI:** `python scripts/train.py --config configs/pikar_cockpit/default.yaml --out_root outputs/run` → emits `outputs/run/best_skill.md`. Eval-only: `python scripts/eval_only.py --config … --skill outputs/run/best_skill.md --split valid_unseen`.

### Anti-Patterns to Avoid
- **Patching the registry from the write-back.** Never `db.patch` a skill body/status to active from CI — must route candidate → owner → `activateSkill`.
- **Exporting the golden `eval-cases/` to SkillOpt.** That set is the independent gate; if the optimizer trains on it, the gate is meaningless (Goodhart). Keep it in-repo only.
- **Shipping raw comment/body text off-system.** Always `scanText` first; fail-closed on scan error.
- **A new bespoke ops screen.** Reuse the existing ops page + Phase 7 notification surface (CONTEXT specific idea).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| The optimization algorithm | A custom prompt-mutation/reflection loop | SkillOpt (train→held-out-accept) | Peer-reviewed, validation-gated, MIT; hand-rolling is exactly what SKILLOPT.md's owner mandate rejected |
| The held-out gate | A new eval runner | `run-eval-golden.mjs --skill` | Already the shipped `EVAL_GATE` input; plan-state assertions + cost cap + evidence already built |
| Versioning/rollback | New version tracking | `skills` table + `activateSkill` | Immutable-per-version already enforced; rollback = re-activate prior version, structurally exempt from the gate |
| PII scrubbing | Regex in the export | `packages/pii` `scanText` | Deterministic, fail-closed, Luhn-checked, stable placeholders; already the redaction authority |
| Owner notification | New email/toast path | `notifications.notify` | Single choke point, in-app + external, refs/counts-only |
| Candidate insertion | Direct DB writes from CI | new `skills.insertCandidate` mirroring `seedSkills` gated branch | Preserves immutability + the gate invariant |

**Key insight:** Phase 8's novelty is entirely in the *seams* (feedback capture, export, write-back, CI trigger, ops controls). Every heavy component — optimizer, eval gate, version store, redactor, notifier — already exists and is production-verified.

## Common Pitfalls

### Pitfall 1: Nothing records which skill version produced a response
**What goes wrong:** feedback can't be attributed to a skill version → SkillOpt has no reward signal per version.
**Why:** the cockpit loop loads the active skill but never persists its version on the plan/request. `loadSkill`'s comment flags this as deferred to Phase 8.
**Avoid:** add `plans.skillVersion` at propose, copy to `requests` at `executePlan` (Pattern 1). Warning sign: a feedback row with no resolvable version.

### Pitfall 2: `packages/pii` does NOT scrub person names in prose
**What goes wrong:** the export still leaks names typed in comments/bodies. `scan.ts` is **structured PII only** (emails, Luhn cards, US SSNs, phones) — its own design doc (`pii-engine.md` tension #1) puts names out of scope.
**Why:** name detection needs Presidio/NER, deliberately deferred.
**Avoid / accept:** for a solo-owner beta where the export goes to the owner's OWN CI and covers the owner's OWN tenant data (tenantId is per-user, MEMORY 2026-07-21), the residual name leak is an accepted ceiling — but the planner MUST state this explicitly (a `ponytail:` comment + a playbook note) and it becomes a hard blocker before Phase 9 multi-user. Confidence MEDIUM.

### Pitfall 3: SkillOpt's inner loop needs to EXECUTE the skill, and that's Convex, not Python
**What goes wrong:** you can't score edits by static replay alone; SkillOpt re-rolls-out against a validation split. Building a second cockpit execution engine in Python would be wrong and huge.
**Avoid:** `rollout.py` shells out to the live Convex deployment via the same `convex run llm:runCockpitAgent` seam `eval:golden` uses, pinning a temp candidate skill. This is heavy (LLM calls × edit iterations × cases) — keep the dry-run's validation split TINY (a handful of cases) and the `learning_rate`/edit budget low. Warning sign: CI minutes/cost blowing past the cron budget → that's the trigger to reconsider (SKILLOPT.md's stated escalation-to-sidecar condition).

### Pitfall 4: `seedSkills` cannot ingest an external body
**What goes wrong:** reusing `seedSkills` for write-back fails — it only reads in-source `*SkillBody` constants and the drift test (`skills.test.ts`) asserts each SEED constant equals its canonical `.md`.
**Avoid:** write a new minimal `insertCandidate` mutation. Note the drift test asserts only SEED bodies match constants — it does NOT require every `skills` row to match a constant, so a SkillOpt-authored candidate body is legal (confirmed in `skills.test.ts` lines 457-468).

### Pitfall 5: Kill switch that only lives in GitHub Actions is invisible to the owner
**What goes wrong:** CONTEXT wants the kill switch surfaced on the ops page, but "disable the schedule" is a GitHub setting.
**Avoid:** belt-and-suspenders — a single-row `optimizerConfig { enabled: boolean (default false), … }` (mirror the `guardrailConfig` default-off-on-read pattern) that BOTH the ops toggle writes AND the CI job reads-and-obeys as its first step. Disabling the Actions schedule is the harder backstop. Default OFF at ship (dormant).

### Pitfall 6: Windows/CLI quoting on `convex run` (repo-specific)
**What goes wrong:** the eval/smoke seam judges success by CLI OUTPUT not exit code (Node24 crash), and tenantIds contain `|` which cmd.exe reads as a pipe (STATE 03.7-04). Any Python `subprocess` call to `convex run` must invoke node directly and parse stdout JSON, never go through a shell.
**Avoid:** mirror `smokeRun.mjs`'s `must()` convention. Relevant if the dry-run runs on a Windows dev box; the CI runner is Linux (cleaner).

## Code Examples

### Reading the active skill version to pin a candidate rollout (existing seam)
```javascript
// run-eval-golden.mjs — the exact invocation rollout.py must replicate:
must("llm:runCockpitAgent", {
  tenantId: tenant, threadId, planId, text,
  ...(pin && { skillVersions: { [pin.name]: pin.version } }),  // pin candidate version
});
// evidence recorded ONLY on all-green pinned run — the EVAL_GATE input:
must("skills:recordEvalEvidence", { name: pin.name, version: pin.version, evidence });
```

### The gate the owner's activate click passes through (existing, unchanged)
```typescript
// skills.ts activateSkill — a candidate of a gated skill needs passing evidence pinning EXACTLY this version:
if (isGatedSkill(name) && target.status === "candidate" && !hasPassingEvidence(target.evidence, name, version)) {
  throw new Error(`EVAL_GATE: ${name} v${version} has no recorded passing eval run`);
}
// rollback (archived/rolled_back target) is exempt BY STATUS — always works mid-incident.
```

## State of the Art

| Old (SKILLOPT.md original) | Current | When | Impact |
|----------------------------|---------|------|--------|
| Third Python sidecar (Presidio + graphify) | Offline CI batch runner; PII pure-TS | 2026-07-12 | No hosted service; export + write-back endpoints are the whole surface |
| Nightly `skillopt_sleep` from day one | Deferred; threshold-breach + manual kick only | 2026-07-21 (CONTEXT) | No CI spend on near-zero beta data |
| Auto-activate on green | Human-in-the-loop candidate + owner click | 2026-07-21 (CONTEXT) | `activateSkill` owner gate; full-auto is a one-line flip later |

**Deprecated/outdated:** the "sidecar with Presidio" assumption; the nightly-sleep-first assumption; any notion that SkillOpt runs in the request path (it never does — `best_skill.md` is static, zero inference-time overhead).

## Open Questions

1. **Does SkillOpt meaningfully optimize on SCRUBBED text?**
   - Known: SkillOpt optimizes the *skill document* (the system prompt), not user data; the reward is the thumbs signal (`hard`), unaffected by scrubbing. Stable placeholders (`[EMAIL_1]`) preserve structure.
   - Unclear: whether scrubbed *comments* retain enough qualitative "why" for `reflect()`. Names-in-prose survive scrubbing (Pitfall 2), so real complaints often still read fine.
   - Recommendation: acceptable for beta; the dry-run proves the mechanism, not the gain. Revisit signal quality when real feedback volume exists (Phase 9).

2. **Exact SkillOpt v0.2.0 config keys for train/valid/test split paths.**
   - Known: split selected via `--split valid_unseen` on `eval_only.py`; `dataloader.py`'s `load_split_items(split_path)` receives a path per split; `out_root` sets output.
   - Unclear: the YAML key names that map split → path (docs redirect to a Configuration reference not captured).
   - Recommendation: pin `skillopt==0.2.0`, copy `configs/searchqa/default.yaml` as the template, adjust in the dry-run. Specify the integration as the CONTRACT below so Phase 8 doesn't block on this: **the Convex side (export JSON shape + write-back endpoint + eval gate) is fully buildable independent of SkillOpt's exact YAML.**

3. **How big must the validation split be for a real accept?**
   - Recommendation: for the dry-run, tiny (≤5 cases). Real curation is deferred with volume (CONTEXT discretion).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Unit framework | Vitest (`pnpm --filter @pikar/backend test`), colocated `*.test.ts` |
| Eval harness | `packages/backend/scripts/run-eval-golden.mjs` (`pnpm eval:golden`) — live-model, plan-state assertions, `$1.00` cap |
| Offline self-check | `pnpm eval:golden --self-check` (zero convex calls) |
| PII unit | `packages/pii/src/scan.test.ts` |
| Smoke convention | `scripts/run-smoke-*.mjs` via `smokeRun.mjs` `must()` (output-not-exit-code) |
| Quick run | `pnpm --filter @pikar/backend test <file>` |
| Full suite | `pnpm --filter @pikar/backend test` + `pnpm eval:golden` |

### Phase Requirements → Test Map
| Req / Criterion | Observable proof | Test type | Command | Exists? |
|-----------------|------------------|-----------|---------|---------|
| IMPR-01 capture | A thumbs±comment insert creates a tenant-scoped `feedback` row keyed to requestId + skillName + skillVersion; edit/undo mutates the same row | unit (Convex mutation) | `pnpm --filter @pikar/backend test feedback` | ❌ Wave 0 |
| IMPR-01 attribution | `plans.skillVersion` set at propose; copied to `requests` at executePlan | unit | `pnpm --filter @pikar/backend test cockpit` (extend) | ❌ Wave 0 |
| IMPR-01 UI | Control renders on delivered PlanCard/request row; BRAND-compliant; a11y | manual + offline E2E | dev UI walk-through | ❌ Wave 0 (manual) |
| IMPR-02 trigger | Breach query returns `eligible=true` only when negativeRate ≥ threshold AND count ≥ floor AND past cooldown; below floor → false | unit (pure fn + query) | `pnpm --filter @pikar/backend test optimizerEligibility` | ❌ Wave 0 |
| IMPR-02 export scrub | Export endpoint emits only `safeText`+counts; a seeded email/SSN/phone in a body/comment is absent from output; scan `Err` drops the trajectory | unit (httpAction/adapter) + reuse `pii` scan | `pnpm --filter @pikar/backend test skilloptExport` | ❌ Wave 0 |
| IMPR-02 write-back | POST inserts `status="candidate"`, `version=maxVer+1`, immutable prior rows; non-gated name rejected; idempotent on identical body | unit | `pnpm --filter @pikar/backend test skills` (extend) | partial (skills.test.ts exists) |
| IMPR-02 eval gate | `pnpm eval:golden --skill cockpit-agent@<newVer>` green → evidence recorded; `activateSkill` refuses candidate without evidence | eval-fixture + unit | `pnpm eval:golden --skill cockpit-agent@N` | ✅ (harness exists) |
| IMPR-02 kill switch | `optimizerConfig.enabled=false` → CI job no-ops at step 1; ops toggle flips it | unit + manual | `pnpm --filter @pikar/backend test optimizerConfig` | ❌ Wave 0 |
| IMPR-02 rollback | `activateSkill(prior)` reactivates without an eval run (status-exempt) | unit | `pnpm --filter @pikar/backend test skills` | ✅ (covered) |
| IMPR-03 versioning | Each optimization = new candidate row (before=prior active, after=candidate); an insert-only `audit` row carries `{skillName, fromVersion, toVersion, runId, negativeRate, sampleCount}` (refs/counts only, §4) | unit | `pnpm --filter @pikar/backend test skills audit` | partial |
| **Proof-of-life** | ONE manual cockpit-agent dry-run: export → SkillOpt → best_skill.md → write-back candidate → eval:golden green → owner activate → active version flips | **manual dry-run** | end-to-end, owner-verified | ❌ Wave 6 |

### Held-out set partitioning (concrete)
Three distinct sets, no overlap — the partition IS the "optimizer never sees it" guarantee:
1. **SkillOpt TRAIN split** — trajectories from the scrubbed export where the optimizer reads reflections and proposes edits. Partition deterministically (e.g. `hash(requestId) % k`).
2. **SkillOpt VALIDATION split (`valid_unseen`)** — a disjoint slice of the SAME export that gates each edit's acceptance INSIDE SkillOpt. The optimizer model does not train on it.
3. **Pikar GOLDEN gate (`eval-cases/*.json`)** — the 23 in-repo scripted cases. **Never exported to SkillOpt.** This is the truly-independent third gate that records the `EVAL_GATE` evidence for `activateSkill`. It lives only in the repo/CI, so the optimizer structurally cannot see or overfit it.

### Manual cockpit-agent dry-run (the phase's proof-of-life, Wave 6)
Because beta feedback is near-zero, seed a small synthetic scored trajectory set for `cockpit-agent` (a handful of goals with `hard` scores), then:
1. Hit `/skillopt/export` → confirm scrubbed JSON (no raw email/SSN/phone).
2. Run `python scripts/train.py --config configs/pikar_cockpit/default.yaml --out_root outputs/dry` with a low edit budget + tiny valid split → confirm `outputs/dry/best_skill.md` emitted.
3. POST `best_skill.md` to `/skillopt/writeback` → confirm a new `cockpit-agent` candidate row (version N+1, status candidate), prior rows immutable.
4. Run `pnpm eval:golden --skill cockpit-agent@N+1` → confirm green (23/23) + evidence recorded.
5. Owner sees the "candidate ready" notification (before/after diff + evidence) on the ops page → clicks activate → `activateSkill` passes `EVAL_GATE` → active flips to N+1.
6. Kill switch OFF confirmed dormant (CI job would no-op on schedule). Rollback: `activateSkill(cockpit-agent, N)` restores prior instantly.
Owner-verified end-to-end; the point is the SEAM, not a measured quality gain.

### Wave 0 Gaps
- [ ] `feedback` table + `packages/backend/convex/feedback.test.ts` — covers IMPR-01
- [ ] `plans.skillVersion` field + copy-to-requests + test — IMPR-01 attribution
- [ ] `optimizerEligibility` breach query (+ pure threshold fn) + test — IMPR-02 trigger
- [ ] `/skillopt/export` httpAction + scrub + `skilloptExport.test.ts` — IMPR-02 export
- [ ] `skills.insertCandidate` mutation + test — IMPR-02 write-back
- [ ] `optimizerConfig` single-row (default off) + test — IMPR-02 kill switch
- [ ] `audit` optimization event assertion — IMPR-03 evidence trail
- [ ] Python `skillopt/envs/pikar_cockpit/` package (`dataloader.py`, `rollout.py`, `adapter.py`, `configs/…/default.yaml`, `skills/initial.md`) — CI glue
- [ ] `.github/workflows/skillopt.yml` (cron + `workflow_dispatch`, reads `optimizerConfig.enabled`)
- [ ] Framework install (CI): `pip install skillopt==0.2.0`
- [ ] Playbook: extend/update `docs/playbooks/skill-registry.md` (write-back + candidate provenance) and register new watched paths in `watch.json` (CLAUDE.md §9). Feedback UI: read `docs/design/BRAND.md` first (§10).

## Sources

### Primary (HIGH confidence — live source read)
- `packages/backend/convex/skills.ts`, `schema.ts`, `http.ts`, `notifications.ts` — registry, tables, HTTP/notify seams
- `packages/backend/scripts/run-eval-golden.mjs` — the held-out gate harness + `--skill` pin + evidence recording
- `packages/pii/src/scan.ts`, `index.ts` — scrubber capabilities + structured-PII-only limit
- `packages/contracts/src/skill.ts` — `GATED_SKILLS`, `EvalEvidence`, `hasPassingEvidence`
- `apps/web/app/(app)/ops/page.tsx` — ops surface to extend
- `packages/backend/convex/skills.test.ts` — drift test scope (seed constants only)
- `.planning/phases/08-self-improvement/08-CONTEXT.md`, `.planning/research/SKILLOPT.md`, `.planning/REQUIREMENTS.md`, CLAUDE.md §3/§4/§5/§9/§10

### Secondary (MEDIUM confidence — SkillOpt upstream, read not run)
- [microsoft/SkillOpt README](https://github.com/microsoft/SkillOpt/blob/main/README.md) — text-space optimizer, v0.2.0, MIT, `best_skill.md` artifact
- [SkillOpt new-benchmark guide](https://github.com/microsoft/SkillOpt/blob/main/docs/guide/new-benchmark.md) — env package files (`dataloader.py`/`rollout.py`/`adapter.py`/`configs/…/default.yaml`/`skills/initial.md`), `SplitDataLoader`, `run_batch` signature, `hard`/`soft` scores
- [SkillOpt docs index](https://github.com/microsoft/SkillOpt/blob/main/docs/index.md) — `scripts/train.py`/`scripts/eval_only.py` commands, `--split valid_unseen`, `--out_root`

### Tertiary (LOW confidence — flagged for validation)
- Exact SkillOpt YAML split-path key names (Open Question 2) — pin v0.2.0 + copy `searchqa` config template; verify in the dry-run.

## Metadata

**Confidence breakdown:**
- Standard stack / Pikar seam: HIGH — every reusable asset read in source and verified.
- SkillOpt env-package contract: MEDIUM — README + docs verified, not executed; exact YAML keys are LOW (OQ2).
- Held-out partitioning + eval gate: HIGH — the golden set + `activateSkill` gate are shipped and read.
- PII scrub compatibility: MEDIUM — names-in-prose gap is a known, documented limit (Pitfall 2).

**Research date:** 2026-07-21
**Valid until:** ~2026-08-20 for the Pikar seam (stable, in-repo); ~2026-08-04 for SkillOpt upstream (fast-moving pre-1.0 — re-verify config keys at build time).
