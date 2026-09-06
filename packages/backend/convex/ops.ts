// Owner-only hosted-readiness surface (25-10).
//
// This exists so the question "is this deployment actually configured?" has an answer that is not
// "try it and see which feature is broken". It reports NAMES ONLY — a readiness screen that echoed
// a value to prove it was set would be a worse leak than the misconfiguration it reports.
import { isDurableOrigin, missingEnv, ORIGIN_ENV } from "./lib/env";
import { ownerQuery } from "./lib/functions";
import { REGISTRY_SKILL_NAMES } from "./skills";

/**
 * Hosted configuration readiness. OWNER-ONLY.
 *
 * HOW TO RUN THIS FROM THE CLI, because the obvious form does not work and 25-12's plan specified
 * the obvious form:
 *
 *   cd packages/backend && npx convex run --prod ops:envCheck --identity '{"subject":"<ownerUserId>|cli"}'
 *
 * Three things that each break it independently: there is no `convex.json` in this repo, so the CLI
 * resolves the deployment from `packages/backend/.env.local` and MUST run from that directory;
 * without `--prod` it targets the local dev deployment, not the hosted one; and `convex run`
 * invokes with NO identity, so `requireScope` throws UNAUTHENTICATED long before `requireOwner` is
 * reached. The signed-in `/admin` surface is the easier path and needs none of this.
 */
export const envCheck = ownerQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    ready: boolean;
    missingRequired: string[];
    missingFeature: string[];
    fixturesActive: string[];
    nonDurableOrigins: string[];
    unseededSkills: string[];
  }> => {
    const result = missingEnv((name) => process.env[name]);

    // THE REGISTRY IS PART OF "IS THIS DEPLOYMENT CONFIGURED", and until 2026-08-30 nothing asked.
    //
    // §5 puts every agent prompt in the `skills` table and `loadSkill` fails CLOSED on a missing
    // row (`NO_ACTIVE_SKILL`) — deliberately, so a hardcoded prompt can never sneak in. But
    // `seedSkills` is an `internalMutation` an operator has to RUN, and nothing anywhere reported
    // that it had not been. MEASURED on 2026-08-30: Phase 29 shipped `knowledge-query-planner` and
    // `knowledge-synthesizer` into SEEDS, the deployment was never re-seeded, and unified knowledge
    // search was INERT — the browser gate died on `NO_ACTIVE_SKILL` while every unit test passed,
    // because `convex-test` seeds the registry INSIDE each test. A whole feature was dark and the
    // only surface that could have said so did not look.
    //
    // Names only, like every other row on this screen. A body is a prompt, not a readiness signal.
    const unseededSkills: string[] = [];
    for (const name of REGISTRY_SKILL_NAMES) {
      const active = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
        .unique();
      if (active === null) unseededSkills.push(name);
    }
    // ADR-022. A set-but-EPHEMERAL origin is the failure this catches and `missingRequired` cannot:
    // the name is present, so every existing check reads green, while the unsubscribe link in a
    // sent email points at a preview build that stops resolving on the next push.
    const nonDurableOrigins = ORIGIN_ENV.filter(
      (name) => process.env[name]?.trim() && !isDurableOrigin(process.env[name]),
    );
    return {
      // `ready` turns on REQUIRED names AND durable origins AND a seeded registry. A dark feature is
      // a product decision; a missing required name, a URL that will stop resolving, or an agent
      // with no prompt row is a BROKEN deployment, and collapsing those with features would make
      // this screen unactionable. An unseeded skill is not "a feature off" — it is a surface that
      // throws when a user touches it.
      // 36-01 (owner decision, ADR-035): a deployment with ANY fixture seam active is NOT
      // production-ready — a faked provider reads as success everywhere else, so the one screen
      // that knows must say so in the headline, not in a line of text under it.
      ready:
        result.missingRequired.length === 0 &&
        nonDurableOrigins.length === 0 &&
        unseededSkills.length === 0 &&
        result.fixturesActive.length === 0,
      ...result,
      nonDurableOrigins,
      unseededSkills,
    };
  },
});
