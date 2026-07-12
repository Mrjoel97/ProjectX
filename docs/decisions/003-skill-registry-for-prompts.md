# ADR-003: All LLM prompts live in a versioned skills registry, never in source

- **Status**: Accepted (owner mandate 2026-07-09; registry live since Phase 1 with 3 skills)
- **Recorded**: 2026-07-12 (backfilled from CLAUDE.md §5, `.planning/phases/01-foundation-governance-substrate/01-04-SUMMARY.md`, `packages/backend/convex/skills.ts`)

## Context

Prompts are the highest-churn "code" in an agentic product, and Phase 8 mandates an
autonomous prompt-optimization loop (SkillOpt) that must be able to propose, evaluate,
activate, and roll back prompt versions without code deploys. Hardcoded prompts make
every prompt change a deploy, make rollback a revert, and leave telemetry unable to
say *which* prompt produced an output.

## Decision

Prompts are versioned rows in a `skills` table (`name`, `version`, `body`, `status`),
loaded at runtime:

- **Immutable per version** — a change is a new row + an atomic status flip (`activateSkill` archives the current active row and activates the target in one mutation). Rollback is the same flip toward a prior version.
- **Active-row-wins selection** — the loader takes the single `active` row per name (not max-version), and **fails closed**: no active row → `NO_ACTIVE_SKILL` throw → the request dead-letters. An agent can never silently run on a missing or default prompt.
- **No hardcoded prompts** is test-enforced: a static scan fails on any >200-char string literal in `convex/`. Canonical bodies are human-editable markdown in `packages/contracts/skills/`, with derived TS constants (drift test-enforced) used only for seeding.
- The active `version` participates in the LLM action-cache key, so activation/rollback automatically invalidates cached outputs.
- Skills are **global** (no `tenantId`) — prompt bodies are product code, not tenant data; tenant isolation applies to the cache and content planes instead.

## Alternatives rejected

- **Prompts as source constants**: every tweak is a deploy; no runtime rollback; no version telemetry; incompatible with an autonomous optimization loop.
- **Prompts in env vars / config files**: unversioned, unauditable, and size-hostile.
- **Fallback default prompt when the registry is empty**: rejected deliberately — silent ungoverned prompts are worse than loud dead-letters.

## Consequences

- Prompt changes flow through the registry with rollback; Phase 8's SkillOpt loop gets its substrate (candidate rows + `activateSkill`) for free.
- **Operational cost**: every fresh deployment MUST seed (`skills:seedSkills` / `npm run seed`) or all requests dead-letter. The dev script auto-seeds; production seeding is an explicit post-deploy step.
- No production write path for candidate (v2+) rows exists yet — creating one is Phase 8 scope; until then prompt edits are a seed-code change for v1 bodies.
- See `docs/playbooks/skill-registry.md` for procedures.
