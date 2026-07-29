---
phase: 22
name: owner-authorization-primitive-requireowner
status: research-complete
requirements:
  - GOVN-01
researched: 2026-07-29
---

# Phase 22 Research: Owner Authorization Primitive (`requireOwner`)

## Executive Summary

Phase 22 should add one data-backed authorization primitive beside the existing tenant wrappers,
then move the three known Phase-8 browser functions onto owner-aware wrappers:

- `optimizerConfig.setOptimizerEnabled` -> `ownerMutation`
- `skills.activateCandidate` -> `ownerMutation`
- `skills.candidatesForReview` -> `ownerQuery`

The durable authority is `users.owner === true`. The field must be optional in the Convex schema,
with absence interpreted as `false`; the one or more owner rows are promoted explicitly through an
idempotent `internalMutation` invoked with `convex run`. There must be no first-user rule, email
allowlist, `SKILLOPT_OWNER_TENANT` fallback, or client-provided owner claim.

The installed authentication implementation settles the identity question:

- `@convex-dev/auth` is pinned at `0.0.94`.
- It signs a JWT whose `sub` is `<users._id>|<authSessions._id>`.
- Convex exposes that `sub` as `identity.subject`.
- `identity.tokenIdentifier` incorporates the subject, so it also changes when the session suffix
  changes and is not the durable user-row lookup key in this application.
- The package's official `getAuthUserId(ctx)` splits the subject and returns the stable
  `Id<"users">`.

Therefore both tenant and owner authorization should use `getAuthUserId`, not duplicate subject
parsing and not `tokenIdentifier`. The existing tenant ID is already the first subject segment, so
this is a behavior-preserving source-of-truth change: no tenant data is re-keyed.

The current `/ops` page is mixed-purpose. Non-owners still need its tenant-scoped evaluation signals
and dead-letter queue. Hide only the Optimizer section, and do not remove the `/ops` route,
Compliance navigation item, dead-letter badge, eval signals, or tenant DLQ controls. The optimizer
component must not mount for a non-owner, while server-side owner wrappers remain the actual trust
boundary.

## Requirement and Locked Decisions

`GOVN-01` and Roadmap Phase 22 require:

1. A real `requireOwner(ctx)` backed by `users.owner`, seeded via `convex run`.
2. Server-side rejection of non-owners at `setOptimizerEnabled`, `activateCandidate`, and
   `candidatesForReview`.
3. An owner-only presentation for the administrative controls, with the server guard remaining
   authoritative.
4. A reusable convention so later admin-like public functions start with the owner guard.

The Phase-09 owner decisions remain binding:

- `owner: true` lives on the existing Convex Auth `users` row.
- The flag is data-driven and can support more than one owner later.
- It is not assigned to the first registered user.
- It is not derived from `SKILLOPT_OWNER_TENANT`.
- Non-owner UI does not reveal optimizer controls or candidate skill bodies.
- Additional role types are deferred; this phase is a boolean owner primitive only.

This phase does not absorb invite/waitlist work, multi-user rollout, CI redesign, legal work,
Outlook, or the names-in-prose export ceiling.

## Current-State Findings

### Authorization today

`packages/backend/convex/lib/functions.ts` is the sole sanctioned raw public builder module. It
defines `tenantQuery`, `tenantMutation`, and `tenantAction`, and currently derives `tenantId` by
manually splitting `identity.subject` at `|`.

That split matches the installed auth implementation, but it duplicates an official helper and
returns only a string. Phase 22 needs the typed user-row ID as well as the tenant string, so this is
the right time to make the official helper the single source of truth.

The import guard already enforces the architecture: public queries and mutations outside
`lib/functions.ts` cannot import raw `query` or `mutation`. `ownerQuery` and `ownerMutation` belong
in the same file, beside the tenant wrappers, and should use those same sanctioned raw builders.

### Broken owner assumptions today

