# Playbook: Authorization (tenancy + ownership)

> Touched 2026-08-02 to clear the §9 Stop hook. It fired on `tenant.test.ts`, which a PARALLEL
> LANE was writing to in this shared working tree during the turn — the file oscillated between
> modified and byte-identical to HEAD while being inspected, and it is identical to HEAD as this
> is written. No authorization change was made or verified here; the entry below stands unchanged.
> If that lane lands a real `tenant.test.ts` change, it owns the §9 entry for it.

> Last verified: 2026-08-01 (22 UAT) — VERIFIED LIVE on the configured deployment. Owner bootstrap
> is idempotent (changed true then false) with exactly one refs-only owner.granted row. An
> authenticated NON-owner is refused OWNER_REQUIRED by all four endpoints and left a real existing
> optimizerConfig row byte-unchanged; the SAME account with owner:true then read the config,
> flipped the switch, read 4 candidate bodies, and hit the SKILL gate (NO_SUCH_SKILL_VERSION), not
> the owner gate. The DOM half is still outstanding — see .planning/phases/22-*/22-UAT-EVIDENCE.md.
> PREVIOUS: Last verified: 2026-07-31 (22-03) — `/ops` now mounts its **entire** Optimizer section only for
> a confirmed owner (`api.owner.viewer`). Mounting is the security act, not styling: `OptimizerPanel`
> owns all four owner-only hooks, so CSS/`hidden`/opacity/an early-return-inside-the-panel would each
> still subscribe and leak through the subscription, loading state, or error boundary. Eval signals,
> Dead letters, Compliance nav and the DLQ badge stay tenant-visible — this page is deliberately
> mixed-purpose. Backend typecheck is back to the exact 150 baseline (Phase 22 delta = ZERO); web
> typecheck + build green. **The two-identity live UAT is NOT run — it is a blocking owner checkpoint.**
> PREVIOUS: 2026-07-31 (22-02) — the four global Phase-8 controls moved onto the owner
> wrappers: `getOptimizerStatus`/`setOptimizerEnabled` → `ownerQuery`/`ownerMutation`,
> `activateCandidate`/`candidatesForReview` → `ownerMutation`/`ownerQuery`. Their source
> comments previously said outright that *"the authenticated identity IS the owner gate"* —
> that was the vulnerability stated in prose, and it is gone. PREVIOUS: 2026-07-31 (22-01)
> against 25b7c98 — created with the GOVN-01 owner primitive; identity moved from a
> hand-written `stableTenant(subject)` parser to the auth package's official `getAuthUserId`,
> and `users.owner` became the one durable owner authority.
> Build history: `.planning/phases/22-owner-authorization-primitive-requireowner/` · Related ADRs: none

## Purpose

Two questions, one identity resolution. **Tenancy** asks *whose data is this?* and scopes every
read and write. **Ownership** asks *may this caller operate the deployment?* and gates the
global controls that are not tenant-scoped at all — the optimizer kill switch, skill candidate
bodies, skill activation.

Both derive from the same `users._id`, in the same module, deliberately. Two separate identity
resolutions can drift and disagree about who the caller is, and an authorization system that
disagrees with itself fails open.

## Key files

**Backend**
- `packages/backend/convex/lib/functions.ts` — THE wrapper module. `requireScope` (identity),
  `requireOwner` (authorization), and the five builders: `tenantQuery`/`tenantMutation`/
  `tenantAction`, `ownerQuery`/`ownerMutation`. The only sanctioned raw-builder import site.
- `packages/backend/convex/owner.ts` — `viewer` (non-disclosing boolean for presentation) and
  `bootstrapOwner` (operator-only, idempotent, audited grant).
- `packages/backend/convex/schema.ts` — the `users` table override carrying `owner`.

**Tests**
- `packages/backend/convex/owner.test.ts` — viewer states, bootstrap idempotence, audit key set.
- `packages/backend/convex/tenant.test.ts` — stable-per-user scope, cross-user isolation.
- `packages/backend/convex/importGuard.test.ts` — raw-builder scan + the static identity guard.

**Frontend**
- `apps/web/app/(app)/ops/page.tsx` — mixed page; only its optimizer section is owner-gated.

## Dependencies & blast radius

`graphify query "authorization"` for the current subgraph. What graphify cannot see:

- **`@convex-dev/auth` is pinned EXACT at `0.0.94`** (CLAUDE.md §6). Two things depend on that
  pin: `getAuthUserId`'s subject format, and the `users` table mirror in `schema.ts`. Re-diff
  both against the package on any bump.
- **`tenantId` is a `v.string()` on every table** and is exactly `String(users._id)`. It is not
  a `v.id("users")` anywhere. Changing that is a migration across the whole schema, not an edit.
