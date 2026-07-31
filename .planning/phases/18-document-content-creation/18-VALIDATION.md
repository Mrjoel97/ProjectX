---
phase: 18
slug: document-content-creation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-01
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (config: `packages/backend/vitest.config.mts`) + `convex-test` for integration |
| **Config file** | `packages/backend/vitest.config.mts` (exists — no Wave 0 install needed) |
| **Quick run command** | `pnpm --filter @pikar/backend exec vitest run <file>` |
| **Full suite command** | `pnpm --filter @pikar/backend test` |
| **Typecheck command** | `pnpm exec turbo run typecheck --filter=@pikar/backend --force` |
| **Estimated runtime** | ~{N} seconds — planner to measure |

> ⚠ **`pnpm typecheck` LIES.** Turbo's `typecheck` task declares no `inputs`, so its cache restores a
> stale pass without ever invoking `tsc`. Always use the `--force` form above. Gate on the **DELTA**
> against the HEAD baseline recorded in `18-RESEARCH.md`, never on absolute clean.

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched test file
- **After every plan wave:** Run `pnpm --filter @pikar/backend test`
- **Before `/gsd:verify-work`:** Full suite green (delta-clean vs. recorded baseline)
- **Max feedback latency:** {N} seconds — planner to measure

---

## Per-Task Verification Map

> Filled by `gsd-planner`. Every task must map to an automated command or an explicit
> Wave 0 dependency. Source the Test Type column from `18-RESEARCH.md` § *Validation Architecture*,
> which assigns a sampling layer to each of the six Success Criteria.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | ACTN-04 | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Planner to confirm — vitest + `convex-test` infrastructure already exists, so Wave 0 is expected
      to be **empty** unless a new test file needs stubs.

*If none: "Existing infrastructure covers all phase requirements."*

### Test-authoring cautions (verified at HEAD)

- **`stableTenant` was DELETED** (Lane O commit `d62c46c`). It was the previous tenant-isolation idiom.
  Use plain string subjects: `t.withIdentity({ subject: "tenant_a" })`. See `18-RESEARCH.md` for the
  copyable snippet that compiles at HEAD.
- **`packages/backend/convex/vault.test.ts` contains a literal NUL byte** (~offset 5982). ripgrep/Grep
  treat it as binary and skip it **silently**. Use `grep -a`.
- **`importGuard.test.ts` needs no registration** for a new convex module — its
  `import.meta.glob("./**/*.ts", { eager: true })` auto-scans.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| {behavior} | ACTN-04 | {reason} | {steps} |

> Planner: source this table from `18-RESEARCH.md` § *Validation Architecture*, which states explicitly
> which Success Criteria are provable by automated test and which need human UAT. **SC#6** ("a created
> artifact is SEEN in the Output card") is the expected manual candidate.

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, never bare `vitest`)
- [ ] Feedback latency < {N}s
- [ ] Typecheck delta measured with `--force`, compared against the recorded HEAD baseline
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