The three GOVN-01 functions use `tenantQuery` or `tenantMutation`. Their comments call an
authenticated identity an "owner gate", but no owner lookup happens:

| Function | Current wrapper | Risk |
| --- | --- | --- |
| `optimizerConfig.setOptimizerEnabled` | `tenantMutation` | Any authenticated user can flip a global optimizer switch. |
| `skills.activateCandidate` | `tenantMutation` | Any authenticated user can activate a globally served skill after the eval gate. |
| `skills.candidatesForReview` | `tenantQuery` | Any authenticated user can read candidate and active skill bodies plus evidence. |

`optimizerConfig.getOptimizerStatus` is also a public tenant query used only by the optimizer
control panel. Although GOVN-01 names the three security-review findings above, this read should
become `ownerQuery` too. It is part of the same owner-only UI and otherwise remains directly
callable after the panel is hidden.

### Trusted internal seams are different

The following functions are privileged server/operator seams, not browser owner functions:

- `internal.optimizerConfig.setOptimizerConfig`: CI/operator configuration and cooldown updates.
- `internal.skills.activateSkill`: the eval/seed/operator activation path, still protected by the
  shared `EVAL_GATE`.
- `internal.skills.insertCandidate`: candidate-only writeback used by the optimizer integration.
- `internal.tenantProfile.grantEnterprise`: an operator-only tier grant with no public route.
- `/skillopt/writeback`: bearer-token machine endpoint that can only insert a candidate.

Do not push `requireOwner` down into `writeConfig` or `activateSkillVersion`. Those helpers are
shared with trusted internal callers that have no browser identity. Put authorization at the
public function boundary:

```text
browser owner -> ownerMutation -> shared write/activation helper
trusted internal caller -> internalMutation -> same shared helper
```

This preserves the single `EVAL_GATE` implementation and keeps rollback/eval automation working.

## Identity Boundary: Settled from Installed Source

The relevant installed sources are:

- `packages/backend/node_modules/@convex-dev/auth/src/server/implementation/tokens.ts`
- `packages/backend/node_modules/@convex-dev/auth/src/server/implementation/index.ts`
- `packages/backend/node_modules/@convex-dev/auth/src/server/implementation/types.ts`
- `packages/backend/node_modules/@convex-dev/auth/src/server/implementation/users.ts`
- `packages/backend/node_modules/convex/src/server/authentication.ts`

At `@convex-dev/auth` `0.0.94`, token creation sets:

```ts
sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId
```

and the official helper does:

```ts
const identity = await ctx.auth.getUserIdentity();
if (identity === null) return null;
const [userId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
return userId as GenericId<"users">;
```

Consequences:

| Candidate identifier | Stable across sessions? | Use |
| --- | --- | --- |
| `identity.subject` | No; includes `authSessions._id` | Never use whole value as tenant/owner key. |
| `identity.tokenIdentifier` | No in this setup; it includes issuer plus the session-bearing subject | Do not use for `users` lookup or tenant ownership. |
| `getAuthUserId(ctx)` | Yes; returns the first subject segment as `Id<"users">` | Canonical owner lookup and tenant derivation. |
| `users._id` | Yes | Durable owner flag location and existing tenant ID value. |

This intentionally rejects the generic suggestion that `tokenIdentifier` is always the correct
application user key. Convex describes it as a stable identity-provider identifier, but this
specific installed Convex Auth package makes the JWT subject session-specific. The package's own
`getAuthUserId` is the authoritative adapter for its subject format.

### Tenant compatibility

The current `stableTenant(subject)` returns exactly the same first segment that `getAuthUserId`
returns. Replacing the production parser does not change any stored `tenantId`; it only replaces a
hand-maintained parse with the package-supported helper and adds a typed `userId` to wrapper
contexts.

Rewrite the tenant regression test to use a real inserted `users` ID and two session-suffixed
subjects. Once production code no longer calls `stableTenant`, remove that duplicate helper and
its string-only tests rather than retaining dead parsing logic.

