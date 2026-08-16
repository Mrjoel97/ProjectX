// Owner-only hosted-readiness surface (25-10).
//
// This exists so the question "is this deployment actually configured?" has an answer that is not
// "try it and see which feature is broken". It reports NAMES ONLY — a readiness screen that echoed
// a value to prove it was set would be a worse leak than the misconfiguration it reports.
import { missingEnv } from "./lib/env";
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
  }> => {
    const result = missingEnv((name) => process.env[name]);
    return {
      // `ready` turns on REQUIRED only. A dark feature is a product decision; a missing required
      // name is a broken deployment, and collapsing the two would make this screen unactionable.
      ready: result.missingRequired.length === 0,
      ...result,
    };
  },
});
