// Assert that the production CLI selects the reviewed root link, then independently read the
// provider's current project settings before build. Never print the Vercel token or API body.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedProjectId = "prj_WmCtlmOX0ZsIxusuSc6Zwad3otN0";
const expectedOrgId = "team_A2KUgi8LeCYzoSNiQNKhy2CQ";
const expectedProjectName = "pikar-ai-convex";
const expectedRootDirectory = "apps/web";

export function productionProjectRefusal(project, configuredId, configuredOrgId) {
  if (!project || typeof project !== "object") return "project_readback_missing";
  if (!configuredId || !configuredOrgId) return "project_configuration_missing";
  if (configuredOrgId !== expectedOrgId) return "wrong_configured_organization";
  if (configuredId !== expectedProjectId || project.projectId !== expectedProjectId)
    return "wrong_project_id";
  if (project.orgId !== configuredOrgId) return "wrong_organization";
  if (project.projectName !== expectedProjectName) return "wrong_project_name";
  if (project.settings?.rootDirectory !== expectedRootDirectory) return "wrong_root_directory";
  return null;
}

export function providerProjectRefusal(project, configuredId, configuredOrgId) {
  if (!project || typeof project !== "object") return "provider_readback_missing";
  if (configuredOrgId !== expectedOrgId) return "wrong_configured_organization";
  if (project.id !== configuredId || project.id !== expectedProjectId)
    return "provider_wrong_project_id";
  if (project.accountId !== configuredOrgId) return "provider_wrong_organization";
  if (project.name !== expectedProjectName) return "provider_wrong_project_name";
  if (project.rootDirectory !== expectedRootDirectory) return "provider_wrong_root_directory";
  return null;
}

export async function readProviderProject(fetcher, token, configuredId, configuredOrgId) {
  if (!token) return "provider_token_missing";
  if (
    !configuredId ||
    !configuredOrgId ||
    configuredId !== expectedProjectId ||
    configuredOrgId !== expectedOrgId
  )
    return "project_configuration_missing";
  const url = new URL(`https://api.vercel.com/v9/projects/${expectedProjectId}`);
  url.searchParams.set("teamId", configuredOrgId);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return "provider_readback_failed";
    return providerProjectRefusal(await response.json(), configuredId, configuredOrgId);
  } catch {
    return "provider_readback_failed";
  }
}

function workflowGuarded(source) {
  const pull = source.indexOf("- name: Pull Vercel production settings");
  const identity = source.indexOf("- name: Verify production Vercel project identity");
  const invocation = source.indexOf("node scripts/check-production-vercel-project.mjs");
  const build = source.indexOf("- name: Build staged Vercel production artifact");
  return pull >= 0 && pull < identity && identity < invocation && invocation < build;
}

async function selfTest() {
  const valid = {
    projectId: expectedProjectId,
    orgId: expectedOrgId,
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
      productionProjectRefusal(valid, expectedProjectId, "other") ===
        "wrong_configured_organization",
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
  const provider = {
    id: expectedProjectId,
    accountId: valid.orgId,
    name: expectedProjectName,
    rootDirectory: expectedRootDirectory,
  };
  const response = (body, ok = true) => ({ ok, json: async () => body });
  let request;
  const goodFetch = async (url, options) => {
    request = { url: String(url), options };
    return response(provider);
  };
  cases.push([
    "provider readback accepted",
    (await readProviderProject(goodFetch, "synthetic-token", expectedProjectId, valid.orgId)) ===
      null,
  ]);
  cases.push([
    "exact read-only scoped API request",
    request?.url ===
      `https://api.vercel.com/v9/projects/${expectedProjectId}?teamId=${encodeURIComponent(valid.orgId)}` &&
      request.options.method === "GET" &&
      request.options.redirect === "error" &&
      request.options.headers.Authorization === "Bearer synthetic-token",
  ]);
  cases.push([
    "provider wrong project refused",
    providerProjectRefusal({ ...provider, id: web.projectId }, expectedProjectId, valid.orgId) ===
      "provider_wrong_project_id",
  ]);
  cases.push([
    "provider wrong team refused",
    providerProjectRefusal({ ...provider, accountId: "other" }, expectedProjectId, valid.orgId) ===
      "provider_wrong_organization",
  ]);
  cases.push([
    "provider wrong name refused",
    providerProjectRefusal({ ...provider, name: "web" }, expectedProjectId, valid.orgId) ===
      "provider_wrong_project_name",
  ]);
  cases.push([
    "provider wrong root refused",
    providerProjectRefusal({ ...provider, rootDirectory: "" }, expectedProjectId, valid.orgId) ===
      "provider_wrong_root_directory",
  ]);
  cases.push([
    "provider HTTP failure refused",
    (await readProviderProject(
      async () => response(provider, false),
      "synthetic-token",
      expectedProjectId,
      valid.orgId,
    )) === "provider_readback_failed",
  ]);
  cases.push([
    "provider network failure refused",
    (await readProviderProject(
      async () => {
        throw new Error("synthetic network error");
      },
      "synthetic-token",
      expectedProjectId,
      valid.orgId,
    )) === "provider_readback_failed",
  ]);
  cases.push([
    "missing token refuses before request",
    (await readProviderProject(
      async () => {
        throw new Error("must not fetch");
      },
      "",
      expectedProjectId,
      valid.orgId,
    )) === "provider_token_missing",
  ]);
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

if (argv.length === 3 && argv[2] === "--self-test") exit(await selfTest());
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
if (reason) {
  stdout.write(`REFUSED ${reason}\n`);
  exit(1);
}
const providerReason = await readProviderProject(
  fetch,
  env.VERCEL_TOKEN,
  env.VERCEL_PROJECT_ID,
  env.VERCEL_ORG_ID,
);
stdout.write(
  providerReason ? `REFUSED ${providerReason}\n` : "PASS production Vercel project identity\n",
);
exit(providerReason ? 1 : 0);