## Durable `users.owner` Schema

The installed `authTables.users` definition contains:

- optional `name`, `image`, `email`, `emailVerificationTime`, `phone`,
  `phoneVerificationTime`, and `isAnonymous`;
- index `email` on `email`;
- index `phone` on `phone`.

The package documentation beside that definition explicitly allows inlining auth table definitions
and extending them. Override only `users` after spreading `authTables`, and copy the installed
fields and indexes exactly:

```ts
export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    owner: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  // existing application tables...
});
```

The override must come after `...authTables`, or the package's original `users` table would replace
the extended one.

### Why `owner` stays optional

`owner` must be `v.optional(v.boolean())`, and reads must use `user?.owner === true`.

1. Existing user rows do not have the field.
2. The current Password profile returns only `email` and optional `name`.
3. Google sign-in also creates users through Convex Auth, not through an application writer that
   supplies `owner: false`.
4. The installed auth implementation inserts the provider profile as the user document and patches
   that profile on later sign-ins.
5. A required `owner` field would reject normal future sign-ups unless every auth provider and
   linking path were customized.
6. The installed implementation uses `ctx.db.patch` for an existing user, so an established
   `owner: true` survives later sign-ins that omit `owner`.

Absence is therefore the durable, fail-closed representation of non-owner. There is no reason to
store `false` on every row.

### Migration compatibility

No `@convex-dev/migrations` entry is required or desirable. The repository's local
`convex-migration-helper` says adding an optional field that needs no backfill is a safe change and
is specifically a case where the migration component should not be used. This also matches the
codebase's established optional-field widening discipline.

The owner promotion is not a schema migration. It is a deliberate privileged grant to one exact
user row after the widened schema is deployed.

Do not later narrow `owner` to required: Convex Auth continues to create valid non-owner rows with
the field absent. If a future role system replaces the boolean, that is a separate
widen-migrate-narrow project.

Because the auth table definition is copied from a pinned dependency, add a nearby comment naming
`@convex-dev/auth@0.0.94` and require its `authTables.users` fields/indexes to be rechecked when that
dependency is upgraded.

## Recommended Authorization Primitives

Keep all raw public builder imports in `lib/functions.ts`. The implementation shape should be:

```ts
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx } from "../_generated/server";

type AuthCtx = Pick<QueryCtx, "auth">;
type OwnerCtx = Pick<QueryCtx, "auth" | "db">;

async function requireAuthUserId(ctx: AuthCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("UNAUTHENTICATED");
  return userId;
}

async function tenantFields(ctx: AuthCtx) {
  const userId = await requireAuthUserId(ctx);
  return { userId, tenantId: String(userId) };
}

export async function requireOwner(ctx: OwnerCtx) {
  const fields = await tenantFields(ctx);
  const user = await ctx.db.get(fields.userId);
  if (user?.owner !== true) throw new Error("OWNER_REQUIRED");
  return fields;
}

export const tenantQuery = customQuery(
  query,
  customCtx(async (ctx) => tenantFields(ctx)),
);

export const tenantMutation = customMutation(
  mutation,
  customCtx(async (ctx) => tenantFields(ctx)),
);

export const tenantAction = customAction(
  action,
  customCtx(async (ctx) => tenantFields(ctx)),
);

export const ownerQuery = customQuery(
  query,
  customCtx(async (ctx) => requireOwner(ctx)),
);

export const ownerMutation = customMutation(
  mutation,
  customCtx(async (ctx) => requireOwner(ctx)),
);
```

The exact context type may need a small structural generic adjustment for `customCtx`, but the
security contract must remain exactly this:

1. derive `userId` only from `getAuthUserId(ctx)`;
2. reject null identity as `UNAUTHENTICATED`;
3. load that exact `users` row server-side;
4. accept only literal `owner === true`;
5. inject both typed `userId` and the behavior-compatible string `tenantId`;
6. run the endpoint handler only after the check.