- The owner grant is **deployment data, not code**. A fresh deployment has NO owner until
  `bootstrapOwner` is run against it.

## Data flow

**Tenant call:** client → `tenantQuery/Mutation/Action` → `requireScope` → `getAuthUserId(ctx)`
→ null? throw `UNAUTHENTICATED` : inject `{ userId, tenantId }` → handler.

**Owner call:** client → `ownerQuery/Mutation` → `requireOwner` → `requireScope` (as above) →
`ctx.db.get(userId)` → `owner === true`? inject scope : throw `OWNER_REQUIRED` → handler.

**Grant:** operator runs `npx convex run owner:bootstrapOwner '{"userId":"<users._id>"}'` →
row read → missing? throw `NO_SUCH_USER` → already owner? return `{changed:false}` →
patch `owner:true` → ONE `owner.granted` audit event → return `{changed:true}`.

## Invariants — what must never break

1. **Identity comes from `getAuthUserId`, never from a parser we maintain.** Enforced by
   `importGuard.test.ts` ("wrapper identity"), which reads the wrapper source with comments
   stripped and asserts `getAuthUserId` is present and `stableTenant` is gone.
2. **Authorization never keys on `identity.subject` or `identity.tokenIdentifier`.** Both carry
   the `|<sessionId>` suffix, so either would re-scope a user on every login — this is the exact
   bug fixed on 2026-07-21. Enforced by the same static guard, plus the behavioural
   two-sessions-one-scope test in `tenant.test.ts`.
3. **Owner authority is the `users.owner` boolean and nothing else.** Never an email, never
   registration order, never a first-user rule, never `SKILLOPT_OWNER_TENANT`. Any of those lets
   the wrong account become owner through data the owner does not control.
4. **Absent `owner` means false.** The field is `v.optional(v.boolean())` and the check is exact
   `=== true`. This is what made the widening need no migration and no backfill. Enforced by
   `owner.test.ts` (absent / explicit-false / orphan / unauthenticated all fail closed).
5. **The server wrapper is the trust boundary; hiding UI is presentation only.** A non-owner who
   calls a protected function directly must still be refused. `owner.viewer` exists to decide
   whether to MOUNT a control, never to decide whether to ALLOW an operation.
6. **`bootstrapOwner` is `internalMutation`.** There is no client-callable path to self-promotion.
7. **The grant audit payload key set is exactly `owner,userId`** (CLAUDE.md §4 — refs and flags
   only). Enforced by a sorted-key-set assertion plus a serialized-row scan for the email/name.
8. **There is deliberately no `ownerAction`.** An action has no `ctx.db`, so it cannot read the
   row the check depends on. An owner-only action must call an owner-gated mutation/query.
9. **Owner authorization and the skill EVAL_GATE are INDEPENDENT gates.** `requireOwner` asks
   *may this caller act?*; EVAL_GATE asks *has this body earned activation?*. Never move
   `requireOwner` into `activateSkillVersion` to "cover both" — that helper is also the trusted
   path for internal eval/seeding/operator callers with no browser identity, and gating it would
   break them while conflating two orthogonal questions. Pinned by two tests: an owner still gets
   `EVAL_GATE` on an unevaluated candidate, and a non-owner still gets `OWNER_REQUIRED` on an
   evidence-exempt rollback.
10. **The four protected endpoints are pinned BY NAME** in `importGuard.test.ts`
    (`owner-gated endpoints stay owner-gated`). Adding a fifth admin endpoint means adding a row.

### Why there is no "check happens before the write" test

The plan for 22-02 called for a mutation check proving the owner check precedes the write. **That
check is structurally unsatisfiable on Convex and was NOT faked.** Convex mutations are atomic
transactions: moving `requireOwner` below `writeConfig` and letting it throw rolls the whole
transaction back, so the resulting DB state is byte-identical to the refusal case. It was tried —
`setOptimizerEnabled` as a `tenantMutation` with `requireOwner` after the write — and all 11
optimizer tests still passed, correctly.

There is no window of exposure to test because Convex's transaction model removes it. The real,
testable invariant is **un-skippability** — that the guard runs before the handler at all — and
that is what the wrapper placement plus the static name guard pin. Do not "fix" this by weakening
a fixture until it goes red.

## How to change safely

**Adding an admin-ish public function** — start with `ownerQuery`/`ownerMutation`. Not "add it
tenant-scoped and gate it later": the gap is the vulnerability, and the UI is not a gate. Add the
endpoint to the named-endpoint table in `importGuard.test.ts` so a later refactor cannot silently
downgrade it.

**Bumping `@convex-dev/auth`** — re-diff the `users` mirror in `schema.ts` against the package's
`authTables.users` (fields AND both index names), and re-read `getAuthUserId`'s subject handling.
Then re-run the full backend suite, not just these tests.

