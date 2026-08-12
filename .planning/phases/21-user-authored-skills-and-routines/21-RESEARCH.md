# Phase 21 Research: User-Authored Skills & Routines

**Researched:** 2026-08-10  
**Requirement:** SKILL-01  
**Status:** Ready to plan

## Summary

Phase 21 should ship two deliberately small capabilities:

1. A signed-in user can add a business-specific adaptation to an existing eval-gated skill. The write can create only a tenant-owned immutable `candidate`; it cannot activate anything. A tenant candidate becomes effective only after the existing held-out golden evaluation records exact passing evidence and the existing owner-authorized activation boundary accepts it. The model's tools and other capabilities remain code-owned.
2. A signed-in user can save a chat prompt, see a bounded list of saved prompts, and run one again through the existing cockpit send path in a fresh thread. This is the entire pre-beta "routine" deliverable.

Do not build a `routines` table, schedules, cron, an authoring canvas, a graph DSL, a trigger engine, or direct activation. Those remain evidence-gated on a user actually re-running a saved prompt twice.

Phase 19 is complete and is no longer a dependency blocker. Phase 17.1/18 still have live/UAT closure work, but their underlying registry, cockpit, specialist, and content capabilities are present; that verification state should be recorded rather than used to block Phase 21 planning.

## Existing Seams and Invariants

### Registry and activation

- `packages/backend/convex/skills.ts`
  - `insertCandidate` is an `internalMutation` that accepts only names in `GATED_SKILLS`, writes `status: "candidate"`, allocates `maxVersion + 1`, never patches prior bodies, and is idempotent against the newest body's bytes.
  - `activateSkillVersion` is the single status-flip implementation. A gated row in `candidate` status must have passing evidence for the exact `(name, version)`. `archived`/`rolled_back` targets are evidence-exempt so rollback cannot be blocked by a broken eval harness.
  - `activateCandidate` is `ownerMutation`; owner authorization and eval evidence are independent gates.
  - `recordEvalEvidence` patches evidence only. `getSkillVersion` is the exact-version read used by evaluation. `getActiveSkill`/`loadSkill` fail closed when no global active row exists.
- `packages/contracts/src/skill.ts`
  - `GATED_SKILLS` is the existing allowlist.
  - `hasPassingEvidence` fails closed and requires `pass === true` plus an exact `skillVersions[name] === version` pin.
- `packages/backend/scripts/run-eval-golden.mjs`
  - Valid `--skill` names are derived from `GATED_SKILLS`.
  - The runner uses a throwaway eval tenant, runs the full held-out corpus, permits one retry per case, and records evidence only on an all-green, unfiltered run.
  - `--only` is diagnostic and must never record evidence.
  - The golden corpus is held out from the authoring actor. A Phase 21 UI must not expose fixture content.

### The global-registry mismatch

The current `skills` table is deployment-global: rows have `name`, `version`, `body`, `status`, optional `evidence`, and `createdAt`, but no `tenantId` or author provenance. Its indexes and `.unique()` reads assume only one active row per name across the deployment. Adding tenant rows directly to this table would make existing `by_name_status` and `by_name_version` reads ambiguous and could break every agent on the deployment.

Phase 21 therefore must not casually add `tenantId` to existing rows or encode tenancy into a skill name. A namespaced string would leave authorization dependent on string parsing, would not make provenance structural, and would not satisfy the tenant-isolation requirement.

### Authorization and capability

- `packages/backend/convex/lib/functions.ts` supplies `tenantQuery`/`tenantMutation`, which derive `tenantId` and `userId` from authenticated identity. Public authoring and saved-prompt functions must use these wrappers and must not accept an authorization tenant/user argument.
- `ownerMutation`/`ownerQuery` are the existing activation/review authority. User-authored does not mean user-activated.
- ADR-007 and `docs/playbooks/agent-runtime.md` make capability code-owned. A skill body can advise use of a tool already granted by code; it cannot add a tool, action kind, provider scope, approval bypass, spend bypass, or delivery path.
- Audit/dead-letter payloads are refs/hashes/ids/counts only. Candidate and saved-prompt text is content-plane data and must never be copied into audit payloads or errors.

