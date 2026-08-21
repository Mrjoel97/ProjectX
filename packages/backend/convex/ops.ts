// Owner-only hosted-readiness surface (25-10).
//
// This exists so the question "is this deployment actually configured?" has an answer that is not
// "try it and see which feature is broken". It reports NAMES ONLY — a readiness screen that echoed
// a value to prove it was set would be a worse leak than the misconfiguration it reports.
import { isDurableOrigin, missingEnv, ORIGIN_ENV } from "./lib/env";
import { ownerQuery } from "./lib/functions";

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
  handler: async (): Promise<{
    ready: boolean;
    missingRequired: string[];
    missingFeature: string[];
    fixturesActive: string[];
    nonDurableOrigins: string[];
  }> => {
    const result = missingEnv((name) => process.env[name]);
    // ADR-022. A set-but-EPHEMERAL origin is the failure this catches and `missingRequired` cannot:
    // the name is present, so every existing check reads green, while the unsubscribe link in a
    // sent email points at a preview build that stops resolving on the next push.
    const nonDurableOrigins = ORIGIN_ENV.filter(
      (name) => process.env[name]?.trim() && !isDurableOrigin(process.env[name]),
    );
    return {
      // `ready` turns on REQUIRED names AND durable origins. A dark feature is a product decision;
      // a missing required name or a URL that will stop resolving is a broken deployment, and
      // collapsing those with features would make this screen unactionable.
      ready: result.missingRequired.length === 0 && nonDurableOrigins.length === 0,
      ...result,
      nonDurableOrigins,
    };
  },
});