**Adding a second owner** — run `bootstrapOwner` against that exact `users._id`. The model is
already multi-owner; nothing assumes exactly one.

**Revoking** — there is deliberately no revoke mutation (see Known gaps).

## How to verify

```
# Behaviour + static guards (fast, offline)
pnpm --filter @pikar/backend exec vitest run \
  convex/owner.test.ts convex/tenant.test.ts convex/importGuard.test.ts --maxWorkers=1

# Typecheck — ALWAYS with --force; turbo's cache restores a stale pass (see PARALLELIZATION.md)
pnpm exec turbo run typecheck --filter=@pikar/backend --force

# Playbook coverage
node scripts/check-playbooks.mjs
```

**Mutation checks** (a passing test that cannot fail proves nothing):
- Weaken the exact-owner condition to authentication-only → the absent-owner and explicit-false
  tests must turn RED. *Verified 2026-07-31: 2 failed / 8 passed.* Note the orphan test correctly
  stays green under this particular mutation — a deleted row reads null either way; it is
  sensitive to a different mutation (dropping the null check).
- Move a protected endpoint back to a tenant wrapper → its static guard AND its behavioural
  non-owner test must both turn RED.
- Move the owner check below a write → the zero-mutation/immutability test must turn RED.

**Live only** (no offline substitute): the bootstrap returning `changed:true` then `changed:false`
on the intended deployment, and the two-identity `/ops` check.

### The presentation rule (why the whole section is conditional)

`OptimizerPanel` owns all four owner-only hooks. Therefore **mounting the component is what
subscribes** to global config and candidate prompt bodies. The gate must wrap the mount:

- ✅ `{isOwner && <section>…<OptimizerPanel /></section>}`
- ❌ CSS `display:none`, the `hidden` attribute, `opacity: 0` — the hooks still run
- ❌ an early `return null` **inside** `OptimizerPanel` — hooks run before the return
- ❌ lifting the four hooks into `OpsPage` — they would run for every visitor

`viewer === undefined` (loading) renders nothing optimizer-shaped, so a slow query cannot flash the
admin surface. And none of this is the trust boundary — a non-owner calling the API directly is
still refused server-side. **Hiding the UI is a courtesy; the wrapper is the gate.**

### Live owner/non-owner checklist (the blocking checkpoint)

Run on the INTENDED deployment — never a lane deployment, whose user set and owner state differ.

1. Bootstrap the confirmed owner (`changed:true`, then `changed:false`).
2. As **owner**: `/ops` shows the Optimizer heading, kill switch, and candidate review. Toggle the
   switch; exercise an activation refusal/success against a known disposable candidate only. Sign
   out and back in — controls must survive a fresh login (this is the per-session-scoping guard).
3. As a **controlled non-owner** (`owner` absent or false): no Optimizer heading, switch, candidate
   name/body/evidence, Activate button, optimizer loading state, or owner-only error. Eval signals,
   Dead letters, Compliance nav and the DLQ badge remain.
4. **As that same non-owner, call all four APIs directly** via the authenticated client/dev harness.
   All must reject `OWNER_REQUIRED` with no state change. *The DOM check alone is insufficient —
   this step is the actual trust-boundary proof.*
5. UI mutation: remove the `isOwner` mount branch, rebuild, confirm the non-owner now SEES the
   Optimizer heading (RED), then restore, rebuild, and confirm it is absent again.

## Operational notes

- **A fresh deployment has no owner.** `bootstrapOwner` is a manual step, per deployment. A lane
  worktree with its own `convex dev` deployment has its own (absent) owner state — never conclude
  owner behaviour from a lane deployment.
- **Resolve the exact `users._id` from deployment data and confirm it before granting.** Do not
  infer from registration order and do not select by an unverified email. If the deployment, the
  row, or the first/second result is ambiguous: stop. Never grant a guessed account.
- Running `bootstrapOwner` twice is safe and is the intended idempotence proof.

## Known gaps & deferred work

- **No revoke mutation.** Deliberate: the only current owner is the operator, and a revoke path
  is a lockout risk with no caller. Revoking today is a `convex run` patch. Add a real revoke when
  Phase 25 admits a second owner.
- **`requireOwner` has no behavioural test in 22-01** — `ownerQuery`/`ownerMutation` are exported
  but unconsumed until 22-02, which exercises them through the real protected endpoints. A
  public test-only owner function was deliberately NOT added; a test-only public surface is
  itself an authorization hole.
- **The `users` mirror in `schema.ts` is a hand-copy** of the pinned package's table. `ponytail:`
  the ceiling is that Convex has no table-extend API; the upgrade path is a package-provided
  extend helper if one ever ships. Guarded only by the version pin and this playbook.