### Cockpit and saved prompts

- `packages/backend/convex/cockpit.ts:sendCockpitMessage` is already the governed tenant action. It creates a thread/plan when `threadId` is absent, persists the user turn, runs guardrails and the versioned agent, records activity, and saves the assistant reply.
- `apps/web/app/(app)/dashboard/workspace/useSendCockpitMessage.ts` is the mandatory browser wrapper. It supplies the user's current IANA timezone and clock. A re-run must call this hook; raw `useAction(api.cockpit.sendCockpitMessage)` would regress calendar/CRM reachability.
- `ChatPane.tsx` already renders user-message controls and owns the send operation. `workspace/page.tsx` already owns fresh-thread registration, the past-chat menu, and the compact header-menu pattern.

## Recommended Architecture

### 1. Add a tenant-owned registry overlay

Add a separate `tenantSkills` table rather than migrating the deployment-global `skills` table in this phase. It is an overlay over the canonical registry, not a second prompt system: runtime loading resolves the tenant overlay first and falls back to the existing global active row.

Recommended fields:

```text
tenantId       string
name           string                 // must be in GATED_SKILLS
version        number                 // immutable tenant-local version
body           string                 // complete runtime body, immutable
authoredBody   string                 // the user's authored adaptation, immutable
status         active | candidate | archived | rolled_back
author         system | user          // Phase 23 may append agent later
authorUserId   optional Id<users>      // required when author=user
basedOnName    string
basedOnVersion number
basedOnScope   global | tenant
evidence       optional string
createdAt      number
```

Indexes:

```text
by_tenant_name_status   [tenantId, name, status]
by_tenant_name_version  [tenantId, name, version]
by_status_createdAt     [status, createdAt]       // bounded owner review queue
```

Why an overlay:

- Global seed rows and all current `.unique()` assumptions remain valid.
- Two tenants can have the same skill name and local version without collision.
- Tenant deletion/export and Phase 25 cross-user testing have an explicit key.
- Provenance is structural rather than inferred from names or audit prose.
- Phase 23 can later add `author: "agent"` to the same tenant-owned insertion boundary without granting activation.

The effective loader should be one shared helper:

```text
loadEffectiveSkill(ctx, tenantId, name)
  -> tenant active row if exactly one exists
  -> otherwise existing global active row
  -> otherwise NO_ACTIVE_SKILL
```

Add tenant-aware internal query wrappers for active and exact-version reads. Preserve the existing global wrappers for seed/operator paths. Thread `tenantId` through tenant-facing agent call sites as plans allow; a user-authored skill cannot be declared complete until at least the authored target's real runtime path demonstrably uses `loadEffectiveSkill`.

For the first tenant candidate, atomically create an immutable tenant baseline row copied from the effective active version as `archived`, then create the user candidate as the next version. That gives the first customization a real evidence-exempt rollback target. Later candidates base themselves on the tenant's current active row. Never implement "rollback" by deleting the tenant active row.

### 2. Publish an adaptation, not an unguarded replacement

Expose a `tenantMutation` such as `skills.publishUserCandidate`. It derives `tenantId`/`userId`, validates the selected name against `GATED_SKILLS`, validates a nonblank bounded authored body, reads the effective active base, composes a complete candidate body, and calls the same candidate insertion logic used by `insertCandidate`.

The user should author a bounded adaptation section, not receive and replace the hidden global prompt. Server composition should be deterministic, for example:

```text
<immutable effective base body>

## Tenant-authored business adaptation
<user-authored text>
```

Store both the full composed `body` and the exact `authoredBody`, plus the base lineage. This avoids disclosing global prompt bodies to ordinary users, avoids accidentally deleting the core contract, makes review intelligible, and keeps the final body under the existing eval gate. Re-editing must replace the prior adaptation against the current active base, not append adaptations recursively.