Do not accept `userId`, `tenantId`, `owner`, email, or role as function arguments. Do not fall back
to environment variables.

### Actions

The current owner functions are queries and mutations. Convex action contexts have auth but no
direct database reader, so do not publish a fake `ownerAction` that only checks authentication.
When the first public owner action is actually needed, add an owner action wrapper that derives the
user ID with `getAuthUserId` and verifies it through a small internal query before running the
handler. Until then, `ownerQuery` and `ownerMutation` cover the real surface without speculative
machinery.

## Owner Bootstrap

Add a narrowly scoped module such as `packages/backend/convex/owner.ts` with:

1. a tenant-readable `viewer` query for UI presentation; and
2. an idempotent `internalMutation` named `bootstrapOwner`.

The mutation should accept only `userId: v.id("users")`, never email and never a caller-supplied
boolean:

```ts
export const bootstrapOwner = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user === null) throw new Error("NO_SUCH_USER");
    if (user.owner === true) return { changed: false, userId, owner: true };

    await ctx.db.patch(userId, { owner: true });
    await ctx.runMutation(internal.audit.log, {
      tenantId: String(userId),
      correlationId: crypto.randomUUID(),
      eventType: "owner.granted",
      actor: "operator",
      payload: { userId: String(userId), owner: true },
    });
    return { changed: true, userId, owner: true };
  },
});
```

This follows the existing `tenantProfile.grantEnterprise` operator pattern and the established
`internal.audit.log` choke point. The audit payload contains only a stable row reference and a
boolean, never email, name, token, or session ID. Re-running the command is a no-op and emits no
duplicate grant audit.

Use the exact user ID to avoid email aliases, provider linking ambiguity, or accidental promotion
of the wrong row:

```powershell
cd packages/backend
npx convex data users
npx convex run owner:bootstrapOwner '{"userId":"<users._id>"}'
```

Target the intended deployment explicitly when doing production work. Verify the returned
`owner: true`, inspect the user row, then run the same command again and confirm `changed: false`.

Do not add a public promote/demote mutation in this phase. Multiple owners are already representable
by invoking the internal promotion for another exact user ID; richer role management is deferred.

### Safe rollout order

For a live deployment:

1. Deploy the widened `users` schema, official tenant identity helper, viewer query, and internal
   bootstrap mutation.
2. Run `bootstrapOwner` for the intended existing user and verify the row.
3. Deploy or enable the owner-wrapped functions and hidden UI.

If the source is deployed in one step, the system still fails closed: optimizer controls are
temporarily unavailable until bootstrap, rather than exposed. Never add an authentication-only or
environment fallback to avoid that temporary lockout.

## Exact Function Gates

| Module / function | Final boundary | Notes |
| --- | --- | --- |
| `optimizerConfig.getOptimizerStatus` | `ownerQuery` | Part of the same hidden owner control; prevents direct read of global optimizer state. |
| `optimizerConfig.setOptimizerEnabled` | `ownerMutation` | GOVN-01 required; shared `writeConfig` remains identity-agnostic. |
| `skills.candidatesForReview` | `ownerQuery` | GOVN-01 required; candidate and active bodies never reach a non-owner. |
| `skills.activateCandidate` | `ownerMutation` | GOVN-01 required; calls the unchanged shared `activateSkillVersion` and therefore still requires passing evidence for candidates. |
| `owner.viewer` | `tenantQuery` | Returns only `{ isOwner: boolean }`; it must be callable by non-owners so the UI can hide controls. |
| `internal.optimizerConfig.setOptimizerConfig` | unchanged internal mutation | Trusted CI/operator seam, no browser identity. |
| `internal.skills.activateSkill` | unchanged internal mutation | Trusted eval/operator seam; the `EVAL_GATE` remains shared. |
| `internal.skills.insertCandidate` | unchanged internal mutation | Candidate-only machine writeback. |
| `internal.tenantProfile.grantEnterprise` | unchanged internal mutation | Existing operator-only admin seam; if later exposed publicly, use the owner wrapper from its first public commit. |

