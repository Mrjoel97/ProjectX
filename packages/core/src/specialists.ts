// The dispatchable-specialist registry (DISP-01). Pure TS, Convex-free (CLAUDE.md §1) —
// the dispatcher in convex/dispatch.ts is the thin adapter that consumes it.
//
// Wave 0 (15-01) ships the TYPES and the fail-closed lookup with the registry DELIBERATELY
// EMPTY. That is not a placeholder: "the specialist-route lookup fails closed to unknown_route
// with no specialists registered yet" is the seam every lane depends on, and it is provable
// today. 15-02 fills SPECIALISTS.

/** The closed set of dispatchable specialist routes. EMPTY at Wave 0 — 15-02 registers the three. */
export const SPECIALIST_ROUTES = [] as const satisfies readonly string[];
export type SpecialistRoute = (typeof SPECIALIST_ROUTES)[number];

/** A specialist is a (skill body, tool-set) pair — the body is a registry row (§5, versioned
 *  and rollback-able), the tool-set is a CAPABILITY grant and therefore code-owned, never
 *  DB-writable. A row that could widen its own tools would be a privilege-escalation path. */
export type SpecialistSpec = {
  readonly skillName: string;
  readonly tools: readonly string[];
  /** the closed agentSteps.tool literal this specialist's trace step writes */
  readonly stepTool: "dispatchOfferArchitect" | "dispatchMoneyModelDesigner" | "dispatchLeadEngine";
};

export const SPECIALISTS: Readonly<Record<SpecialistRoute, SpecialistSpec>> = {};

export type ResolvedSpecialist =
  | { ok: true; route: SpecialistRoute; spec: SpecialistSpec }
  | { ok: false; reason: "unknown_route" };

/**
 * Fail-closed lookup — mirrors parseRouting (packages/contracts/src/routing.ts). There is
 * deliberately NO default specialist: "a route the system cannot validate is a route it must
 * not take". `gap.route` persists as v.string() (schema.ts), including the deliberate "" that
 * diagnose() emits on its not-enough-data ask branch, so rows predating the union reach here
 * un-narrowed — the RUNTIME branch is load-bearing and the type is not sufficient on its own.
 *
 * hasOwnProperty, not `SPECIALISTS[route]`: a bare index signature resolves "__proto__" and
 * "constructor" to Object.prototype members, which are truthy, so a truthiness guard would
 * happily "route" on them.
 *
 * Returns a discriminated result and NEVER throws — a governed stop returns, only bugs throw.
 */
export function resolveSpecialist(route: string): ResolvedSpecialist {
  if (!Object.prototype.hasOwnProperty.call(SPECIALISTS, route)) {
    return { ok: false, reason: "unknown_route" };
  }
  const known = route as SpecialistRoute;
  return { ok: true, route: known, spec: SPECIALISTS[known] };
}
