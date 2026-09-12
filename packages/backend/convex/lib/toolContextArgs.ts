// The pins every agent door must ACCEPT and FORWARD — declared once, spread into each door's `args`
// (`runCockpitAgent` in llm.ts, `dispatchArgs` in dispatch.ts). In Convex the `args` validator is
// the runtime contract: an extra field is refused BEFORE the handler runs. That is the 21-03
// incident — `tenantSkillIds` was declared on the internal loop's type but missing from
// `runCockpitAgent.args`, so golden run `6e021dce` died 0/41 at the door with
// `ArgumentValidationError: extra field tenantSkillIds`, having never called a model. A field added
// HERE appears at every door; a field added to one door by hand is the defect again.
//
//   skillVersions — EVAL-01: the eval runner's GLOBAL pins, name → `<name>@<n>`. A missing
//     (name, version) FAILS CLOSED (getSkillVersion throws), never silently falls back to active.
//   tenantSkillIds — 21-03 (SKILL-01): the harness's EXACT tenant-candidate pins, name →
//     `tenantSkills` row id. `v.id("tenantSkills")`, never a string — the validator itself refuses
//     anything that is not a real row id of that table. Deliberately NOT a body or a registry
//     tenant: the only thing a caller may name is WHICH ROW, and even that arrives on an
//     internalAction (ADR-008). Absent on the production paths, which run the effective row.
//
// Both are internal-only surfaces (internalActions), so the model can never supply them (§2-D).

import { v } from "convex/values";

export const TOOL_CONTEXT_ARGS = {
  // Trusted evaluation envelope, never a model tool parameter or public client argument.
  // Every paid descendant shares this same ledger row; a child must never mint a new cap.
  evalBudgetId: v.optional(v.id("spendEvents")),
  skillVersions: v.optional(v.record(v.string(), v.number())),
  tenantSkillIds: v.optional(v.record(v.string(), v.id("tenantSkills"))),
};