The `owner.viewer` handler should read the already authenticated `ctx.userId` injected by
`tenantQuery` and return `user?.owner === true`. It must not return the user document, email, name,
or any candidate/config data.

## UI Boundary

The current `/ops` page renders, in order:

1. tenant-scoped evaluation signals;
2. the global optimizer control and candidate review panel;
3. tenant-scoped dead letters.

Only item 2 is owner-only. Implement the page shape as:

```tsx
export default function OpsPage() {
  const viewer = useQuery(api.owner.viewer);
  // existing tenant DLQ queries remain mounted

  return (
    <>
      <EvalSignalsSection />
      {viewer?.isOwner === true ? <OptimizerSection /> : null}
      <DeadLettersSection />
    </>
  );
}
```

The condition must wrap the entire optimizer section, including its heading. `OptimizerPanel`
must not mount while `viewer` is `undefined` or when `isOwner` is false; otherwise its
`getOptimizerStatus` and `candidatesForReview` hooks will issue requests, produce avoidable
authorization errors, and reveal the existence of the panel through loading/error UI.

Preserve:

- `/ops` for authenticated tenants;
- the Compliance navigation item;
- `DeadLetterBadge`;
- `api.opsSignals.evalSignals`;
- `api.deadLetters.listNew`, `newCount`, and `markResolved`.

Those are tenant operational signals, not global owner controls. Hiding the entire page or
Compliance route would regress incident visibility and violate the explicit Phase-22 scope.

Phase 25 can move the optimizer panel onto the combined owner-admin/waitlist page. Phase 22 should
not create the invite surface early.

## `SKILLOPT_OWNER_TENANT`, CI, and Other Out-of-Scope Seams

`SKILLOPT_OWNER_TENANT` currently appears in `/skillopt/writeback` to select the tenant that
receives the refs-only optimization audit and "candidate ready" notification. That endpoint is a
machine-to-machine bearer-token path and has no signed-in Convex user context.

For GOVN-01:

- never read `SKILLOPT_OWNER_TENANT` in `requireOwner`;
- do not delete or repurpose it in the writeback route;
- do not redesign the optimizer CI workflow or bearer-token authentication;
- do not change `/skillopt/export`;
- do not expand into the names-in-prose PII export ceiling or legal-entity work.

The environment variable remains an interim machine-notification routing value, not an
authorization source. Replacing that routing mechanism belongs to the future multi-user/optimizer
design.

## Redaction and Audit Architecture (`CLAUDE.md` §4)

Authorization data is control-plane data:

- `users.owner`: one boolean on the auth user row;
- `owner.viewer`: one boolean response;
- `owner.granted` audit payload: stable user-row reference plus boolean.

Never put these in audit or DLQ payloads:

- email or name;
- JWT subject or `tokenIdentifier`;
- session ID;
- candidate or active skill body;
- optimizer evidence prose;
- any user-supplied content.

Candidate bodies remain in the existing `skills` content/control table and are returned only after
the owner query guard. The UI may render them to the owner, but no new audit event should copy those
bodies. Denied reads do not need a content-bearing audit event.

The bootstrap grant is worth one insert-only refs-only audit event because it changes the
authorization trust root. It must use `internal.audit.log`, not insert directly into `audit`, so
the aggregate and insert-only convention remain intact.

## Testing Strategy

### Identity and wrapper tests

Update `tenant.test.ts` to prove the official helper preserves the existing scope:

1. insert a real `users` row;
2. authenticate as `<userId>|session_a`, write tenant data;
3. authenticate the same user as `<userId>|session_b`, read the same data;
4. authenticate a second real user and prove isolation;
5. retain unauthenticated `UNAUTHENTICATED` checks.

This is stronger than the current pure string split test because it exercises the actual wrapper
and typed user-row ID used by authorization.