Validation at the mutation boundary should include:

- `name` is in `GATED_SKILLS` (prefer a deliberately exported `USER_AUTHORABLE_SKILLS` subset if product copy cannot honestly explain all gated internal skills).
- `authoredBody.trim()` is nonempty.
- A conservative UTF-8 byte/character cap prevents an oversized row and unbounded prompt cost. Keep the constant in one pure contract module and use it in server and UI copy.
- No caller-supplied tenant, user, author, status, version, evidence, or base body.
- Candidate insertion is idempotent against the newest tenant candidate's authored bytes and lineage.
- The mutation can only write `candidate` (plus the one initial archived baseline); it has no call/reference to an activation function.

Write a refs-only audit row only when a new candidate is inserted: skill name, tenant candidate id/version, base scope/version, author kind, body hash and byte count. Never audit either body.

### 3. Reuse the existing gate with unambiguous tenant pins

Once tenant-local versions exist, `<name>@<version>` alone is ambiguous. Extend the internal eval pin/evidence path with an explicit registry scope, preferably the tenant candidate row id or `(registryTenantId, name, version)`.

The evaluation data tenant must remain the runner's throwaway `eval-<runId>` tenant. The registry tenant identifies only the body under test. Do not run fixtures against the user's real tenant, and do not copy fixture rows into it.

The runner should:

1. Resolve the exact tenant candidate before the first paid turn.
2. Thread that exact body pin into every model/specialist turn while all plan/vault/mail fixtures continue to use the throwaway eval tenant.
3. Record evidence back on the exact tenant candidate row only after a full, unfiltered, all-green run.
4. Include a non-sensitive candidate id/scope pin in evidence so name/version collisions cannot certify another tenant's row.
5. Continue suppressing evidence for `--only`, zero-case, failed, interrupted, or over-cap runs.

Generalize the existing activation helper so global and tenant targets share the same `candidate -> exact-evidence -> active` rule. The owner review queue may accept an exact tenant candidate id because `ownerMutation` is the server-side authority. It must archive only the active row in that same tenant/name scope. Global activation and another tenant's active row must remain untouched.

The user-facing authoring surface shows `Candidate — awaiting evaluation` or `Candidate — evaluation passed, awaiting owner activation`. It must not offer an Activate control. Paid evaluation remains an explicit governed operator action; publishing a draft must spend $0.

### 4. Saved prompts are the pre-beta routine

Add a `savedPrompts` table, not `routines`:

```text
tenantId   string
text       string
title      string       // code-derived trimmed first line, bounded
textHash   string       // idempotence/dedup within tenant
createdAt  number
```

Indexes:

```text
by_tenant_createdAt  [tenantId, createdAt]
by_tenant_textHash   [tenantId, textHash]
```

Expose only bounded tenant functions: save/pin, list newest (a small fixed cap or pagination), and delete/unpin by id after tenant ownership verification. Saving is idempotent by tenant+hash. Text remains content-plane data; audit either nothing or refs/hash/count only.

Use the existing workspace instead of adding a route or navigation entry:

- Add `Pin prompt` beside `Copy` on user chat bubbles in `ChatPane.tsx`.
- Add a compact `Pinned prompts` header menu/panel using the existing `HeaderMenu`/empty-state patterns in `workspace/page.tsx` (or a small child component extracted beside it).
- `Run` must call `useSendCockpitMessage` with no `threadId`, then register the returned thread. This makes each run a fresh ordinary chat with the same plan, guardrail, spend, activity, and approval boundaries. It must not call an internal action, schedule a job, or clone prior plan state.
- Show honest loading, empty, saving, running, and inline error states. Disable duplicate clicks while a run is in flight. Use existing CSS variables and focus-visible behavior from `BRAND.md`.

The saved prompt is inert until the user presses Run. There is no background trigger, recurrence, next-run timestamp, execution history table, or routine status.

## Exact File Map

Expected implementation files (plans should keep each wave path-scoped):

