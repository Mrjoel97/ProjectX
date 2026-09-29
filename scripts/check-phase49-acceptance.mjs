// Source-anchored Phase 49 capability guard. It can disprove a repository claim, never prove
// provider approval, legal registration, merchant readiness or production founder acceptance.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  provenance: "scripts/verify-design-knowledge-provenance.mjs",
  compiler: "scripts/compile-design-knowledge.mjs",
  manifest: "third_party/design-knowledge/manifest.json",
  knowledge: "packages/core/src/designKnowledge.ts",
  recipes: "packages/core/src/webRecipes.ts",
  registry: "packages/backend/convex/skills.ts",
  server: "packages/backend/convex/webRecipes.ts",
  projects: "packages/backend/convex/webProjects.ts",
  http: "packages/backend/convex/http.ts",
  tenant: "apps/web/app/(app)/dashboard/sites/WebRecipeForm.tsx",
  owner: "apps/web/app/(app)/ops/WebRecipeQualification.tsx",
  evaluator: "packages/backend/scripts/run-web-recipe-evals.mjs",
  browser: "apps/web/e2e/phase49-recipe-qualification.spec.ts",
  integrated: "apps/web/e2e/phase49-web-recipes.spec.ts",
  release: "docs/releases/phase-49-wave7-wave8-reentry.md",
  roadmap: ".planning/ROADMAP.md",
  requirements: ".planning/REQUIREMENTS.md",
};
const source = () =>
  Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [key, readFileSync(resolve(root, path), "utf8")]),
  );
const has = (body, pattern) => pattern.test(body);