Add focused owner-wrapper tests:

- unauthenticated -> `UNAUTHENTICATED`;
- authenticated user with no `owner` field -> `OWNER_REQUIRED`;
- authenticated user with `owner: false` -> `OWNER_REQUIRED`;
- `owner: true` succeeds;
- one owner user succeeds through two different session suffixes;
- a nonexistent/orphan user ID fails closed.

### Function-level security tests

Convert the current `"owner_a"` authenticated-only tests to real inserted user rows and cover:

| Function | Owner assertion | Non-owner assertion |
| --- | --- | --- |
| `getOptimizerStatus` | Reads dormant/default or stored config | Rejects before returning config |
| `setOptimizerEnabled` | Flips the one shared row | Rejects and leaves row absent/unchanged |
| `candidatesForReview` | Returns before/after bodies and gate status | Rejects; no bodies returned |
| `activateCandidate` | Passing evidence activates | Rejects and leaves active/candidate statuses unchanged |

Keep the existing independent `EVAL_GATE` tests. Owner authorization is an additional gate, not a
replacement:

```text
public activation = owner authorization AND passing evidence for a candidate
internal activation = trusted internal caller AND passing evidence for a candidate
rollback = still structurally exempt from evidence, but public rollback still requires owner
```

Also retain tests proving the internal CI/eval functions work without a browser identity. That
prevents an implementation from accidentally putting `requireOwner` inside shared helpers.

### Bootstrap tests

Using `convex-test`:

- missing user ID -> `NO_SUCH_USER`;
- absent/false owner -> patches `true` and returns `changed: true`;
- second call -> `changed: false`;
- another user remains non-owner;
- exactly one `owner.granted` audit row is created;
- audit payload key set is exactly `owner,userId`;
- payload contains no email, name, subject, token, session, or skill body.

### Static architecture guard

Extend or add a small source guard that asserts the named public functions are declared with the
owner wrappers. Behavioral tests are primary, but this catches a future refactor that silently
changes `ownerMutation` back to `tenantMutation` before a test fixture reaches the handler.

Document beside the raw-builder import rule:

> A client-callable function that reads or mutates global/operator state starts as
> `ownerQuery`/`ownerMutation`; internal machine/operator seams remain `internal*`.

No regex can infer every future "admin-ish" semantic, so the wrapper convention and review
checklist are still necessary.

### UI verification

The repository has Playwright but no React component-test harness. Do not add a new frontend test
framework only for this conditional. Security is covered by backend tests; verify presentation
with the existing browser stack:

- non-owner `/ops`: Eval signals and Dead letters remain; no Optimizer heading, toggle, candidate
  body, evidence, or Activate button;
- owner `/ops`: Optimizer heading, switch, and candidate review render;
- direct non-owner calls to the three GOVN-01 APIs still reject server-side;
- Compliance navigation and dead-letter badge remain for both.

If a two-account Playwright fixture is already available when the phase executes, automate these
two page states. Otherwise use the phase's human-verification checkpoint rather than introducing
credentials or auth test infrastructure under GOVN-01.

## Validation Architecture

### Requirement-to-proof map

| Requirement / risk | Layer 1: fast unit/static | Layer 2: Convex integration | Layer 3: live/UI |
| --- | --- | --- | --- |
| Stable owner identity across sessions | Installed-source assertion documented; wrapper unit behavior | Same real `users` ID with two session subjects succeeds | Sign out/in does not lose owner controls |
| Absent owner fails closed | `user?.owner === true` branch tests | Legacy user row without field rejects all owner endpoints | Non-owner sees no optimizer section |
| `setOptimizerEnabled` protected | Source wrapper guard | Non-owner rejection plus zero config mutation | Owner can toggle; non-owner cannot |
| `activateCandidate` protected | Source wrapper guard | Non-owner status immutability; owner + evidence succeeds | Activate appears only for owner |
| Candidate bodies protected | Source wrapper guard | Non-owner query rejects; owner receives expected diff | No candidate body/heading in non-owner DOM |
| Eval gate preserved | Existing evidence/rollback unit suite | Public owner activation still rejects missing/stale evidence | UI surfaces gate error only to owner |
| Tenant operations preserved | Existing tenant/DLQ/eval suites | Two-user tenant isolation remains green | Both users retain Eval signals, DLQ, Compliance badge |
| Durable bootstrap | Idempotence and payload-key tests | Run internal mutation twice against test DB | `convex run` returns true then false; owner survives new login |
| §4 payload discipline | Exact audit payload key assertion | One insert-only audit row via choke point | Inspect audit row: refs/boolean only |

