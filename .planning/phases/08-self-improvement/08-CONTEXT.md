# Phase 8: Self-Improvement - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Capture user feedback (rating + comment) on delivered responses (IMPR-01), and let a
feedback-threshold breach trigger an autonomous prompt-optimization loop that edits agent
**skill documents**, gated by a held-out eval set, with one-click rollback and a kill switch
(IMPR-02) — every optimization versioned with before/after + triggering evidence (IMPR-03).

The optimizer is Microsoft **SkillOpt** run as an **offline batch job** (CI cron), not a
hosted service. It pulls a trajectory export, runs rollout→reflect→edit→held-out-validation,
and writes an accepted skill version back to the Convex `skills` registry via an authenticated
HTTP endpoint.

**Out of scope:** per-user/per-tenant skill personalization (deferred until data volume
justifies it), and anything that turns SkillOpt into a live request-path service.
</domain>

<decisions>
## Implementation Decisions

### Feedback capture UX (IMPR-01)
- **Primitive:** thumbs up / thumbs down + an **optional free-text comment**. Binary keeps
  friction near zero; the comment (especially on a thumbs-down) is the qualitative "why"
  SkillOpt needs. No 1–5 stars — too fine a signal for the data volume, and harder to map to
  a training reward.
- **Placement:** on the **delivered response** surface (the delivered PlanCard / request row),
  where the user is already looking at the outcome.
- **Linkage:** feedback row is tied to the **originating request** (requestId) and, through it,
  to the **skill name + version** that produced the response — so a rating is attributable to a
  specific skill version (this is what makes it a rollout score later).
- Feedback is editable/undoable (a mis-tap shouldn't poison the signal).

### Self-edit autonomy posture (IMPR-02) — ⚠ CONFIRM: slight divergence from prior mandate
- **Beta posture: human-in-the-loop.** A SkillOpt run that passes the held-out eval writes the
  new skill version into the registry as a **`candidate`**, NOT `active`. The owner does the
  final **one-click activate** (the existing `activateSkill` gate). The optimization *loop* runs
  autonomously up to that point; only the live flip waits on a human during beta.
- **Rationale for the divergence:** SKILLOPT.md records an owner mandate for "autonomous
  optimization." Full auto-activate-on-green is deferred, not rejected — a self-rewriting prompt
  system deserves a few owner-watched activations before we trust the eval gate to flip it live
  unattended. Flip to full-auto is a one-line config change once confidence is earned.
- **Kill switch default: OFF** (optimizer disabled) at ship. Rollback = `activateSkill` on the
  prior version (already built). Kill switch = disable the CI schedule (already the model).

### Trigger policy (IMPR-02)
- **Threshold breach + manual kick.** The loop is eligible to fire when a skill's feedback
  crosses a conservative breach condition (a rolling negative-rate over a **minimum sample
  floor** so one bad rating can't trigger it). Plus an owner-initiated **manual run** for
  dry-runs and testing.
- **Nightly "sleep" schedule deferred** — running a nightly optimizer over near-zero beta
  feedback burns CI minutes to learn nothing. Add the nightly schedule when volume justifies it.
- Exact threshold numbers (negative-rate %, sample floor, cooldown) are **tunable config** —
  Claude's discretion to pick sane starting values during planning.

### Scope & go-live timing
- **Build the full loop, ship it DORMANT.** All machinery lands in Phase 8 (feedback capture,
  trajectory export, SkillOpt CI job, registry write-back, kill switch, rollback), but the
  optimizer ships with the **kill switch OFF** — it does not autonomously run against live
  traffic until Phase 9 brings real users and feedback volume.
- **Proof-of-life during Phase 8:** one **manual dry-run** of the full pipeline on a single
  skill (recommend `cockpit-agent`) — export → SkillOpt → held-out eval → candidate write-back
  → owner activate — to prove the seam end-to-end without waiting for organic data.
- **Eligible skills:** all registry skills are eligible in principle; the dry-run validates one.

### Claude's Discretion
- Exact breach thresholds / cooldown values and the config surface for them.
- Held-out validation set curation mechanics (which tasks, how many) — subject to research.
- The precise shape of the trajectory-export JSON and the write-back endpoint contract.
- Feedback control's exact visual treatment (within BRAND.md).
</decisions>

<specifics>
## Specific Ideas

- The kill switch and "activate this candidate skill" should live on an **operator surface**
  the owner already uses (the ops page family from Phase 7 / 02-09's ops surface), not a new
  bespoke screen.
- Treat the first optimizations as **owner-reviewed** events: when a candidate is written back,
  the owner should be *notified* (reuse the Phase 7 notification surface) with the before/after
  diff + triggering evidence, then activate or discard.
</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/backend/convex/skills.ts` — versioned registry: `activateSkill` (candidate→active
  flip through the `EVAL_GATE` choke point), evidence recording, rollback = re-activate prior
  version. **IMPR-03 substrate already exists.**
- `packages/backend/scripts/run-eval-golden.mjs` + `scripts/eval-cases/*.json` — the eval
  harness (Phase 03.6). The **held-out validation gate is this harness**, per SKILLOPT.md — the
  optimizer must NOT see the held-out set.
- `packages/pii/` — pure-TS redaction. **Trajectory exports (real response bodies + user
  comments) must be PII-scrubbed here before leaving the system** to the CI runner (CLAUDE.md §4
  spirit; verify SkillOpt still optimizes well on scrubbed text — a research question).
- `convex/http.ts` — home for the authenticated **trajectory-export** and **registry write-back**
  endpoints (the Phase 8 integration seam).
- Phase 7 notification surface + ops page — reuse for candidate-ready notification + kill
  switch / activate controls.
- Delivered-response surface (PlanCard / requests list) — host for the feedback control.

### Established Patterns
- **No hardcoded prompts** (CLAUDE.md §5): every optimizable prompt is already a registry skill
  row — SkillOpt edits bodies, never source.
- **Candidate→active only through `activateSkill`/`EVAL_GATE`** — the write-back endpoint must
  route through this choke point, not patch the registry directly.
- **Tenant-scoped wrappers** (`tenantQuery`/`tenantMutation`) for the feedback write; feedback
  is tenant-owned data. (Note: tenantId is now per-user stable — fixed 2026-07-21.)
- **Refs-only audit** (§4): the audit/DLQ payloads stay refs/hashes; the trajectory export is a
  SEPARATE, PII-scrubbed export plane, not the audit log.

### Integration Points
- New `feedback` table + tenant-scoped mutation, keyed to requestId + skill name/version.
- New `convex/http.ts` endpoints: authenticated trajectory export (scrubbed) + registry
  write-back (routes through `activateSkill` as candidate).
- New CI cron (GitHub Actions) running the Python SkillOpt tool against the export.
- Kill switch = a config/schedule toggle read by the CI job + surfaced on the ops page.
</code_context>

<deferred>
## Deferred Ideas

- **Full auto-activate on green eval** (no owner click) — flip from human-in-the-loop once beta
  confidence is earned. One config change.
- **Nightly SkillOpt-Sleep schedule** — add when feedback volume justifies the CI spend.
- **Per-user / per-tenant skill variants** (personalization) — SKILLOPT.md defers this until
  data volume justifies it.
- **1–5 star / richer feedback taxonomy** — revisit if binary thumbs proves too coarse a signal.
</deferred>

---

*Phase: 08-self-improvement*
*Context gathered: 2026-07-21*
