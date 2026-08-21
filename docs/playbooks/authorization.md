# Playbook: Authorization (tenancy + ownership)

> Last verified: 2026-08-21 (25.1-06, D13 — **`/ops` GAINED AN OWNER-ONLY SECTION**, and the
> self-growing owner-surface guard caught it. isolation.test.ts 31/32 — the one red is 23-05's
> `skills.activateAgentCandidate` fixture, pre-existing and untouched here.)
>
> - **`deadLetters.listAll` is the 16th owner endpoint** and the SIXTH module with one
>   (`deadLetters` joins finance, invites, ops, optimizerConfig, skills). `isolation.test.ts`'s
>   module-set and count pins went red the moment it was added, which is the entire reason they are
>   pinned rather than derived — and the endpoint inherited the loop's automatic
>   "rejects a non-owner with OWNER_REQUIRED" case for free.
> - **`/ops` is now mixed-purpose in THREE ways, not two.** Eval signals and the tenant dead-letter
>   section stay tenant-visible; Optimizer, Tenant skill candidates and now **Dead letters — all
>   tenants** are inside `{isOwner && …}`.
> - **THE MOUNTING RULE APPLIES TO THE NEW SECTION IDENTICALLY.** `AllTenantDeadLetters` owns the
>   `listAll` hook, so MOUNTING it is what subscribes to other tenants' rows. Hiding it with CSS,
>   `hidden`, opacity, or an early return INSIDE the component would each still run the hook and
>   leak through the subscription, the loading state or the error boundary. It must never move
>   outside the `isOwner` branch.
> - **The client boolean is still not the boundary.** `api.owner.viewer` is a courtesy that saves a
>   flash; `ownerQuery`'s `requireOwner` refuses before the handler reads a row.
> - **Seeing is not acting.** The owner-only section is read-only by construction: `markResolved`
>   remains a `tenantMutation` and the module has no owner-scoped mutation at all.
> - **`opsPresentation.test.ts` is the mount guard, and it CAUGHT this change.** Its fixture throws
>   on an unrecognised query, so adding an owner-only hook to the page turned it red until
>   `deadLetters:listAll` was registered as owner-only in BOTH halves — mounted for `{isOwner:true}`,
>   never mounted for `false`/`null`/`undefined`. The fixture deliberately returns a NON-EMPTY row:
>   an empty result renders the "no dead letters" paragraph, which is indistinguishable from the
>   section never mounting, so the owner assertion would have passed against a deleted section.
> - **A slice bug fixed in passing.** `tenantSkillReview.test.ts` sliced the panel body "to the next
>   top-level declaration" in prose and to `OpsPage` in code, so it silently swallowed anything
>   declared in between — its BRAND hex assertion went red over a colour belonging to a different
>   component. It now really does stop at the next top-level declaration.

> Last verified: 2026-08-20 (23-05 added `skills.activateAgentCandidate`, a separate
> `ownerMutation` whose exact-id agent row must also carry current full-suite exact-row evidence.
> Owner identity/time and the eval run id are server-derived and written with active status in one
> transition patch. User and agent activation exports refuse each other's rows; rollback remains
> owner-only and evidence-exempt. Source/static verification only because package executables are
> absent in this checkout; no live state changed and `$0.00` was spent.)
>
> **25-02 note, 2026-08-16 — Phase 22's outstanding owner/non-owner DOM evidence is closed at the
> COMPONENT level, not in a browser.** `/admin` follows `/ops`'s mount-gate pattern exactly (the
> whole view is conditional so its hooks never subscribe), and
> `apps/web/app/(app)/admin/adminPresentation.test.ts` proves it by recording every hook reference
> — mutation-proven against the `<div hidden>` anti-pattern. **A Playwright two-identity spec was
> not written and could not be**: the harness has one storage state and one seeded user, `owner` is
> hand-granted only, and the `(app)` onboarding redirect would have made the non-owner assertion
> pass for the wrong reason. See `beta-admission.md` for the full statement of that limitation.