### Commands

Run targeted tests first:

```powershell
cd packages/backend
pnpm exec vitest run convex/tenant.test.ts convex/owner.test.ts convex/optimizerConfig.test.ts convex/skills.test.ts convex/importGuard.test.ts
pnpm typecheck
```

Then run the backend suite undisturbed:

```powershell
cd packages/backend
pnpm test
```

Run web typechecking:

```powershell
cd apps/web
pnpm typecheck
```

Finally exercise the configured live deployment and `/ops` page with an owner and a non-owner. Do
not background the full Vitest suite while source files are still changing; the repository has a
documented history of module transforms going red when a long run overlaps edits.

### Mutation checks

The validation is not complete until these deliberate defects make tests fail:

1. Change `user?.owner !== true` to an authentication-only condition. Non-owner tests for all
   three GOVN-01 functions must turn red.
2. Change one named endpoint from `ownerMutation`/`ownerQuery` back to its tenant wrapper. The
   source guard and function-level non-owner test must turn red.
3. Remove the UI `isOwner` branch. Non-owner UI verification must fail because the optimizer
   heading/control appears.
4. Move the owner check below `writeConfig` or `activateSkillVersion`. State-immutability tests
   must fail.

### Deployment gate

Before declaring GOVN-01 complete:

- owner row is bootstrapped on the intended deployment;
- bootstrap is idempotent;
- an owner session and a non-owner session have been tested;
- all three named APIs reject the non-owner server-side;
- candidate bodies are absent from the non-owner UI;
- tenant eval and DLQ signals still work;
- no use of `SKILLOPT_OWNER_TENANT` appears in the new authorization path.

## Suggested Plan Decomposition

### Plan 22-01: Identity and durable owner substrate

- Override the auth `users` schema with optional `owner`.
- Replace manual production subject parsing with `getAuthUserId`.
- Inject typed `userId` plus compatible `tenantId` in tenant wrappers.
- Add `requireOwner`, `ownerQuery`, and `ownerMutation`.
- Add `owner.viewer` and idempotent audited `bootstrapOwner`.
- Add identity, owner-wrapper, bootstrap, and §4 tests.
- Deploy/bootstrap checkpoint before public guards are considered usable.

### Plan 22-02: Gate the known global controls

- Move the three GOVN-01 functions to owner wrappers.
- Gate `getOptimizerStatus` as the companion owner-only read.
- Preserve internal CI/eval/operator seams and the shared `EVAL_GATE`.
- Add owner/non-owner state and disclosure tests plus a source guard.

### Plan 22-03: Hide only the optimizer surface and verify live

- Query `owner.viewer` on `/ops`.
- Mount the entire Optimizer section only for `isOwner === true`.
- Preserve Eval signals, Dead letters, Compliance navigation, and badge.
- Run backend/web gates and owner/non-owner live verification.

## Pitfalls to Avoid

1. **Using the whole subject or `tokenIdentifier`.** Both carry the session-specific subject in
   this installed auth implementation.
2. **Making `owner` required.** Normal Google/password user creation omits it.
3. **First-user bootstrap.** Registration order is not authorization.
4. **Email-based bootstrap.** Provider linking, aliases, and duplicate/unverified addresses make
   email a weaker target than exact `users._id`.