- `packages/backend/convex/schema.ts` — `tenantSkills` and `savedPrompts` tables/indexes.
- `packages/backend/convex/skills.ts` — shared candidate insertion/activation logic; tenant public publish/list read; owner review/activation extension; effective and exact tenant reads; refs-only audit.
- `packages/contracts/src/skill.ts` or a small `packages/core/src/userSkill.ts` — authorable allowlist/labels and pure body/size/composition contracts. Do not put tenant business logic in React or duplicate `GATED_SKILLS` literals.
- `packages/backend/convex/llm.ts` and the smallest set of existing skill-loader callers — thread tenant-aware effective/exact pins to the real target runtime path. Keep tool records and grants byte-for-byte unchanged.
- `packages/backend/scripts/run-eval-golden.mjs` — unambiguous tenant candidate pin, throwaway-data/eval-scope separation, exact evidence target, offline self-check.
- `packages/backend/convex/savedPrompts.ts` — thin tenant-scoped CRUD adapter. If kept in `cockpit.ts`, retain bounded query/write separation; a dedicated file is clearer ownership and avoids growing the already-large cockpit adapter.
- `apps/web/app/(app)/dashboard/workspace/ChatPane.tsx` — pin control and/or saved-prompt runner integration through `useSendCockpitMessage`.
- `apps/web/app/(app)/dashboard/workspace/page.tsx` — existing header menu/fresh-thread registration integration.
- Optional small `apps/web/app/(app)/dashboard/workspace/PinnedPrompts.tsx` — only if extraction keeps page/ChatPane simpler; do not create a new route.
- `apps/web/app/(app)/ops/page.tsx` — tenant-labelled candidate diff/evidence/owner activation, bounded and owner-only.
- `docs/playbooks/skill-registry.md` — tenant overlay, provenance, effective-load order, eval pin, activation and rollback procedures.
- `docs/playbooks/cockpit.md` — saved prompt -> fresh ordinary cockpit send, no-trigger boundary.
- `docs/playbooks/watch.json` — register any new backend/UI/test paths under exactly one relevant playbook.

Expected tests:

- `packages/backend/convex/skills.test.ts` — extend existing registry/eval/owner tests with tenant candidate behavior.
- `packages/backend/convex/savedPrompts.test.ts` — bounded CRUD, dedupe and isolation.
- `packages/contracts/src/skill.test.ts` or focused pure test beside the new contract — authorable allowlist, composition and cap.
- Existing loader/integration tests such as `packages/backend/convex/runCockpitAgent.test.ts` — tenant override and global fallback at the real agent load.
- `packages/backend/scripts/run-eval-golden.mjs --self-check` — candidate-scope parser and no-evidence rules.
- `apps/web/app/(app)/dashboard/workspace/*test.ts(x)` — source/component contract that every browser re-run still uses `useSendCockpitMessage`, starts a fresh thread, and presents a real button/label rather than colour-only state.
- `apps/web/e2e/skill-authoring.spec.ts` (or one narrowly named Phase 21 spec) — authenticated authoring and pinned-prompt behavior. Do not put this under the old permanently-red broad pipeline spec.

## Plan Decomposition and Dependencies

Recommended plan sequence:

1. **21-01 — Contracts and schema foundation.** Add pure authoring contracts, `tenantSkills`, `savedPrompts`, indexes, playbook/watch ownership, and schema-level tests. No UI and no paid run.
2. **21-02 — Tenant candidate write/read and effective loading.** Implement candidate-only publish, provenance, initial rollback baseline, tenant list/status, global fallback, refs-only audit, and isolation/immutability tests. Thread the target runtime loader. Depends on 21-01.
3. **21-03 — Tenant eval and owner activation.** Generalize exact pin/evidence/activation by tenant candidate identity; update runner self-check and owner review UI; prove partial/mismatched evidence fails closed and rollback remains exempt. Depends on 21-02 and existing Phase 3.6/22 seams.
4. **21-04 — Saved prompts in the cockpit.** Implement bounded saved-prompt CRUD and workspace Pin/List/Run/Delete states; Run goes through `useSendCockpitMessage` in a fresh thread. Can execute after 21-01 in parallel with 21-02/03 if files do not overlap, but serialize final workspace integration in the shared tree.
5. **21-05 — Integrated verification and live/UAT gate.** Free test/typecheck/build/playbook gates first; authenticated two-tenant isolation and browser UAT; then, only with explicit spend authorization, one user candidate full golden run and owner activation/rollback proof. Depends on 21-02 through 21-04.