> Last verified: 2026-08-16 (25-03 — **`isolation.test.ts` is the BETA-02/BETA-05 gate, and it is
> derived rather than enumerated: a new table, index, public function or owner endpoint is covered
> automatically or reddens the suite.**)
>
> **"ALL THREE OWNER-GATED FUNCTIONS" WAS 14.** The count in `25-CONTEXT.md`/`25-VALIDATION.md` is a
> stale Phase-8 figure. Measured: `finance.ts` ×5 (**including `setMasterKillSwitch` and
> `setMediaKillSwitch`, the global spend kill switches**), `optimizerConfig.ts` ×2, `skills.ts` ×5,
> `invites.ts` ×2. `importGuard.test.ts` pins only 7 of them and **all five finance owner endpoints
> were pinned by nothing** — a silent downgrade of the global kill switch to `tenantMutation` broke
> no test. `isolation.test.ts` now derives the list from a source scan and loops the
> `OWNER_REQUIRED` assertion over it. Mutation-proven: downgrading `setMasterKillSwitch` reddens it.
>
> **ARGUMENT VALIDATION RUNS BEFORE `requireOwner`.** Measured, and contrary to what the gate first
> assumed: calling an owner endpoint with `{}` throws `Validator error: Missing required field`,
> never `OWNER_REQUIRED`. A test passing empty args would have "passed" on 8 of the 14 while proving
> nothing about authorization. Every owner endpoint in the gate gets real, schema-valid arguments,
> and a separate assertion fails if a new one is added without them.
>
> **THE INDEX RULE KEYS ON `tenantId`, NOT ON THE REGISTRY CATEGORY.** Filtering to
> `tenant_owned`/`tenant_credential` silently skipped `audit` and `deadLetters` — both
> `audit_immutable`, both carrying `tenantId`, with 3 non-tenant-leading indexes between them.
> **Found by mutation: deleting `audit.by_ts` from the exception list left the suite green.** The
> exception criterion is also widened from "a cross-tenant range is impossible by construction" to
> "a named internal/owner-plane consumer with no tenant-facing caller", because for several of these
> the cross-tenant range IS the point (`audit.by_ts` is what the WORM export cron scans).
>
> **THE PUBLIC-SURFACE SCAN COVERS RAW BUILDERS, not just the five wrapper names.** Since 25-01 the
> repo has PUBLIC raw-builder functions, and a wrapper-only regex would be blind to precisely the
> unauthenticated internet-reachable endpoints an admission-gated beta most needs pinned. Each one
> must be allow-listed AND carry a written reason; "it needed to be callable" is not a reason.
>
> Prior entry — 2026-08-16 (25-01 — **the raw-builder allowlist gained its first genuinely PUBLIC
> entry, and `importGuard.test.ts` gained a guard against the two-allowlist divergence.**)
>
> **`packages/backend/convex/invites.ts` and `invites.test.ts` have MOVED to
> `docs/playbooks/beta-admission.md`**, which now owns the admission boundary end to end and is the
> file to read before changing it. The provisional registration recorded below (by the concurrent
> media lane, for work it had not written) is therefore superseded: the module is now landed,
> tested and documented. This playbook keeps `lib/functions.ts`, `lib/allowlist.ts`, `owner.ts` and
> `importGuard.test.ts`.
>
> **What changed here.** `RAW_BUILDER_ALLOWLIST` previously described itself, accurately, as a list
> of INTERNAL-only modules that are "never client-callable with a tenant identity". `invites.ts`
> breaks that sentence and the comment now says so explicitly rather than letting the next reader
> generalise from it: a beta signup page is used by people who have **no identity yet**, which no
> tenant wrapper can express — `tenantQuery` throws `UNAUTHENTICATED` by design. **The bar for a
> public entry is not "it needed to be callable".** It is that the function reads and returns no
> tenant-owned data and no secret: `requestAccess` writes one email-keyed row, and `preflight`
> returns a boolean plus a masked address, reporting an unknown code and a spent code identically
> so it cannot be used as an oracle. Meet that bar and say so in a comment, or use a wrapper.
>
> **Also enforced now:** a module exempted from the runtime scan but NOT from Biome's
> `noRestrictedImports` override in `biome.json` passes `pnpm test` and fails `biome ci`. The new
> divergence test in `importGuard.test.ts` catches it; see `ci-gate.md` for why that matters to the
> production deploy.
>
> Prior note — touched 2026-08-16 to clear the §9 Stop hook — **REGISTRATION ONLY, NOT A
> VERIFICATION**, and
> deliberately not a `Last verified` bump. `packages/backend/convex/invites.ts` + `invites.test.ts`
> are NEW and UNCOMMITTED work from the concurrent BETA-01 / Phase-25 lane; this session (the media
> lane) neither wrote nor reviewed them. They are registered here rather than left unwatched or
> parked in `_unassigned` because the module is by its own description **an authorization trust
> boundary**: `admitIdentity` runs inside the `auth:store` mutation before any account, session or
> verification code is written, and it is the first genuinely PUBLIC entry on the raw-builder
> allowlist (§2) — which this playbook already owns via `lib/allowlist.ts`. The same lane also has
> `auth.ts`, `lib/allowlist.ts` and `schema.ts` modified in the tree.
>
> **The owning lane still owes this playbook a real entry and a real `Last verified` line**
> covering the issuance/admission split, why two public functions are safe on the allowlist, and
> what the preflight deliberately does not authorize. Nothing below covers it. Registering the path
> only means the hook will protect it from here on; it is not a claim that anyone has checked it.