5. **Environment fallback.** `SKILLOPT_OWNER_TENANT` is routing for a machine notification, not a
   user authorization fact.
6. **Guarding only the UI.** Direct API calls remain possible; wrappers are the trust boundary.
7. **Mounting hidden queries.** Conditionally style-hidden components still fetch candidate bodies
   and leak the surface through errors/loading states.
8. **Hiding all of `/ops`.** That removes tenant DLQ/eval visibility.
9. **Guarding shared internal helpers.** This breaks CI/eval/operator paths and can duplicate the
   eval gate.
10. **Adding a migration for an optional field.** There is no data transformation; absent already
    means false.
11. **Copying auth schema incompletely.** Preserve every installed user field and both index names;
    recheck the mirror on dependency upgrade.
12. **Auditing bodies or identity claims.** Audit only the stable user ref and boolean grant.

## Files Expected to Change During Implementation

Likely:

- `packages/backend/convex/schema.ts`
- `packages/backend/convex/lib/functions.ts`
- `packages/backend/convex/tenant.test.ts`
- `packages/backend/convex/importGuard.test.ts`
- `packages/backend/convex/owner.ts` (new)
- `packages/backend/convex/owner.test.ts` (new)
- `packages/backend/convex/optimizerConfig.ts`
- `packages/backend/convex/optimizerConfig.test.ts`
- `packages/backend/convex/skills.ts`
- `packages/backend/convex/skills.test.ts`
- `apps/web/app/(app)/ops/page.tsx`
- one durable backend convention/playbook note for future admin-like public functions

Explicitly not required by GOVN-01:

- `packages/backend/convex/migrations.ts`
- `packages/backend/convex/http.ts`
- `.github/workflows/skillopt.yml`
- invite/waitlist schema or UI
- legal/privacy content
- export scrub redesign
- all-ops route removal or navigation changes

## Sources Consulted

Project decisions and requirements:

- `.planning/ROADMAP.md` — Phase 22 goal and success criteria
- `.planning/REQUIREMENTS.md` — `GOVN-01`
- `.planning/STATE.md` — standing Phase-8 owner-auth blocker
- `.planning/phases/09-private-beta-productionization/09-CONTEXT.md` — locked owner/admin
  decisions, non-owner UX, internal-vs-public scope, and `SKILLOPT_OWNER_TENANT` caveat
- `CLAUDE.md` — wrapper trust boundary, insert-only audit, and §4 redaction rules
- `packages/backend/AGENTS.md` and generated Convex guidelines
- `packages/backend/.agents/skills/convex-migration-helper/SKILL.md`

Current implementation:

- `packages/backend/convex/lib/functions.ts`
- `packages/backend/convex/importGuard.test.ts`
- `packages/backend/convex/tenant.test.ts`
- `packages/backend/convex/schema.ts`
- `packages/backend/convex/auth.ts`
- `packages/backend/convex/optimizerConfig.ts` and `.test.ts`
- `packages/backend/convex/skills.ts` and `.test.ts`
- `packages/backend/convex/audit.ts`
- `packages/backend/convex/http.ts`
- `packages/backend/convex/tenantProfile.ts`
- `apps/web/app/(app)/ops/page.tsx`
- `apps/web/app/(app)/layout.tsx`
- `apps/web/playwright.config.ts` and `apps/web/e2e/auth.setup.ts`

Pinned dependency implementation:

- `@convex-dev/auth@0.0.94` token, helper, schema, and user-upsert sources
- `convex@1.42.1` authentication identity type
- `convex-helpers@0.1.120` custom function wrappers

## Research Conclusion

There is no unresolved architectural question for GOVN-01. The installed auth package provides the
stable user-row adapter; the repository already provides the correct custom-wrapper and audit
patterns; the schema change is a safe optional widening; and the current mixed `/ops` layout makes
the presentation boundary precise. Planning can proceed with the three-plan decomposition above.