Do not entangle Phase 21 with Phase 20.1's `cockpit-agent` source-body candidate stream. Phase 21's tenant overlay is precisely what avoids minting a deployment-global candidate containing another lane's prose. If Phase 20.1/18/20 edits the global active body during implementation, rebase the first tenant candidate's `basedOnVersion` before evaluation rather than silently evaluating an obsolete base.

## Pitfalls

1. **Putting tenant rows in the global `skills` table.** Existing `.unique()` indexes become multi-row and can fail every agent. Use the overlay.
2. **Using only name+version as an eval target.** Two tenants can both have `cockpit-agent@2`; evidence must target an exact tenant candidate.
3. **Running fixtures in the user's tenant.** Registry scope and eval-data scope are different. Keep fixture data throwaway.
4. **Exposing global prompt bodies to ordinary users.** Existing ops comments identify raw bodies as an owner-only disclosure boundary. Author an adaptation; compose server-side.
5. **Appending adaptations recursively.** Compose against the current active base and store lineage; do not make each new body include every prior draft.
6. **Treating prompt text as a capability grant.** Tools, action kinds, provider scopes, approval gates, budgets, and side effects remain code-owned.
7. **User activation or automatic activation.** Publish writes candidate only. Eval pass is necessary but activation still crosses the owner mutation.
8. **A first customization with no rollback.** Insert an archived tenant baseline or provide an equally structural prior-active target before activation.
9. **A filtered eval that writes evidence.** Preserve the existing `--only` suppression and test it non-vacuously.
10. **Raw browser action calls.** Pinned runs must use `useSendCockpitMessage`; otherwise trusted clock/zone disappear and Phase 17/19 tools regress.
11. **Calling a saved prompt a routine while it has hidden automation.** It is user-triggered and inert at rest. No cron, schedule, trigger or background execution.
12. **Unbounded bodies or lists.** Cap authored bytes and use bounded/paginated reads; never `.collect()` a tenant's open-ended history.
13. **Auditing content.** Only ids, hashes, versions, author enum and counts belong in audit. Never bodies, prompt titles, eval prompts or model output.
14. **Concurrent global candidate edits.** The repository's `seedSkills` stream is singleton and writes `maxVersion+1`; do not seed or activate a global body from Phase 21.

## Validation Architecture

### Test layers

| Layer | What it proves | Commands / artifacts |
|---|---|---|
| Pure contracts | Closed authorable names, deterministic composition, byte cap, evidence-scope parsing | focused contracts/core tests |
| Convex unit | Candidate-only writes, provenance, immutable versions, effective fallback, exact gate, rollback, saved-prompt CRUD | focused backend Vitest files via `pnpm --filter @pikar/backend test` or file filter |
| Static trust-boundary | No activation reference in user publish, no tool-grant changes, no raw action in browser, refs-only audit fields | existing/new source-scan tests |
| Runner offline | Tenant candidate target parses; duplicate/ambiguous pins reject; `--only`/zero/failed runs cannot record evidence | `node packages/backend/scripts/run-eval-golden.mjs --self-check` from the correct package context |
| Package gates | No cross-package type/build/playbook regression | `pnpm test`, `pnpm typecheck`, web production build, `node scripts/check-playbooks.mjs` |
| Authenticated browser | Real candidate draft state, no activation control, pinned prompt list/run/fresh thread, honest error/empty states | Phase 21 Playwright spec + owner UAT |
| Live gate | Exact tenant candidate runs full held-out corpus, evidence lands on that row only, owner activates, runtime uses it, rollback restores baseline | one explicitly authorized unfiltered golden run plus read-only evidence/status captures |

