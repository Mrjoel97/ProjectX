import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { api, internal } from "@pikar/backend/api";
import {
  WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
  WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
  WEB_RECIPE_BROWSER_RUNNER,
  WEB_RECIPE_REQUIRED_VIEWPORTS,
} from "@pikar/contracts/skill";
import { WEB_RECIPE_BUNDLE_HASH } from "@pikar/core";
import { expect, type Page, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

test.describe.configure({ mode: "serial", retries: 0 });
test.setTimeout(900_000);
const names = [
  "web-recipe-business-site",
  "web-recipe-campaign-landing",
  "web-recipe-storefront-catalogue",
] as const;
const skills = (internal as unknown as { skills: Record<string, unknown> }).skills;
const ownerRefs = (internal as unknown as { owner: Record<string, unknown> }).owner;
const inviteRefs = (internal as unknown as { invites: Record<string, unknown> }).invites;
const onboardingRefs = (internal as unknown as { onboarding: Record<string, unknown> }).onboarding;
type Inspection = {
  name: string;
  present: boolean;
  skillId?: string;
  version?: number;
  status?: string;
  bodyHash?: string;
  definitionHash?: string;
  versionCount?: number;
  browserRun?: {
    runId: string;
    revision: number;
    transcriptHash: string | null;
    lanes: Array<{ viewport: string; outcomes: string[] }>;
  } | null;
};
type Candidate = Required<
  Pick<Inspection, "name" | "skillId" | "version" | "bodyHash" | "definitionHash">
>;
type Version = {
  contentHash: string;
  artifactHtml: string;
  rendererVersion: string;
  recipeRef: {
    name: string;
    version: number;
    skillId: string;
    bodyHash: string;
    rendererVersion: string;
  };
};

function loopbackOrigin(value: string, label: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${label} must be an exact 127.0.0.1 HTTP origin`);
  return url;
}

function fixtureClient(): { client: ConvexHttpClient; backend: URL; site: URL; app: URL } {
  if (
    process.env.PIKAR_PHASE49_QUALIFICATION !== "1" ||
    process.env.PIKAR_PHASE49_DISPOSABLE !== "1"
  )
    throw new Error("Phase 49 qualification requires explicit disposable-mode flags");
  const configPath = process.env.PIKAR_PHASE49_FIXTURE_CONFIG;
  const disposableRoot = process.env.PIKAR_PHASE49_DISPOSABLE_ROOT;
  if (!configPath || !disposableRoot || !isAbsolute(configPath) || !isAbsolute(disposableRoot))
    throw new Error("Phase 49 requires an absolute fresh fixture config and disposable root");
  const root = resolve(disposableRoot);
  const config = resolve(configPath);
  const rel = relative(root, config);
  if (
    !rel ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    /[\\/]\.convex[\\/]local[\\/]default[\\/]/i.test(config)
  )
    throw new Error("Phase 49 config must live inside the selected disposable root");
  const parsed = JSON.parse(readFileSync(config, "utf8")) as {
    adminKey?: string;
    ports?: { cloud?: number; site?: number };
  };
  if (
    !parsed.adminKey ||
    !Number.isInteger(parsed.ports?.cloud) ||
    !Number.isInteger(parsed.ports?.site)
  )
    throw new Error("Phase 49 selected config lacks local admin access");
  const backend = loopbackOrigin(process.env.PIKAR_PHASE49_BACKEND_URL ?? "", "backend");
  const app = loopbackOrigin(process.env.PIKAR_E2E_BASE_URL ?? "", "app");
  const site = loopbackOrigin(`http://127.0.0.1:${parsed.ports!.site}`, "site");
  if (
    backend.port !== String(parsed.ports!.cloud) ||
    backend.origin === app.origin ||
    site.origin === backend.origin ||
    site.origin === app.origin
  )
    throw new Error("Phase 49 config, backend, and app origins disagree");
  const client = new ConvexHttpClient(backend.origin);
  (client as ConvexHttpClient & { setAdminAuth(value: string): void }).setAdminAuth(
    parsed.adminKey,
  );
  return { client, backend, site, app };
}

const call = async <T>(
  client: ConvexHttpClient,
  reference: unknown,
  args: unknown,
  kind: "mutation" | "query" = "mutation",
) =>
  (kind === "mutation"
    ? client.mutation(reference as FunctionReference<"mutation">, args as never)
    : client.query(reference as FunctionReference<"query">, args as never)) as Promise<T>;
const inspect = (client: ConvexHttpClient) =>
  call<Inspection[]>(client, skills.inspectWebRecipeCandidates, {}, "query");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const candidateFor = (rows: Inspection[], name: string, version: number): Candidate => {
  const row = rows.find((item) => item.name === name);
  if (
    !row?.present ||
    row.version !== version ||
    !row.skillId ||
    !row.bodyHash ||
    !row.definitionHash
  )
    throw new Error(`exact ${name} v${version} candidate missing`);
  return row as Candidate;
};

async function assertEmbeddedBackend(page: Page, app: URL, backend: URL) {
  const sockets: URL[] = [];
  page.on("websocket", (socket) => sockets.push(new URL(socket.url())));
  await page.goto("/signin");
  expect(new URL(page.url()).origin).toBe(app.origin);
  // Signup's invite preflight mounts a live Convex subscription before any owner is provisioned.
  await page.goto("/signup?invite=PHASE49-INVALID-PREFLIGHT");
  expect(new URL(page.url()).origin).toBe(app.origin);
  await expect
    .poll(() => sockets.some((socket) => socket.host === backend.host), { timeout: 15_000 })
    .toBe(true);
  expect(sockets.length).toBeGreaterThan(0);
  expect(
    sockets.every(
      (socket) =>
        socket.host === backend.host &&
        socket.protocol === "ws:" &&
        socket.pathname.includes("sync"),
    ),
  ).toBe(true);
}

async function provisionOwner(page: Page, client: ConvexHttpClient) {
  const email = `phase49-${randomUUID()}@example.test`;
  const password = `Pikar-${randomUUID()}-test`;
  const invite = await call<{ code: string }>(client, inviteRefs.__seedInvite, { email });
  if (!/^[A-Z0-9-]+$/.test(invite.code)) throw new Error("disposable invite shape invalid");
  await page.goto(`/signup?invite=${invite.code}`);
  await page.getByPlaceholder("John Doe").fill("Phase 49 Owner");
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.getByPlaceholder("Create a password").fill(password);
  await page.getByPlaceholder("Confirm password").fill(password);
  await page.getByRole("button", { name: /Create Account/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 30_000 });
  const found = await call<{ result: { userId: string } | null }>(
    client,
    ownerRefs.findUserIdByEmailForProvisioning,
    { email },
    "query",
  );
  if (!found.result?.userId) throw new Error("disposable signup did not create an owner subject");
  await call(client, ownerRefs.bootstrapOwner, { userId: found.result.userId });
  await call(client, onboardingRefs.__seedOnboardedTenant, { tenantId: found.result.userId });
  // The successful password signup already established this browser's authenticated session.
  // Bootstrapping owner authority does not require a second password flow; reload to observe it.
  await page.goto("/ops");
  await expect(page.getByRole("heading", { name: "Web recipe candidates" })).toBeVisible({
    timeout: 30_000,
  });
}

async function userClient(page: Page, backend: URL) {
  const state = await page.context().storageState();
  const token = state.origins
    .flatMap((origin) => origin.localStorage)
    .find((entry) => entry.name.startsWith("__convexAuthJWT"))?.value;
  if (!token) throw new Error("authenticated browser JWT absent");
  const client = new ConvexHttpClient(backend.origin);
  client.setAuth(token);
  return client;
}

async function assertFrame(page: Page, expectedText: string, candidate: Candidate) {
  const frame = page.frameLocator('iframe[title="Read-only recipe preview"]');
  await expect(frame.getByText(expectedText, { exact: false }).first()).toBeVisible();
  const html = await page
    .locator('iframe[title="Read-only recipe preview"]')
    .getAttribute("srcdoc");
  if (!html) throw new Error("server preview HTML missing");
  const sandbox = await page
    .locator('iframe[title="Read-only recipe preview"]')
    .getAttribute("sandbox");
  expect(sandbox).toBe("");
  expect(await frame.locator("script,[onload],[onclick],[onerror]").count()).toBe(0);
  expect(html).not.toMatch(/javascript:|data:text\/html|<script/i);
  const readback = await page.getByTestId("recipe-preview-readback").innerText();
  expect(readback).toContain(`body ${candidate.bodyHash}`);
  expect(readback).toContain(`artifact ${sha(html)}`);
  expect(readback).toMatch(/document [a-f0-9]{64}/);
  expect(
    await frame.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
}

async function exerciseCandidate(page: Page, client: ConvexHttpClient, candidate: Candidate) {
  await page.goto("/ops");
  const card = page.getByRole("article", { name: candidate.name });
  await expect(card.getByTestId(`recipe-candidate-${candidate.skillId}`)).toContainText(
    `v${candidate.version}`,
  );
  await card.getByRole("button", { name: "Start rendered candidate qualification" }).click();
  await expect(page.getByRole("status")).toContainText("Selected exact");
  const brand = `Phase 49 ${candidate.name} v${candidate.version}`;
  await page.getByLabel("Candidate brand name").fill(brand);
  const editable =
    candidate.name === "web-recipe-storefront-catalogue"
      ? page.getByLabel("Candidate introduction")
      : page.getByLabel("Candidate headline");
  for (const [viewport, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await card.getByRole("button", { name: `Open ${viewport} lane` }).click();
    await expect(page.getByRole("status")).toContainText(`${viewport} lane opened`);
    await card.getByRole("button", { name: "Try allowed partial" }).click();
    await expect(page.getByRole("status")).toContainText(`partial rendered in ${viewport}`);
    await assertFrame(page, brand, candidate);
    await card.getByRole("button", { name: "Try bounded refusal" }).click();
    await expect(page.getByRole("status")).toContainText(
      `Bounded input refusal observed in ${viewport}`,
    );
    await expect(page.locator('iframe[title="Read-only recipe preview"]')).toHaveCount(0);
    await card.getByRole("button", { name: "Render recovery" }).click();
    await expect(page.getByRole("status")).toContainText(`recovery rendered in ${viewport}`);
    await assertFrame(page, brand, candidate);
    const changed = `Edited ${candidate.name} at ${viewport}`;
    await editable.fill(changed);
    await card.getByRole("button", { name: "Render changed edit" }).click();
    await expect(page.getByRole("status")).toContainText(`edit rendered in ${viewport}`);
    await assertFrame(page, changed, candidate);
    await card.getByRole("button", { name: "Preview and read back exact document" }).click();
    await expect(page.getByRole("status")).toContainText(`preview rendered in ${viewport}`);
    await assertFrame(page, changed, candidate);
  }
  await card.getByRole("button", { name: "Finalize owner transcript" }).click();
  await expect(page.getByRole("status")).toContainText("awaiting trusted runner review");
  await expect(card.getByRole("button", { name: "Activate exact candidate" })).toBeDisabled();
  const exact = candidateFor(await inspect(client), candidate.name, candidate.version);
  const run = (await inspect(client)).find((row) => row.name === candidate.name)?.browserRun;
  if (
    !run?.transcriptHash ||
    run.lanes.length !== 2 ||
    run.revision !== 12 ||
    run.lanes.some(
      (lane) => lane.outcomes.join(",") !== "selected,partial,refusal,recovery,edit,preview",
    )
  )
    throw new Error("server transcript differs from observed desktop/mobile run");
  expect(exact.skillId).toBe(candidate.skillId);
  const browserEvidence = JSON.stringify({
    runner: WEB_RECIPE_BROWSER_RUNNER,
    runId: run.runId,
    pass: true,
    authenticated: true,
    actorClass: "owner",
    route: "/ops",
    rendered: true,
    skillId: candidate.skillId,
    name: candidate.name,
    version: candidate.version,
    bodyHash: candidate.bodyHash,
    definitionHash: candidate.definitionHash,
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    evidenceRevision: WEB_RECIPE_BROWSER_EVIDENCE_REVISION,
    viewports: WEB_RECIPE_REQUIRED_VIEWPORTS,
    casesPassed: 12,
    casesTotal: 12,
    revision: run.revision,
    outcomeRefs: WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS,
    transcriptHash: run.transcriptHash,
    ts: Date.now(),
  });
  await call(client, skills.recordWebRecipeBrowserEvidence, {
    name: candidate.name,
    version: candidate.version,
    browserEvidence,
  });
  await expect(card.getByRole("button", { name: "Activate exact candidate" })).toBeEnabled();
  await card.getByRole("button", { name: "Activate exact candidate" }).click();
  await expect(page.getByRole("status")).toContainText("activation completed");
  return { runId: run.runId, transcriptHash: run.transcriptHash };
}

async function createSiteThroughForm(
  page: Page,
  backend: URL,
  family: "business-site" | "campaign-landing",
  candidate: Candidate,
) {
  const version = candidate.version;
  const before = await call<Array<{ _id: string }>>(
    await userClient(page, backend),
    (api as unknown as { webProjects: Record<string, unknown> }).webProjects.listProjects,
    {},
    "query",
  );
  await page.goto("/dashboard/sites");
  await page
    .getByRole("button", {
      name: family === "business-site" ? "Business site" : "Campaign landing",
    })
    .click();
  const slug = `phase49-${family}-v${version}-${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Project title").fill(`Phase 49 ${family} v${version}`);
  await page.getByLabel("Page path").fill(slug);
  await page.locator("#recipe-brandName").fill(`Phase 49 ${family} v${version}`);
  await page.locator("#recipe-headline").fill(`Qualified ${family} v${version}`);
  await page.getByRole("button", { name: "Create editable project" }).click();
  await expect(page).toHaveURL(/project=/);
  const after = await call<Array<{ _id: string }>>(
    await userClient(page, backend),
    (api as unknown as { webProjects: Record<string, unknown> }).webProjects.listProjects,
    {},
    "query",
  );
  const created = after.find((row) => !before.some((old) => old._id === row._id));
  if (!created) throw new Error("normal recipe form did not create a project");
  const result = await call<Version>(
    await userClient(page, backend),
    (api as unknown as { webProjects: Record<string, unknown> }).webProjects.getVersion,
    { projectId: created._id, version: 1 },
    "query",
  );
  expect(result.recipeRef).toMatchObject({
    name: candidate.name,
    version,
    skillId: candidate.skillId,
    bodyHash: candidate.bodyHash,
  });
  expect(result.rendererVersion).toBe("web-design-renderer-v1");
  return { projectId: created._id, result };
}

async function createStorefrontThroughOwner(page: Page, backend: URL, candidate: Candidate) {
  const version = candidate.version;
  await page.goto("/ops");
  const card = page.getByRole("article", { name: "web-recipe-storefront-catalogue" });
  const slug = `phase49-private-v${version}-${randomUUID().slice(0, 8)}`;
  await card.getByLabel("Private storefront slug").fill(slug);
  await card.getByRole("button", { name: "Create private storefront artifact" }).click();
  await expect(card.getByTestId("storefront-readback")).toContainText(`v${version}`);
  const text = await card.getByTestId("storefront-readback").innerText();
  const id = text.match(/Readback ([a-z0-9]+)/)?.[1];
  if (!id) throw new Error("private storefront readback ID missing");
  const ref = (api as unknown as { webRecipes: Record<string, unknown> }).webRecipes
    .getStorefrontQualification;
  const data = await call<{ version: Version }>(
    await userClient(page, backend),
    ref,
    { projectId: id },
    "query",
  );
  expect(data.version.recipeRef).toMatchObject({
    name: candidate.name,
    version,
    skillId: candidate.skillId,
    bodyHash: candidate.bodyHash,
  });
  expect(data.version.rendererVersion).toBe("web-design-renderer-v1");
  return { projectId: id, slug, result: data.version };
}

test("isolated exact owner browser qualification and all-family v1-v2-v1 rollback", async ({
  page,
}) => {
  let pageErrors = 0;
  let consoleErrors = 0;
  page.on("pageerror", () => {
    pageErrors++;
    if (pageErrors === 1) console.log("Phase 49 browser pageerror observed (content withheld)");
  });
  page.on("console", (entry) => {
    if (entry.type() === "error") {
      consoleErrors++;
      if (consoleErrors === 1)
        console.log("Phase 49 browser console error observed (content withheld)");
    }
  });
  const { client, backend, site, app } = fixtureClient();
  await assertEmbeddedBackend(page, app, backend);
  if ((await inspect(client)).some((row) => row.present))
    throw new Error("fresh disposable backend must have an empty recipe registry");
  await provisionOwner(page, client);
  const createdIds: string[] = [];
  const exactCandidates = new Map<number, Map<string, Candidate>>();
  let fixtureRunId: string | undefined;
  let cleanupResult: number | undefined;
  try {
    for (const version of [1, 2] as const) {
      const seeded = await call<{ qualificationFixtureRunId: string; createdIds: string[] }>(
        client,
        skills.seedWebRecipeQualificationCandidates,
        fixtureRunId ? { qualificationFixtureRunId: fixtureRunId } : {},
      );
      fixtureRunId = seeded.qualificationFixtureRunId;
      createdIds.push(...seeded.createdIds);
      expect(seeded.createdIds).toHaveLength(3);
      const seededRows = await inspect(client);
      const candidates = names.map((name) => candidateFor(seededRows, name, version));
      exactCandidates.set(
        version,
        new Map(candidates.map((candidate) => [candidate.name, candidate])),
      );
      for (const candidate of candidates) {
        await call(client, skills.evaluateWebRecipe, {
          name: candidate.name,
          version,
          runId: `phase49-${version}-${randomUUID()}`,
        });
        await exerciseCandidate(page, client, candidate);
      }
      const discovery = await call<Array<{ name: string }>>(
        await userClient(page, backend),
        (api as unknown as { webRecipes: Record<string, unknown> }).webRecipes.listAvailable,
        {},
        "query",
      );
      expect(discovery.map((row) => row.name).sort()).toEqual(names.slice(0, 2).sort());
    }
    const captured = (version: number, name: string) => {
      const row = exactCandidates.get(version)?.get(name);
      if (!row) throw new Error("captured exact candidate identity missing");
      return row;
    };
    const siteV2 = await createSiteThroughForm(
      page,
      backend,
      "business-site",
      captured(2, names[0]),
    );
    const landingV2 = await createSiteThroughForm(
      page,
      backend,
      "campaign-landing",
      captured(2, names[1]),
    );
    const storefrontV2 = await createStorefrontThroughOwner(page, backend, captured(2, names[2]));
    const v2 = [siteV2, landingV2, storefrontV2];
    const immutable = v2.map(({ result }) => JSON.stringify(result));
    for (const name of names) {
      await page.goto("/ops");
      const card = page.getByRole("article", { name });
      await expect(card).toContainText("active version 2");
      await card.getByRole("button", { name: "Roll back to v1" }).click();
      await expect(page.getByRole("status")).toContainText(
        "Rolled back to exact eligible version 1",
      );
    }
    for (const name of names) {
      const active = await call<{ version: number }>(
        client,
        skills.getActiveSkill,
        { name },
        "query",
      );
      expect(active.version).toBe(1);
    }
    const readbacks = [
      await call<Version>(
        await userClient(page, backend),
        (api as unknown as { webProjects: Record<string, unknown> }).webProjects.getVersion,
        { projectId: siteV2.projectId, version: 1 },
        "query",
      ),
      await call<Version>(
        await userClient(page, backend),
        (api as unknown as { webProjects: Record<string, unknown> }).webProjects.getVersion,
        { projectId: landingV2.projectId, version: 1 },
        "query",
      ),
      (
        await call<{ version: Version }>(
          await userClient(page, backend),
          (api as unknown as { webRecipes: Record<string, unknown> }).webRecipes
            .getStorefrontQualification,
          { projectId: storefrontV2.projectId },
          "query",
        )
      ).version,
    ];
    expect(readbacks.map((row) => JSON.stringify(row))).toEqual(immutable);
    for (const [index, readback] of readbacks.entries()) {
      const name = names[index];
      if (!name) throw new Error("v2 readback family missing");
      expect(readback.recipeRef).toMatchObject({
        name,
        version: 2,
        skillId: captured(2, name).skillId,
        bodyHash: captured(2, name).bodyHash,
      });
    }
    await createSiteThroughForm(page, backend, "business-site", captured(1, names[0]));
    await createSiteThroughForm(page, backend, "campaign-landing", captured(1, names[1]));
    await createStorefrontThroughOwner(page, backend, captured(1, names[2]));
    const discovery = await call<Array<{ name: string }>>(
      await userClient(page, backend),
      (api as unknown as { webRecipes: Record<string, unknown> }).webRecipes.listAvailable,
      {},
      "query",
    );
    expect(discovery.some((row) => row.name === names[2])).toBe(false);
    const anonymousPrivate = await fetch(new URL(`/p/${storefrontV2.slug}/catalogue`, site));
    expect(anonymousPrivate.status).toBe(404);
    console.log(
      `Phase 49 isolated browser qualification: six exact candidate runs, three immutable v2 artifacts, three v1 post-rollback artifacts; refs ${v2.map((row) => row.projectId).join(",")}`,
    );
  } finally {
    if (fixtureRunId && createdIds.length) {
      const result = await call<{ removed: number }>(client, skills.cleanupWebRecipeQualification, {
        qualificationFixtureRunId: fixtureRunId,
        createdIds,
      });
      cleanupResult = result.removed;
      expect(cleanupResult).toBe(createdIds.length);
      console.log(`Phase 49 exact fixture rows cleaned: ${cleanupResult}`);
    }
  }
});
