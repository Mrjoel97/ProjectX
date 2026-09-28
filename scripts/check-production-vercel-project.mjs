// Assert that vercel pull selected the reviewed root-linked production project, not apps/web's
// separate "web" link. The normal mode reads only .vercel/project.json and nonsecret IDs.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedProjectId = "prj_WmCtlmOX0ZsIxusuSc6Zwad3otN0";
const expectedProjectName = "pikar-ai-convex";
const expectedRootDirectory = "apps/web";

export function productionProjectRefusal(project, configuredId, configuredOrgId) {
  if (!project || typeof project !== "object") return "project_readback_missing";
  if (!configuredId || !configuredOrgId) return "project_configuration_missing";
  if (configuredId !== expectedProjectId || project.projectId !== expectedProjectId)
    return "wrong_project_id";
  if (project.orgId !== configuredOrgId) return "wrong_organization";
  if (project.projectName !== expectedProjectName) return "wrong_project_name";
  if (project.settings?.rootDirectory !== expectedRootDirectory) return "wrong_root_directory";
  return null;
}

function workflowGuarded(source) {
  const pull = source.indexOf("- name: Pull Vercel production settings");
  const identity = source.indexOf("- name: Verify production Vercel project identity");
  const invocation = source.indexOf("node scripts/check-production-vercel-project.mjs");
  const build = source.indexOf("- name: Build staged Vercel production artifact");
  return pull >= 0 && pull < identity && identity < invocation && invocation < build;
}

function selfTest() {
  const valid = {
    projectId: expectedProjectId,
    orgId: "team:synthetic",
    projectName: expectedProjectName,
    settings: { rootDirectory: expectedRootDirectory },
  };
  const web = { ...valid, projectId: "prj_u67QlCM8f4epmkVwg8Z2x3klrp17", projectName: "web" };
  const cases = [
    [
      "root project accepted",
      productionProjectRefusal(valid, expectedProjectId, valid.orgId) === null,
    ],
    [
      "apps/web project refused",
      productionProjectRefusal(web, web.projectId, web.orgId) === "wrong_project_id",
    ],
    [
      "wrong configured ID refused",
      productionProjectRefusal(valid, web.projectId, valid.orgId) === "wrong_project_id",
    ],
    [
      "wrong organization refused",
      productionProjectRefusal(valid, expectedProjectId, "other") === "wrong_organization",
    ],
    [
      "wrong name refused",
      productionProjectRefusal({ ...valid, projectName: "web" }, expectedProjectId, valid.orgId) ===
        "wrong_project_name",
    ],
    [
      "wrong root refused",
      productionProjectRefusal(
        { ...valid, settings: { rootDirectory: "" } },
        expectedProjectId,
        valid.orgId,
      ) === "wrong_root_directory",
    ],
    [
      "missing readback refused",
      productionProjectRefusal(null, expectedProjectId, valid.orgId) === "project_readback_missing",
    ],
  ];
  const source = readFileSync(resolve(root, ".github/workflows/deploy-production.yml"), "utf8");
  cases.push(["pull-to-build placement", workflowGuarded(source)]);
  cases.push([
    "removed check refused",
    !workflowGuarded(
      source.replace("node scripts/check-production-vercel-project.mjs", "echo missing"),
    ),
  ]);
  for (const [name, ok] of cases) stdout.write(`${ok ? "OK" : "FAIL"} ${name}\n`);
  return cases.every(([, ok]) => ok) ? 0 : 1;
}

if (argv.length === 3 && argv[2] === "--self-test") exit(selfTest());
if (argv.length !== 2) {
  stdout.write("REFUSED invalid project-check invocation\n");
  exit(1);
}
let project;
try {
  project = JSON.parse(readFileSync(resolve(root, ".vercel/project.json"), "utf8"));
} catch {
  stdout.write("REFUSED project_readback_missing\n");
  exit(1);
}
const reason = productionProjectRefusal(project, env.VERCEL_PROJECT_ID, env.VERCEL_ORG_ID);
stdout.write(reason ? `REFUSED ${reason}\n` : "PASS production Vercel project identity\n");
exit(reason ? 1 : 0);
