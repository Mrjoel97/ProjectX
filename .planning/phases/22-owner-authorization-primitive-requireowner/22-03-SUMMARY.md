---
phase: 22-owner-authorization-primitive-requireowner
plan: 03
status: complete-server-boundary-proven-dom-half-outstanding
uat: "Task 3 step 4 (the trust boundary) PASSED live 2026-08-01 both directions; steps 2/3/5 (DOM) not obtained — see 22-UAT-EVIDENCE.md"
completed: 2026-07-31
requirements: [GOVN-01]
---

# 22-03 Summary — owner-only `/ops` presentation

Tasks 1 and 2 complete, all automated gates green. **Task 3 ran live on 2026-08-01.** Its
load-bearing step — the four direct API calls as an authenticated non-owner — **PASSED in both
directions**. The DOM half (steps 2/3/5) was **not obtained**, blocked by environment rather than
by a defect. Full detail in `22-UAT-EVIDENCE.md`.

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
| 4 | remove the `isOwner` mount guard | **STILL UNRUN.** Needs a rendered page and two live identities; blocked with the rest of the DOM half. |

All applied mutations were reverted and re-verified green. No fixture was weakened and no mutation
was left in the worktree.

## Task 3 — RAN LIVE 2026-08-01: boundary PASS, DOM half outstanding

**Step 4 (the load-bearing one) PASSED both ways.** An authenticated non-owner got
`OWNER_REQUIRED` from all four endpoints, and a real pre-existing `optimizerConfig` row was
left byte-unchanged by the refused write. The same account, after nothing but the `owner`
flag flipping, read the config, flipped the kill switch, read 4 candidate BODIES, and hit
`NO_SUCH_SKILL_VERSION` — the *skill* gate, not the owner gate. That ordering proves the
refusals were authorization rather than breakage, and that the two gates stay independent.

**Steps 2/3/5 (DOM) NOT obtained.** The app force-redirects any tenant without a committed
business profile to onboarding, so `/ops` was unreachable for a fresh account and the first
"optimizer absent" reading was VACUOUS — discarded rather than reported as a pass. After
clearing that gate the local backend had degraded (5.6-minute pushes, `auth:signIn` exceeding
its 1 s limit) and neither the sign-in form nor JWT injection completed. Five approaches,
all environmental. Mutation 4 stays unrun for the same reason.

Full detail and the finish-it instructions: `22-UAT-EVIDENCE.md`, and
`docs/playbooks/authorization.md` § "Live owner/non-owner checklist" steps 2, 3 and 5.

**GOVN-01 assessment:** the server-side trust boundary — the thing the requirement is about —
is proven live in both directions. What remains unproven is presentation, and a slip there
could only expose the mount, never the data behind it, because the wrappers refuse regardless.
