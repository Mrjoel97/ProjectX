# Playbook: Skill Registry (versioned LLM prompts)

> Last verified: 2026-07-14 (03.3-01 — added the `document-drafter` skill (5-file mirror: canonical `.md` + derived `documentDrafterSkillBody` + `DOCUMENT_DRAFTER_SKILL` name const + `seedSkills` row + drift `test.each` row). It backs `draftDocument` for attachment generation (CKPT-02). Prior: 03.2.1 gap-closure — `seedSkills` gained a PUBLISH-ON-CHANGE path: an edited skill body is published as a new immutable version + activated, closing the old "no production write path for v2+" gap. Used it to ship a `cockpit-agent` prompt edit (contact resolution is now panel-driven: after `resolveContacts` the agent STOPS and the user picks in the panel; never set a resolved contact via `addRecipients`/`setRecipients`) as v2. Prior: 03.2.1-01)
> Build history: `.planning/phases/01-foundation-governance-substrate/01-04-*.md` · Related ADRs: [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

All agent/LLM prompts live as versioned rows in the `skills` table (`name`, `version`,
`body`, `status`) and are loaded at runtime — never hardcoded in source (CLAUDE.md §5).
A prompt change is a NEW version row plus an atomic status flip, never an in-place
edit. This gives versioning, rollback, and audit-able `{name, version}` telemetry, and
it is the substrate the Phase 8 SkillOpt optimization loop will operate on.

## Key files

- `packages/backend/convex/schema.ts` — `skills` table + `by_name_status`, `by_name_version` indexes
- `packages/backend/convex/skills.ts` — the module: `loadSkill`, `getActiveSkill` (internalQuery), `activateSkill` (internalMutation, the ONE permitted status mutation), `seedSkills` (internalMutation — idempotent for unchanged bodies; PUBLISHES a new version + activates on a body edit)
- `packages/contracts/src/skill.ts` — loader contract, error prefixes, skill-name constants
- `packages/contracts/skills/*.md` — canonical human-editable prompt bodies; `packages/contracts/src/skills/*.ts` — derived bundler-safe constants (drift between the two is test-enforced)
- `packages/backend/convex/llm.ts` — the runtime callers (`route`, `draft`, `draftCockpit` → `getActiveSkill`)
- `packages/backend/scripts/run-seed.mjs` — post-deploy seed runner
- `packages/backend/convex/skills.test.ts` — loader/activation/immutability/no-hardcoded-prompt tests

## Dependencies & blast radius

`graphify query "skills registry"`. Every LLM call site depends on an active skill row
existing — **a fresh deployment without seeding dead-letters every request**
(`NO_ACTIVE_SKILL: executive-router`). Current skills: `executive-agent.classifier`,
`executive-router`, `email-drafter`, `cockpit-agent`, `document-drafter`. The active row's `version` is part of the LLM
action-cache key, so activation/rollback automatically invalidates cached outputs.

## Data flow

1. **Seed + publish**: `seedSkills` inserts each skill v1/`active` on first run. On re-run it is idempotent when the body is UNCHANGED; when a `.md` edit has changed the derived constant it publishes a NEW version (`maxVersion+1`), archives the old active row, and activates the new one — never mutating a prior row (immutable-per-version). This is how a source prompt edit reaches production: edit the `.md`, regenerate the `.ts` constant, re-run `seedSkills`. Local dev auto-seeds (`convex dev --run skills:seedSkills`); production requires `npm run seed` after `npx convex deploy`.
2. **Load**: `loadSkill(ctx, name)` selects the single row with `status == "active"` for the name (`.unique()` — throws on 0 or >1). Selection is active-row-wins, NOT max-version.
3. **Missing/ambiguous** → throws `NO_ACTIVE_SKILL` → the pipeline dead-letters the request. Fail-closed by design: an agent can never silently run without a governed prompt.
4. **New version**: insert a new row (`status: "candidate"`), then `activateSkill(name, version)` atomically archives the current active row and activates the target, in one mutation.
5. **Rollback**: `activateSkill(name, priorVersion)` — same atomic flip in reverse.

## Invariants — what must never break

- **No hardcoded prompts in source**: enforced by `skills.test.ts`, which scans `convex/*.ts` and fails on any string literal >200 chars. Also enforces `.md` ↔ derived `.ts` body no-drift.
- **Bodies immutable per version**: `activateSkill` only ever patches `status` — never `body`/`name`/`version`. Tested (v1 body unchanged after activating v2).
- **Exactly one active row per name**: `.unique()` on `by_name_status`; loader throws otherwise.
- **Fail-closed loader**: `NO_ACTIVE_SKILL` throw, never a fallback default prompt. Tested in `skills.test.ts` and `cockpitDraft.test.ts` (unseeded `email-drafter`).
- **`activateSkill` is the sole status mutation** — it uses the raw internal builder and sits on the plan-02 allow-list; do not add other writers.
- **Skills are GLOBAL** — the table has no `tenantId` (deliberate; the LLM cache is tenant-namespaced, the prompt body is shared). Don't "fix" this by adding tenancy without an ADR.

## How to change safely

- **Editing a prompt**: edit the canonical `.md` in `packages/contracts/skills/`, regenerate/update the derived `.ts` constant, insert a NEW version row, `activateSkill` to it. Never edit an existing row's body — the immutability test will not catch a direct DB edit, only discipline does.
- **Adding a skill**: add the `.md` + derived constant + name constant in `contracts/src/skill.ts`, extend `seedSkills`, seed the deployment.
- **Rollback of a bad prompt**: `npx convex run skills:activateSkill '{"name":"<name>","version":<prior>}'` — cache invalidation is automatic via the version-keyed cache.
- **Do not bump** the pinned agent/workflow component versions as part of skill work (CLAUDE.md §6).

## How to verify

- `pnpm --filter @pikar/backend test` (or `vitest run skills`) — seed+load, fail-closed throw, idempotent seed, atomic flip + immutability, md/ts no-drift, no long inline literals
- Seed check: `npm run seed` in `packages/backend` (calls `seedSkills` then asserts `executive-router` is active)

## Operational notes

- **Fresh deploy checklist**: `npx convex deploy` → `npm run seed`. Skipping the seed dead-letters everything.
- Skill names are hyphenated (`executive-router`); `executive_router` silently fails to match.
- `run-seed.mjs` judges success by CLI *output*, not exit code — the convex CLI returns a bogus non-zero exit on Windows/Node 24.
- Rollback is CLI-only today; there is no admin UI.

## Known gaps & deferred work

- **Source prompt edits publish via `seedSkills`** (a changed body → new version + activate; added 03.2.1). Phase 8 (SkillOpt) remains the designated owner of the *automated* candidate→eval→activate loop; `seedSkills` covers the manual source-edit→publish path (edit `.md` → regenerate `.ts` → re-seed).
- The `rolled_back` status literal exists in the schema but is never written — rollback produces `archived`. Either SkillOpt will use it or it should be removed then.
