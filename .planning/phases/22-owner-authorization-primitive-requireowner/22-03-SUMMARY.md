---
phase: 22-owner-authorization-primitive-requireowner
plan: 03
status: tasks-1-2-complete
blocked_on: "Task 3 — blocking human-verify checkpoint (two-identity live UAT)"
completed: 2026-07-31
requirements: [GOVN-01]
---

# 22-03 Summary — owner-only `/ops` presentation

Tasks 1 and 2 complete, all automated gates green. **Task 3 is a blocking two-identity live UAT
and has NOT run.**

## The change

One conditional in `apps/web/app/(app)/ops/page.tsx`:

```tsx
const viewer = useQuery(api.owner.viewer, {});
const isOwner = viewer?.isOwner === true;
…
{isOwner && (
  <section><p className="caps-label">Optimizer</p><OptimizerPanel /></section>
)}
```

**Why the whole section and not the panel's internals:** `OptimizerPanel` owns all four
owner-only hooks, so *mounting it is what subscribes* to global config and candidate prompt
bodies. CSS `display:none`, the `hidden` attribute, `opacity:0`, or an early `return null` inside
the panel would each still run those hooks and leak through the subscription, the loading state,
or the error boundary. Lifting the hooks into `OpsPage` would be worse — they would run for every
visitor.

`viewer === undefined` (loading) renders nothing optimizer-shaped, so a slow query cannot flash
the admin surface.

**Preserved deliberately:** Eval signals, Dead letters, the Compliance nav item and the DLQ badge.
`/ops` is a mixed-purpose page and ordinary tenants still need its tenant-scoped content — only
the optimizer section is global/admin.

## The codegen blocker — resolved, and how

Both `22-01` Task 3 and this plan's gate appeared blocked on the same thing: `api.owner` did not
exist in `_generated/`, so web typecheck failed and 12 backend errors were outstanding. Codegen
had failed earlier with *"Local backend did not start on port 3210 within 30 seconds"*.

Resolved without deploying anything. `npx convex codegen --help` states plainly: **"This doesn't
modify the code running on the deployment."** Re-running with
`CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=180` let the transient local backend start, codegen
completed, and the backend shut down again — no lingering deployment state, and nothing pushed.

> **Honesty note:** codegen's output does print `Uploading functions to Convex…`. That is its
> analysis push used to derive the typed API against a transient local backend; the documented
> contract is that deployment code is not modified, and `CONVEX_DEPLOYMENT` here is `local:` (this
> machine's anonymous dev backend), not a shared cloud deployment. Recorded so a later reader is
> not surprised by that line. `_generated/` is gitignored (CLAUDE.md §7), so nothing was committed.

**This did NOT satisfy 22-01 Task 3.** Codegen is not the owner bootstrap. That checkpoint still
requires the owner to confirm an exact `users._id` and run the grant.

## Evidence

| Gate | Result |
|---|---|
| `pnpm --filter @pikar/web typecheck` | **green** |
| `pnpm --filter @pikar/web build` | **green** — `/ops` compiles |
| Targeted backend (tenant, owner, optimizerConfig, skills, importGuard) | **133/133** |
| Full backend suite (at 22-02) | **53/53 files, 860/860 tests** |
| `node scripts/check-playbooks.mjs` | pass |
| Backend typecheck (`--force`) | **150 total, 0 production — the EXACT original baseline** |

### Phase 22's total typecheck delta is ZERO

The 150 baseline measured before any Phase-22 work is now restored exactly. The 12 errors carried
through 22-01/22-02 were entirely `Property 'owner' does not exist` awaiting codegen, as predicted
in the 22-01 summary — not latent defects.

## Mutation ledger (whole phase)

| # | Mutation | Result |
|---|---|---|
| 1 | `viewer` weakened to authentication-only | **RED** — 2 failed / 8 passed (absent-owner, explicit-false). Orphan correctly stays green: a deleted row reads null either way. |
| 2 | `candidatesForReview` → `tenantQuery` | **RED** — both the static name guard and the behavioural non-owner body test. |
| 3 | owner check moved below `writeConfig` | **NOT SATISFIABLE.** Convex mutations are atomic; a throw after the write rolls back, so state is byte-identical to the refusal. Attempted verbatim, 11/11 still passed — correctly. Recorded in the playbook rather than faked by weakening a fixture. |
| 4 | remove the `isOwner` mount guard | **STAGED for the live checkpoint** — the observation is "a non-owner now SEES the Optimizer heading", which needs two live identities and a rendered page. Not run offline. |

All applied mutations were reverted and re-verified green. No fixture was weakened and no mutation
was left in the worktree.

## Task 3 — BLOCKING, for the owner

The full checklist is in `docs/playbooks/authorization.md` under *"Live owner/non-owner checklist"*.
Its load-bearing step is **#4**, not the DOM check: as the controlled non-owner, call all four
public APIs directly and confirm every one rejects `OWNER_REQUIRED` with no state change. The DOM
proves presentation; only the direct calls prove the trust boundary.

Do not mark GOVN-01 complete until that checkpoint is approved.