> Last verified: 2026-08-16 (**what `owner` does NOT gate.** `users.owner` is the deployment-owner
> grant (GOVN-01): the optimizer, skill activation/rollback, the owner-only finance rails and
> `/ops`. It is NOT a general "may act destructively" flag, and `tenantDelete.ts` learned that in
> production — its erasure path required `owner === true` and answered `OWNER_REQUIRED` to every
> real signup (request `9a23216e3f16ebe8`).
>
> The rule this playbook now states plainly: **an operator-privilege question and a
> right-over-my-own-data question are different questions and must not share a predicate.** Owner
> asks *may this caller act on the DEPLOYMENT?* Tenant-self asks *is this caller acting on its OWN
> tenant?* — and the latter is what `tenantAction`'s derived `ctx.tenantId`/`ctx.userId` already
> answer. GDPR Art. 15/20 export and Art. 17 erasure are tenant-self, never owner. See
> [[audit-dead-letter]] for the erasure guard itself.
>
> **No change to `owner.ts` or `requireOwner` in this edit** — the three Phase-8 functions, the
> finance rails and the `/ops` mount are untouched and still owner-gated. This entry records a
> boundary, so the clause is not re-added by someone reading "destructive ⇒ owner".)

> Last verified: 2026-08-16 (Phase 22 re-verification) — the former `/ops` presentation gap is
> closed at the React component level. `opsPresentation.test.ts` renders the real `OpsPage` with
> Convex hooks instrumented: exact owner true renders Optimizer and executes all owner-only panel
> hooks; false, null, and loading render neither content nor subscriptions while Eval signals, DLQ,
> and Dead letters remain. A complementary shell assertion pins Compliance → `/ops` and the DLQ
> badge subscription. This is component/render evidence, **not browser pixels or a live DOM claim**.
> The 2026-08-01 two-identity run remains the live proof of the server trust boundary.
>
> Last verified: 2026-08-11 (21-04) — the owner boundary now gates the TENANT skill overlay. Three
> new owner-wrapped endpoints in `skills.ts`: `tenantCandidatesForReview` (ownerQuery),
> `activateTenantCandidate` and `rollbackTenantSkill` (ownerMutation), all pinned by name in
> `importGuard.test.ts`. **Nothing was activated live and NO paid eval was run — $0.00.** Everything
> At that checkpoint, the evidence below was `convex-test` behaviour plus source scans and the
> two-identity live `/ops` check remained blocking; the 2026-08-16 entry above supersedes that
> presentation status. **The artifact entry below refers to MY uncommitted
> `importGuard.test.ts` change — it is now committed in `18d8bca`, and this is its real entry.**
>
> **A KNOWN-STALE BULLET WAS FIXED IN THIS PASS.** The mutation-check list used to end with *"Move
> the owner check below a write → the zero-mutation/immutability test must turn RED."* That directly
> contradicted the section above it, which records that the check WAS tried and all 11 optimizer
> tests correctly stayed **green**: Convex mutations are atomic, so a post-write throw rolls the
> transaction back and the resulting DB state is byte-identical to the refusal case. Anyone
> following the old bullet would have chased an unsatisfiable red and been tempted to weaken a
> fixture until it went. It is replaced below by the checks that ARE satisfiable, all of which were
> executed this session.
>
> PREVIOUS: 2026-08-11 (HOOK ARTIFACT, eval-gate session — not an attestation.
> §9 fired on an UNCOMMITTED change to `packages/backend/convex/importGuard.test.ts` that this
> session did not author and did not read. Bumping the line as a real `Last verified` would sign
> off on unseen code, so this records the artifact instead. **Nothing here is verified.**)

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
> typecheck + build green. **At that 2026-07-31 checkpoint, two-identity live UAT had not run and
> was blocking; later entries above record the live server proof and component presentation proof.**
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
- `packages/backend/convex/skills.ts` — the seven owner-wrapped endpoints, and
  `transitionSkillActivation`, the ONE identity-free status transition they all route through.