### Required isolation matrix

Use two authenticated users A and B plus the owner:

| Operation | A | B | Owner |
|---|---|---|---|
| Publish candidate | writes A candidate | writes B candidate | may author only in owner's own tenant through tenant mutation |
| List own drafts/prompts | sees A only | sees B only | sees owner's tenant only on tenant APIs |
| Review candidate bodies | no global/cross-tenant body access | no global/cross-tenant body access | bounded owner review queue may see exact tenant candidate bodies |
| Activate | absent/refused | absent/refused | exact candidate only; still refused without passing evidence |
| Runtime effective load | A active override then global fallback | B active override then global fallback | owner's own scope |
| Saved prompt id from other tenant | refused/not found with no mutation | refused/not found with no mutation | owner does not bypass tenant CRUD accidentally |

### Anti-vacuity and mutation checks

The following tests must be demonstrated red by a deliberate local mutation, then restored:

1. Remove `tenantId` from a candidate query: A's row becomes visible/effective for B and the isolation test fails.
2. Change the public publisher's inserted status to `active`: candidate-only test fails and the prior active row assertion catches the state change.
3. Drop `authorUserId` or spoof it from args: provenance assertion fails against the authenticated user's real id.
4. Resolve evaluation by name/version without exact candidate scope: two tenants with the same name/version make the test select or certify the wrong row.
5. Record evidence on a filtered run: runner self-check/source assertion fails.
6. Pin evidence to the same name/version but another tenant candidate id: activation remains refused.
7. Remove the effective loader's tenant predicate: a cross-tenant runtime test returns the other tenant's unique adaptation needle.
8. Remove global fallback: a tenant with no active overlay throws instead of loading the existing global skill.
9. Remove the initial archived baseline/rollback target: first-customization rollback test cannot restore the prior effective body.
10. Replace `useSendCockpitMessage` with a raw action or pass the active `threadId` during Run: static/UI test fails; the successful run must produce a different thread id and preserve clock injection.
11. Remove saved-prompt tenant ownership from delete: B can delete A's row and the two-user test fails.
12. Put authored/prompt text in audit payload: a high-entropy needle scan finds it in audit/dead-letter/telemetry.

Zero-count assertions must be paired with a positive harness witness. For example, "B sees zero A prompts" must run alongside "A sees exactly the inserted prompt"; "no activation" must assert the candidate exists and the prior effective active version is unchanged; "no evidence on filtered eval" must prove the filtered run executed cases.

### Live/UAT acceptance

The final live checkpoint should require explicit authorization before model spend. A credible pass records:

- A user publishes one candidate and the UI reports candidate/awaiting-eval; the prior effective version remains live.
- Another tenant cannot read the candidate, its authored body, or its saved prompts.
- One full unfiltered golden run executes the exact candidate body against a throwaway eval tenant and records refs/counts-only evidence on that candidate only.
- Owner activation is refused before evidence and succeeds after evidence; no user-facing Activate control exists.
- A real cockpit turn in the author tenant reports/records the tenant skill version; another tenant still uses the global or its own version.
- Owner rollback restores the immutable baseline without eval and without changing global/other-tenant rows.
- A user pins a real prior user message, reloads, sees it, presses Run, receives a new thread, and the ordinary cockpit/activity/plan path runs. Deleting the saved prompt does not delete either chat thread.
- Responsive keyboard/focus, loading, empty, pending-eval, error and busy states are visually checked. Copy must say what happened, not imply evaluation or activation occurred.

### Definition of done

SKILL-01 can be marked complete only when tenant isolation, user provenance, candidate-only publication, exact full-eval evidence, owner activation, effective runtime loading, rollback, and the saved-prompt fresh-thread path are all proven. A form that merely inserts a candidate, a green unit suite without effective runtime use, or a saved text box that only repopulates the composer is insufficient.
