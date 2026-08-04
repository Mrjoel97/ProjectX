// Executive Agent routing-decision contract (AGNT-01/02/03).
//
// AGNT-03's guarantee — "never a silent default" — lives HERE, in the type
// system: an unknown/absent route is a parse FAILURE surfaced as a discriminated
// result, never a defaulted route. The pipeline (02-06) dead-letters on
// `unknown_route` rather than guessing a path.

import { z } from "zod";

/** The three routes the Executive Agent may choose. `sub_agent` is a valid
 * enum member but unimplemented downstream in Phase 2. */
export const routingSchema = z.object({
  route: z.enum(["direct_llm", "direct_tool", "sub_agent"]),
  // AGNT-02: a model-generated step plan. At least one step — an empty plan is
  // not a plan.
  steps: z.array(z.object({ n: z.number(), description: z.string() })).min(1),
  // Refs/ids only — safe to record in audit (CLAUDE.md §4). Not enforced here.
  rationale: z.string(),
});

/** Inferred routing decision shape. */
export type RoutingDecision = z.infer<typeof routingSchema>;

/** Discriminated parse result. On failure the reason is a distinct
 * `unknown_route` so the caller dead-letters deterministically (AGNT-03). */
export type ParseRoutingResult =
  | { ok: true; value: RoutingDecision }
  | { ok: false; reason: "unknown_route" };

/**
 * Parse an untrusted model object into a RoutingDecision. Any failure —
 * unknown route, missing/empty steps, malformed shape — collapses to
 * `{ ok: false, reason: "unknown_route" }`. There is deliberately NO default
 * route: a route the system cannot validate is a route it must not take.
 */
export function parseRouting(value: unknown): ParseRoutingResult {
  const result = routingSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, reason: "unknown_route" };
}