**Tests**
- `packages/backend/convex/owner.test.ts` — viewer states, bootstrap idempotence, audit key set.
- `packages/backend/convex/skills.test.ts` — the owner/eval truth table, rollback eligibility, the
  bounded review queue, and the source contract that there is exactly one activating patch.
- `apps/web/app/(app)/ops/tenantSkillReview.test.ts` — the ops surface, as a SOURCE SCAN.
- `apps/web/app/(app)/ops/opsPresentation.test.ts` — real `OpsPage` component render plus recorded
  Convex hook mounts for exact owner/false/null/loading; shell preservation is a source assertion.
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
10. **The protected endpoints are pinned BY NAME** in `importGuard.test.ts`
    (`owner-gated endpoints stay owner-gated`). Adding an admin endpoint means adding a row. There
    are **eight** as of 23-05: `getOptimizerStatus`, `setOptimizerEnabled`, `activateCandidate`,
    `candidatesForReview`, `tenantCandidatesForReview`, `activateTenantCandidate`,
    `activateAgentCandidate`, `rollbackTenantSkill`.
11. **A TENANT skill row goes live only through the owner boundary** (21-04, SKILL-01). A user can
    publish a `candidate` and an eval run can certify it; neither changes what any model runs.
    `activateTenantCandidate` is the only door, and it needs BOTH gates. Proven by a four-cell truth
    table whose load-bearing cell is *non-owner WITH valid exact evidence* — EVAL_GATE would let
    that through, so the refusal is provably about authorization. Measured: downgrading the wrapper
    to `tenantMutation` lets the candidate's **own author** activate it (`changed: true`).
12. **`requireOwner` is never inside `transitionSkillActivation`.** That helper is also the
    identity-free path for the eval runner and seeding. The wrapper is the authority; the helper is
    the transition. Agent mode receives the already-authenticated `ctx.userId` only to stamp the
    approval patch; it does not perform authorization and the global/internal modes remain
    identity-free. The audit write stays in the public wrapper.
