// Seed the agent skill registry so the pipeline can loadSkill(...) at runtime.
// WITHOUT this, a fresh/production deployment dead-letters EVERY request with
// NO_ACTIVE_SKILL: executive-router (routing fails closed — skills.ts:loadSkill).
//
// skills.seedSkills is idempotent (skips names that already exist), so this is safe
// to run on every deploy/boot. Local `convex dev --run skills:seedSkills` covers the
// dev deployment; production deploys must run this AFTER `npx convex deploy`.
//
// Reuses smokeRun.must — judges success by the CLI's OUTPUT, since the convex CLI
// returns a bogus non-zero exit on Windows/Node24 even when the function ran fine.
import { must } from "./smokeRun.mjs";

console.log("[seed] seeding agent skills (executive-router, email-drafter, classifier)...");
must("skills:seedSkills", {});

console.log("[seed] verifying executive-router is active...");
const out = must("skills:getActiveSkill", { name: "executive-router" });
if (!/"version"/.test(out)) {
  throw new Error(`[seed] executive-router not active after seed:\n${out}`);
}

console.log("[seed] PASSED — agent skills active");
