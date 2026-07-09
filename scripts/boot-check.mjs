#!/usr/bin/env node
// Scripted half of the clean-clone boot gate (Success Criterion 1):
//   install -> convex codegen -> typecheck, exiting non-zero on any failure.
//
// NOTE: `convex codegen` requires a configured deployment (CONVEX_DEPLOYMENT in
// packages/backend/.env.local). On a truly fresh clone, run `npx convex dev` once
// FIRST (see README) to create the deployment; the manual verbatim-README run is a
// separate Manual-Only verification.

import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = resolve(root, "packages/backend");

function run(cmd, cwd = root) {
  console.log(`\n> ${cmd}${cwd !== root ? `  (in ${cwd})` : ""}`);
  execSync(cmd, { stdio: "inherit", cwd, shell: true });
}

try {
  run("pnpm install");
  run("npx convex codegen", backend);
  run("pnpm run typecheck");
  console.log("\nboot-check PASS (install -> codegen -> typecheck)");
} catch {
  console.error("\nboot-check FAIL");
  process.exit(1);
}