13. **Agent approval is a conjunction, not a second name for activation.**
    `activateAgentCandidate` requires `author: agent`, candidate status, absent prior approval, and
    `hasPassingAgentTenantEvidence` for the current full suite. `activateTenantCandidate` refuses
    agent rows even when evidence is valid, and the agent endpoint refuses user rows.

### The tenant overlay's owner surface (21-04)

| Endpoint | Wrapper | Args | Second gate |
|---|---|---|---|
| `skills.tenantCandidatesForReview` | `ownerQuery` | none | — (read) |
| `skills.activateTenantCandidate` | `ownerMutation` | `{candidateId}` | exact passing tenant evidence |
| `skills.activateAgentCandidate` | `ownerMutation` | `{candidateId}` | exact passing current-suite agent evidence + absent approval |
| `skills.rollbackTenantSkill` | `ownerMutation` | `{targetId}` | `rollbackEligible === true` + archived/rolled_back |

**Every write takes a ROW ID, never `(name, version)`.** Two tenants can each own `offer-architect@2`,
so a name/version activation is a coin flip between going live for the right tenant and going live
for a stranger's draft.

**The review query is the sharpest disclosure boundary added since 22-02.** It returns another
tenant's `authoredBody` (their business writing) beside `candidateBody`/`baseBody` (raw registry
prompts), across every tenant on the deployment. The `ownerQuery` refusal happens in the wrapper's
ctx factory, **before the handler reads a single row**. It is bounded — `by_status_createdAt` with a
fixed `.take()`, newest first — because the deployment's candidate history is open-ended.

**Ordinary tenant authority is unchanged.** The history projection now includes the tenant's
agent-authored adaptations with a closed author label and strict gate boolean, but still returns no
row id, base/full body, raw evidence, owner identity or source refs. The workspace panel has no
activation control. A tenant still cannot name the row they would want activated.

**Audit.** One refs-only row per REAL transition (idempotent and failed attempts write nothing):
`skill.user_candidate_activated` / `skill.agent_candidate_activated` /
`skill.user_skill_rolled_back`, `actor: "owner"`, payload key set
exactly `author, evalRunId, fromTenantSkillId, fromVersion, ownerUserId, skillName, tenantSkillId,
version`. The row belongs to the TENANT whose runtime changed, on that candidate's own
`correlationId` lineage — not to the owner. No body, no adaptation, no prose (CLAUDE.md §4).

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

# The tenant overlay's owner boundary (21-04): truth table, rollback eligibility, review queue
pnpm --filter @pikar/backend exec vitest run \
  convex/skills.test.ts convex/importGuard.test.ts --maxWorkers=1

# The /ops surfaces: real component/hook mount proof plus the tenant-review source contract.
# React server rendering proves component output, not browser layout, hydration, focus, or pixels.
pnpm --filter @pikar/web test -- \
  'app/(app)/ops/opsPresentation.test.ts' \
  'app/(app)/ops/tenantSkillReview.test.ts' --maxWorkers=1

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
  non-owner test must both turn RED. *Verified 2026-08-11 on `activateTenantCandidate`: 2 failed /
  162 passed — the static name guard plus the truth table. With the truth table's owner-side cells
  temporarily removed so the catastrophic cell is reached first, the candidate's own author
  activates it: `promise resolved "{ changed: true, …(9) }" instead of rejecting`.*
- ~~Move the owner check below a write → the immutability test must turn RED.~~ **DELETED
  2026-08-11 — this check is unsatisfiable on Convex and always was.** See "Why there is no 'check
  happens before the write' test" above: the transaction rolls back, so the DB state is identical
  either way and the tests correctly stay green. Do not re-add it, and do not weaken a fixture to
  make it go red.
- Drop the exact tenant evidence comparison in `planTenantActivation` → the truth table and the
  stale/foreign/forged-evidence test must both turn RED. *Verified 2026-08-11: 2 failed / 83 passed.*
- Drop the `rollbackEligible` predicate → a never-active candidate becomes restorable.
  *Verified 2026-08-11: 1 failed / 84 passed — `promise resolved "{ changed: true, … }" instead of
  rejecting`.*