export function violations(s) {
  const problems = [];
  const requireMatch = (key, pattern, reason) => {
    if (!has(s[key], pattern)) problems.push(`${key}: ${reason}`);
  };
  const forbidMatch = (key, pattern, reason) => {
    if (has(s[key], pattern)) problems.push(`${key}: ${reason}`);
  };
  requireMatch(
    "manifest",
    /ui-ux-pro-max-skill[\s\S]*taste-skill[\s\S]*eCommerce-Skills/i,
    "three pinned source roles missing",
  );
  requireMatch("manifest", /MIT/i, "source license identity missing");
  requireMatch("provenance", /--self-test/, "provenance positive controls missing");
  requireMatch("provenance", /sha256|createHash/, "source hashes missing");
  requireMatch("compiler", /--check/, "offline compiler check missing");
  for (const key of ["knowledge", "recipes"]) {
    forbidMatch(
      key,
      /\b(?:fetch|eval|new Function|child_process|execSync|spawnSync|https?\.request)\s*\(/,
      "runtime upstream network execution path",
    );
  }
  requireMatch("recipes", /WEB_RECIPE_DEFINITIONS/, "closed recipe definitions missing");
  requireMatch(
    "server",
    /hasValidWebRecipeProvenance\([\s\S]*?hasPassingWebRecipeEvidence\([\s\S]*?hasPassingWebRecipeBrowserEvidence\(/,
    "provenance/evaluator/browser conjunction missing",
  );
  requireMatch(
    "server",
    /export const commerceContractReady = \(\): false => false;/,
    "code-owned storefront false seam missing",
  );
  requireMatch(
    "server",
    /args\.recipeId === "storefront-catalogue"\) throw new Error\("COMMERCE_UNAVAILABLE"\)/,
    "tenant storefront mutation refusal missing",
  );
  requireMatch(
    "server",
    /ownerMutation\([\s\S]*?createStorefrontQualification = qualifyStorefront/,
    "owner-only private storefront path missing",
  );
  requireMatch(
    "server",
    /if \(definition\.outputKind === "storefront"\) continue;/,
    "tenant storefront discovery exclusion missing",
  );
  forbidMatch(
    "server",
    /commerceContractReady\s*=\s*\([^)]*\)\s*=>\s*(?:process\.env|ctx\.db|args\.|true)/,
    "client/env/db storefront readiness",
  );
  requireMatch(
    "projects",
    /project\.kind === "storefront"\) return fail\("unavailable", "COMMERCE_UNAVAILABLE"\)/,
    "storefront publish/update/rollback refusal missing",
  );
  requireMatch(
    "projects",
    /project\.kind === "storefront"\)[\s\S]*?COMMERCE_UNAVAILABLE/,
    "storefront unpublish refusal missing",
  );
  requireMatch(
    "projects",
    /project\.kind === "storefront" \|\| !runtimeReady\(project\)/,
    "malformed pointer resolver refusal missing",
  );
  requireMatch(
    "http",
    /resolved\.project\.kind === "storefront"/,
    "anonymous storefront HTTP refusal missing",
  );
  requireMatch(
    "tenant",
    /recipes\?\.find\([\s\S]*?selectedId/,
    "tenant choices not server-derived",
  );
  forbidMatch(
    "tenant",
    /\b(?:storefront-catalogue|cart|checkout|payment|merchant|inventory|order|tax|shipping|refund|fulfilment)\b/i,
    "tenant commerce control or discovery present",
  );
  requireMatch("owner", /Commerce unavailable/, "owner private qualification limit missing");
  requireMatch("evaluator", /--self-check/, "deterministic evaluator self-check missing");
  requireMatch("browser", /recordWebRecipeBrowserEvidence/, "trusted browser witness missing");
  requireMatch(
    "integrated",
    /phase49-web-recipes|integrated site, landing and private storefront/,
    "integrated lifecycle matrix missing",
  );
  for (const key of ["release", "roadmap", "requirements"]) {
    forbidMatch(
      key,
      /(?:legal entity|registration|custom domain|dns|tls|hosting|provider|merchant|payment|tax|shipping|wave 8|production founder acceptance)\s+(?:is |has been )?(?:complete|completed|approved|verified|accepted|ready|enabled|registered|formed)\b/i,
      "external overclaim",
    );
  }
  requireMatch(
    "release",
    /pikar-ai[\s\S]*provisional/i,
    "provisional registered-name boundary missing",
  );
  requireMatch("release", /Phase 50/, "commerce dependency missing");
  return problems;
}

function selfTest() {
  const actual = source();
  const mutations = [
    [
      "server",
      (v) => v.replace("hasPassingWebRecipeBrowserEvidence(row.browserEvidence, identity)", "true"),
      "conjunction",
    ],
    [
      "server",
      (v) =>
        v.replace(
          "export const commerceContractReady = (): false => false;",
          "export const commerceContractReady = () => true;",
        ),
      "storefront false seam",
    ],
    [
      "projects",
      (v) =>
        v.replace(
          'project.kind === "storefront" || !runtimeReady(project)',
          "!runtimeReady(project)",
        ),
      "resolver",
    ],
    ["tenant", (v) => `${v}\nconst cart = 'checkout';`, "tenant commerce"],
    ["release", (v) => `${v}\nThe legal entity is registered.`, "external overclaim"],
    ["recipes", (v) => `${v}\nfetch('https://upstream.example');`, "upstream network"],
  ];
  let bad = violations(actual).length;
  for (const [key, mutate, label] of mutations) {
    const changed = { ...actual, [key]: mutate(actual[key]) };
    if (
      changed[key] === actual[key] ||
      !violations(changed).some((problem) => problem.includes(label))
    ) {
      bad += 1;
      stdout.write(`positive control failed: ${label}\n`);
    }
  }
  stdout.write(
    bad
      ? `Phase 49 claim-guard self-test FAILED (${bad}).\n`
      : "Phase 49 claim-guard self-test PASSED.\n",
  );
  return bad ? 1 : 0;
}

if (argv.includes("--self-test")) exit(selfTest());
let problems;
try {
  problems = violations(source());
} catch (error) {
  problems = [error instanceof Error ? error.message : String(error)];
}
for (const problem of problems) stdout.write(`Phase 49 claim guard: ${problem}\n`);
stdout.write(
  problems.length
    ? `Phase 49 claim guard FAILED (${problems.length}).\n`
    : "Phase 49 claim guard green for repository/local boundaries.\n",
);
exit(problems.length ? 1 : 0);