- Add a direct `ctx.db.patch(id, {status: "active"})` beside the shared transition → the
  one-patch-block source assertion must turn RED. *Verified 2026-08-11: 1 failed / 163 passed.*
  **The behavioural tests stay green under this mutation** — that is exactly why the source
  assertion exists, and why deleting it as "redundant" would be a real regression.
- Move the `<UserCandidatesPanel />` mount outside the `isOwner` branch → the ops source scan must
  turn RED. *Verified 2026-08-11: 1 failed / 14 passed.*
- Remove the entire `isOwner` mount guard → the false/null/loading component cases must turn RED by
  rendering Optimizer and recording its owner-only hooks. The exact-owner case positively requires
  both the heading/switch and hook names, so deleting the whole branch cannot pass vacuously.
  *Verified by the focused component contract 2026-08-16: 5/5 green with the guard present.*

**Live only** (no offline substitute): bootstrap returning `changed:true` then `changed:false` on
the intended deployment and direct authenticated API behavior against that deployment. Browser
layout/hydration remains a useful spot-check, but is not needed to prove React's mount/subscription
branch now that the real page component is rendered and its hooks are recorded.

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

### Live owner/non-owner checklist (deployment smoke test)

Run on the INTENDED deployment — never a lane deployment, whose user set and owner state differ.

1. Bootstrap the confirmed owner (`changed:true`, then `changed:false`).
2. As **owner**: `/ops` shows the Optimizer heading, kill switch, and candidate review. Toggle the
   switch; exercise an activation refusal/success against a known disposable candidate only. Sign
   out and back in — controls must survive a fresh login (this is the per-session-scoping guard).
3. As a **controlled non-owner** (`owner` absent or false): no Optimizer heading, switch, candidate
   name/body/evidence, Activate button, optimizer loading state, or owner-only error. Eval signals,
   Dead letters, Compliance nav and the DLQ badge remain.
4. **As that same non-owner, call all SEVEN APIs directly** via the authenticated client/dev
   harness. All must reject `OWNER_REQUIRED` with no state change. *The DOM check alone is
   insufficient — this step is the actual trust-boundary proof.*
5. UI mutation: remove the `isOwner` mount branch, rebuild, confirm the non-owner now SEES the
   Optimizer heading (RED), then restore, rebuild, and confirm it is absent again.
6. **(21-04) As a non-owner, confirm the `User-authored candidates` heading, any tenant id, any
   authored adaptation, the Activate button and the rollback select are all absent** — and that
   `skills:tenantCandidatesForReview` called directly returns `OWNER_REQUIRED` rather than a body.
7. **(21-04) As owner, exercise the tenant gate on a disposable candidate only.** Activate must
   refuse with `EVAL_GATE` while `gatePassed` is false, and `Roll back` must refuse with
   `ROLLBACK_NOT_ELIGIBLE` on a row that has never been live. **Do not activate a real user's
   candidate to test this** — it changes what their agent runs.

### Operator commands (21-04)

Read-only, $0, no model call:

```
# What is this candidate's situation? Refs only — no body ever leaves this read.
npx convex run skills:inspectTenantSkill '{"candidateId":"<tenantSkills id>"}'
```

Activation and rollback are **UI-only, owner-only**, by design: they are the two operations whose
authority is a human being, and there is deliberately no `npx convex run` path that skips the owner
check. (`internal.skills.activateSkill` remains the identity-free path for the GLOBAL registry only
— it cannot name a `tenantSkills` row.)

**NOT PAID, NOT LIVE, AS OF 21-04.** No tenant candidate has ever passed a real eval run, none has
been activated, and none has been rolled back outside `convex-test`. The first paid `--tenant-skill`
run and the browser proof are outstanding (21-06 / 21-07). Treat every claim on this page about the
tenant scope as *offline-proven*, not *observed*.

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
