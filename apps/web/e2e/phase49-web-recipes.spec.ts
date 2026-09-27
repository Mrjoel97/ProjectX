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
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

// This spec owns one fresh disposable deployment. It earns candidate evidence through actual
// owner iframes, then exercises the normal tenant editor and anonymous Convex HTTP boundary.
test.describe.configure({ mode: "serial", retries: 0 });
test.setTimeout(1_800_000);

const names = [
  "web-recipe-business-site",
  "web-recipe-campaign-landing",
  "web-recipe-storefront-catalogue",
] as const;
const refs = api as unknown as {
  webProjects: Record<string, unknown>;
  webRecipes: Record<string, unknown>;
};
const privateRefs = internal as unknown as {
  skills: Record<string, unknown>;
  owner: Record<string, unknown>;
  invites: Record<string, unknown>;
  onboarding: Record<string, unknown>;
  smoke: Record<string, unknown>;
};
type Candidate = {
  name: string;
  skillId: string;
  version: number;
  bodyHash: string;
  definitionHash: string;
  present: boolean;
  browserRun?: {
    runId: string;
    revision: number;
    transcriptHash: string | null;
    lanes: Array<{ viewport: string; outcomes: string[] }>;
  };
};
type Version = {
  version: number;
  contentHash: string;
  document: {
    title: string;
    pages: Array<{
      slug: string;
      nodes: Array<{
        kind: string;
        heading?: string;
        id?: string;
        consent?: string;
        attribution?: { source?: string };
      }>;
    }>;
  };
  artifactHtml?: string;
  artifacts?: Array<{ pageSlug: string; html: string }>;
  rendererVersion: string;
  recipeRef: {
    name: string;
    version: number;
    skillId: string;
    bodyHash: string;
    definitionHash: string;
    inputHash: string;
    rendererVersion: string;
    designProfile: {
      bundleHash: string;
      dials: { variance: number; motion: number; density: number };
    };
  };
};
type Project = {
  _id: string;
  tenantId: string;
  revision: number;
  draftVersion?: number;
  publishedVersion?: number;
  publishedContentHash?: string;
  slug: string;
  publicHost: string;
  kind: string;
};
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const call = async <T>(client: ConvexHttpClient, ref: unknown, args: unknown, query = false) =>
  (query
    ? client.query(ref as FunctionReference<"query">, args as never)
    : client.mutation(ref as FunctionReference<"mutation">, args as never)) as Promise<T>;

function fixture() {
  if (
    process.env.PIKAR_PHASE49_QUALIFICATION !== "1" ||
    process.env.PIKAR_PHASE49_DISPOSABLE !== "1"
  )
    throw new Error("Phase 49 requires the explicit disposable stack");
  const root = process.env.PIKAR_PHASE49_DISPOSABLE_ROOT;
  const configPath = process.env.PIKAR_PHASE49_FIXTURE_CONFIG;
  if (!root || !configPath || !isAbsolute(root) || !isAbsolute(configPath))
    throw new Error("disposable root/config missing");
  const rel = relative(resolve(root), resolve(configPath));
  if (
    !rel ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    /[\\/]\.convex[\\/]local[\\/]default[\\/]/i.test(configPath)
  )
    throw new Error("fixture config is outside the selected disposable root");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    adminKey: string;
    ports: { cloud: number; site: number };
  };
  const backend = new URL(process.env.PIKAR_PHASE49_BACKEND_URL ?? "");
  const app = new URL(process.env.PIKAR_E2E_BASE_URL ?? "");
  const site = new URL(`http://127.0.0.1:${config.ports.site}`);
  for (const origin of [backend, app, site])
    if (
      origin.protocol !== "http:" ||
      origin.hostname !== "127.0.0.1" ||
      !origin.port ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    )
      throw new Error("fixture origin must be exact loopback HTTP");
  if (
    backend.port !== String(config.ports.cloud) ||
    new Set([backend.origin, app.origin, site.origin]).size !== 3
  )
    throw new Error("fixture origins disagree");
  const admin = new ConvexHttpClient(backend.origin);
  (admin as ConvexHttpClient & { setAdminAuth(key: string): void }).setAdminAuth(config.adminKey);
  return { admin, backend, app, site };
}

async function account(page: Page, admin: ConvexHttpClient, backend: URL, owner: boolean) {
  const email = `phase49-integrated-${randomUUID()}@example.test`;
  const password = `Pikar-${randomUUID()}-test`;
  const invite = await call<{ code: string }>(admin, privateRefs.invites.__seedInvite, { email });
  await page.goto(`/signup?invite=${invite.code}`);
  await page.getByPlaceholder("John Doe").fill(owner ? "Phase 49 Owner" : "Phase 49 Tenant");
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.getByPlaceholder("Create a password").fill(password);
  await page.getByPlaceholder("Confirm password").fill(password);
  await page.getByRole("button", { name: /Create Account/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const state = await page.context().storageState();
        return state.origins.some((origin) =>
          origin.localStorage.some(
            (entry) => entry.name.startsWith("__convexAuthJWT") && Boolean(entry.value),
          ),
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const found = await call<{ result: { userId: string } | null }>(
    admin,
    privateRefs.owner.findUserIdByEmailForProvisioning,
    { email },
    true,
  );
  if (!found.result?.userId) throw new Error("disposable account subject missing");
  if (owner) await call(admin, privateRefs.owner.bootstrapOwner, { userId: found.result.userId });
  await call(admin, privateRefs.onboarding.__seedOnboardedTenant, {
    tenantId: found.result.userId,
  });
  const authenticated = await userClient(page, backend);
  await expect
    .poll(
      async () =>
        (await call<{ isOwner: boolean }>(authenticated, api.owner.viewer, {}, true)).isOwner,
      {
        timeout: 30_000,
      },
    )
    .toBe(owner);
  await page.goto(owner ? "/ops" : "/dashboard/sites");
  await expect(
    page.getByRole("heading", { name: owner ? "Web recipe candidates" : "Publish a focused page" }),
  ).toBeVisible({ timeout: 30_000 });
  return found.result.userId;
}

async function userClient(page: Page, backend: URL) {
  const state = await page.context().storageState();
  const token = state.origins
    .flatMap((origin) => origin.localStorage)
    .find((entry) => entry.name.startsWith("__convexAuthJWT"))?.value;
  if (!token) throw new Error("authenticated browser JWT missing");
  const client = new ConvexHttpClient(backend.origin);
  client.setAuth(token);
  return client;
}
const inspect = (admin: ConvexHttpClient) =>
  call<Candidate[]>(admin, privateRefs.skills.inspectWebRecipeCandidates, {}, true);

async function activate(page: Page, admin: ConvexHttpClient, candidate: Candidate) {
  await call(admin, privateRefs.skills.evaluateWebRecipe, {
    name: candidate.name,
    version: candidate.version,
    runId: `phase49-integrated-${randomUUID()}`,
  });
  await page.goto("/ops");
  const card = page.getByRole("article", { name: candidate.name });
  await card.getByRole("button", { name: "Start rendered candidate qualification" }).click();
  await expect(page.getByRole("status")).toContainText("Selected exact");
  const brand = `Integrated ${candidate.name} v${candidate.version}`;
  await page.getByLabel("Candidate brand name").fill(brand);
  const editable = page.getByLabel(
    candidate.name === names[2] ? "Candidate introduction" : "Candidate headline",
  );
  for (const [lane, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await card.getByRole("button", { name: `Open ${lane} lane` }).click();
    await expect(page.getByRole("status")).toContainText(`${lane} lane opened`);
    await card.getByRole("button", { name: "Try allowed partial" }).click();
    await expect(page.getByRole("status")).toContainText(`partial rendered in ${lane}`);
    const frame = page.frameLocator('iframe[title="Read-only recipe preview"]');
    await expect(frame.getByText(brand, { exact: false }).first()).toBeVisible();
    await card.getByRole("button", { name: "Try bounded refusal" }).click();
    await expect(page.getByRole("status")).toContainText(
      `Bounded input refusal observed in ${lane}`,
    );
    await expect(page.locator('iframe[title="Read-only recipe preview"]')).toHaveCount(0);
    await card.getByRole("button", { name: "Render recovery" }).click();
    await expect(page.getByRole("status")).toContainText(`recovery rendered in ${lane}`);
    await expect(frame.getByText(brand, { exact: false }).first()).toBeVisible();
    const changed = `Edited ${candidate.name} ${lane}`;
    await editable.fill(changed);
    await card.getByRole("button", { name: "Render changed edit" }).click();
    await expect(page.getByRole("status")).toContainText(`edit rendered in ${lane}`);
    await expect(frame.getByText(changed, { exact: false }).first()).toBeVisible();
    await card.getByRole("button", { name: "Preview and read back exact document" }).click();
    await expect(page.getByRole("status")).toContainText(`preview rendered in ${lane}`);
    const html = await page
      .locator('iframe[title="Read-only recipe preview"]')
      .getAttribute("srcdoc");
    if (!html) throw new Error("server preview HTML missing");
    expect(
      await page.locator('iframe[title="Read-only recipe preview"]').getAttribute("sandbox"),
    ).toBe("");
    expect(await frame.locator("script,[onload],[onclick],[onerror]").count()).toBe(0);
    expect(html).not.toMatch(/javascript:|data:text\/html|<script/i);
    await expect(page.getByTestId("recipe-preview-readback")).toContainText(
      `body ${candidate.bodyHash}`,
    );
    await expect(page.getByTestId("recipe-preview-readback")).toContainText(
      `artifact ${sha(html)}`,
    );
    expect(
      await frame.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await card.getByRole("button", { name: "Finalize owner transcript" }).click();
  await expect(page.getByRole("status")).toContainText("awaiting trusted runner review");
  await expect(card.getByRole("button", { name: "Activate exact candidate" })).toBeDisabled();
  const row = (await inspect(admin)).find((item) => item.name === candidate.name);
  const run = row?.browserRun;
  if (
    !run?.transcriptHash ||
    run.revision !== 12 ||
    run.lanes.length !== 2 ||
    run.lanes.some(
      (item) => item.outcomes.join(",") !== "selected,partial,refusal,recovery,edit,preview",
    )
  )
    throw new Error("browser transcript was not observed by the server");
  await call(admin, privateRefs.skills.recordWebRecipeBrowserEvidence, {
    name: candidate.name,
    version: candidate.version,
    browserEvidence: JSON.stringify({
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
    }),
  });
  await expect(card.getByRole("button", { name: "Activate exact candidate" })).toBeEnabled();
  await card.getByRole("button", { name: "Activate exact candidate" }).click();
  await expect(page.getByRole("status")).toContainText("activation completed");
  return run.transcriptHash;
}

async function createRecipe(
  page: Page,
  backend: URL,
  kind: "business-site" | "campaign-landing",
  version: number,
  width: number,
) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto("/dashboard/sites");
  await page
    .getByRole("button", { name: kind === "business-site" ? "Business site" : "Campaign landing" })
    .click();
  await expect(page.getByRole("button", { name: "Create editable project" })).toBeVisible();
  // Keyboard refusal, focus recovery, and bounded input remain visible before mutation.
  await page.getByRole("button", { name: "Create editable project" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start from a qualified recipe" })).toBeFocused();
  const slug = `phase49-${kind}-${width}-v${version}-${randomUUID().slice(0, 7)}`;
  await page.getByLabel("Project title").fill(`PHASE49::${kind}::${width}::v${version}`);
  await page.getByLabel("Page path").fill(slug);
  await page.locator("#recipe-brandName").fill(`Integrated ${kind}`);
  await page.locator("#recipe-headline").fill(`${kind} ${width} v${version}`);
  const dials =
    version === 1 ? { variance: 5, motion: 5, density: 5 } : { variance: 8, motion: 2, density: 7 };
  await page.locator("#recipe-variance").fill(String(dials.variance));
  await page.locator("#recipe-motion").fill(String(dials.motion));
  await page.locator("#recipe-density").fill(String(dials.density));
  if (kind === "business-site") {
    await page.locator("#recipe-summary").fill("Structured local business site");
    await page.locator("#recipe-services").fill("Consulting\nPlanning");
    await page.locator("#recipe-contactConsent").fill("I agree to hear from Pikar AI.");
  } else {
    await page.locator("#recipe-offer").fill("A local campaign offer");
    await page.locator("#recipe-ctaLabel").fill("Continue locally");
    await page.locator("#recipe-ctaPath").fill(`/p/${slug}/campaign`);
    await page.locator("#recipe-formConsent").fill("I agree to hear from Pikar AI.");
    await page.locator("#recipe-attributionSource").fill("phase49-integrated");
  }
  await page.getByRole("button", { name: "Create editable project" }).click();
  try {
    await expect(page).toHaveURL(/project=/);
  } catch {
    const alert = await page.getByRole("alert").allTextContents();
    const status = await page.getByRole("status").allTextContents();
    throw new Error(
      `CREATE_RECIPE_FAILED:${kind}:v${version}:${width}:${[...alert, ...status].join("|").slice(0, 160)}`,
    );
  }
  const id = new URL(page.url()).searchParams.get("project");
  if (!id) throw new Error("created recipe project missing URL id");
  const client = await userClient(page, backend);
  const row = await call<Version>(
    client,
    refs.webProjects.getVersion,
    { projectId: id, version: 1 },
    true,
  );
  expect(row.recipeRef.version).toBe(version);
  expect(row.recipeRef.designProfile).toMatchObject({
    bundleHash: WEB_RECIPE_BUNDLE_HASH,
    dials,
  });
  expect(row.rendererVersion).toBe("web-design-renderer-v1");
  expect(
    await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  return { id, slug, version: row };
}

test("integrated site, landing and private storefront lifecycles on one disposable revision", async ({
  page,
  browser,
}) => {
  const { admin, backend, site } = fixture();
  const tenantId = await account(page, admin, backend, true);
  const owner = await userClient(page, backend);
  const ownedIds: string[] = [];
  const emails: string[] = [];
  const createdRows: string[] = [];
  let fixtureRunId: string | undefined;
  let tenantContext: BrowserContext | undefined;
  let anonymous: BrowserContext | undefined;
  let failure: unknown;
  try {
    expect((await inspect(admin)).some((row) => row.present)).toBe(false);
    const exact = new Map<number, Map<string, Candidate>>();
    for (const version of [1, 2] as const) {
      const seeded = await call<{ qualificationFixtureRunId: string; createdIds: string[] }>(
        admin,
        privateRefs.skills.seedWebRecipeQualificationCandidates,
        fixtureRunId ? { qualificationFixtureRunId: fixtureRunId } : {},
      );
      fixtureRunId = seeded.qualificationFixtureRunId;
      createdRows.push(...seeded.createdIds);
      expect(seeded.createdIds).toHaveLength(3);
      const rows = await inspect(admin);
      const map = new Map<string, Candidate>();
      for (const name of names) {
        const row = rows.find((item) => item.name === name);
        if (
          !row?.present ||
          row.version !== version ||
          !row.skillId ||
          !row.bodyHash ||
          !row.definitionHash
        )
          throw new Error(`exact ${name} v${version} missing`);
        map.set(name, row);
        await activate(page, admin, row);
      }
      exact.set(version, map);
      const available = await call<Array<{ name: string; version: number }>>(
        owner,
        refs.webRecipes.listAvailable,
        {},
        true,
      );
      expect(available.map((item) => item.name).sort()).toEqual(names.slice(0, 2).sort());
      expect(available.every((item) => item.version === version)).toBe(true);
      if (version === 1) {
        for (const kind of ["business-site", "campaign-landing"] as const) {
          const project = await createRecipe(page, backend, kind, 1, 1280);
          ownedIds.push(project.id);
        }
      }
    }
    const v2Projects = [];
    for (const kind of ["business-site", "campaign-landing"] as const)
      for (const width of [1280, 390]) {
        const project = await createRecipe(page, backend, kind, 2, width);
        ownedIds.push(project.id);
        const candidate = exact.get(2)?.get(`web-recipe-${kind}`);
        expect(project.version.recipeRef).toMatchObject({
          name: candidate?.name,
          version: 2,
          skillId: candidate?.skillId,
          bodyHash: candidate?.bodyHash,
          definitionHash: candidate?.definitionHash,
        });
        v2Projects.push({ ...project, kind, width });
      }
    // A separate signed-in tenant sees the site/landing choices, never the private catalogue.
    tenantContext = await browser.newContext({ baseURL: process.env.PIKAR_E2E_BASE_URL });
    const tenantPage = await tenantContext.newPage();
    const tenantB = await account(tenantPage, admin, backend, false);
    expect(tenantB).not.toBe(tenantId);
    const tenantClient = await userClient(tenantPage, backend);
    expect(
      (
        await call<Array<{ name: string }>>(tenantClient, refs.webRecipes.listAvailable, {}, true)
      ).map((row) => row.name),
    ).not.toContain(names[2]);
    await expect(tenantPage.getByRole("button", { name: /storefront|catalogue/i })).toHaveCount(0);
    await tenantPage.goto("/ops");
    await expect(tenantPage.getByRole("heading", { name: "Web recipe candidates" })).toHaveCount(0);
    anonymous = await browser.newContext({
      baseURL: site.origin,
      storageState: { cookies: [], origins: [] },
    });
    const publicPage = await anonymous.newPage();
    for (const project of v2Projects) {
      const pageSlug = project.version.document.pages[0]?.slug;
      if (!pageSlug) throw new Error("recipe page slug missing");
      const publicPath = `${site.origin}/p/${project.slug}/${pageSlug}`;
      const candidate = exact.get(2)?.get(`web-recipe-${project.kind}`);
      expect(project.version.recipeRef).toMatchObject({
        name: candidate?.name,
        skillId: candidate?.skillId,
        bodyHash: candidate?.bodyHash,
        definitionHash: candidate?.definitionHash,
        version: 2,
      });
      await page.goto(`/dashboard/sites?project=${project.id}`);
      await page.getByRole("link", { name: "Preview exact v1" }).click();
      try {
        await expect(page).toHaveURL(/\/preview\?/);
      } catch {
        throw new Error(`PREVIEW_NAVIGATION_FAILED:${project.kind}:${project.width}`);
      }
      await expect(
        page.frameLocator('iframe[title^="Preview PHASE49::"]').locator("body"),
      ).toContainText(project.kind);
      await page.goto(`/dashboard/sites?project=${project.id}`);
      const document = structuredClone(project.version.document);
      const hero = document.pages[0]?.nodes.find((node) => node.kind === "hero");
      if (!hero) throw new Error("recipe hero missing");
      hero.heading = `Edited ${project.kind} ${project.width}`;
      await page.getByLabel("Structured content JSON").fill(JSON.stringify(document));
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByRole("status")).toContainText("Draft saved");
      const edited = await call<Version>(
        owner,
        refs.webProjects.getVersion,
        { projectId: project.id, version: 2 },
        true,
      );
      const identities = (version: Version) =>
        version.document.pages[0]?.nodes
          .filter((node) => node.kind === "cta" || node.kind === "form")
          .map((node) => ({
            kind: node.kind,
            id: node.id,
            consent: node.consent,
            attribution: node.attribution,
          }));
      expect(identities(edited)).toEqual(identities(project.version));
      expect(edited.recipeRef).toEqual(project.version.recipeRef);
      expect(edited.contentHash).not.toBe(project.version.contentHash);
      await page.getByRole("button", { name: "Approve exact version" }).click();
      await expect(page.getByRole("status")).toContainText("Version approved");
      await page.getByRole("button", { name: /^Publish$/ }).click();
      await expect(page.getByRole("status")).toContainText("Published on the Pikar platform path");
      const current = await call<Project>(
        owner,
        refs.webProjects.getProject,
        { projectId: project.id },
        true,
      );
      const expectedHtml = edited.artifacts?.find((item) => item.pageSlug === pageSlug)?.html;
      if (!expectedHtml) throw new Error("stored exact artifact missing");
      const response = await anonymous.request.get(publicPath);
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe(expectedHtml);
      expect(current.publishedContentHash).toBe(edited.contentHash);
      expect(
        await call<Project | null>(
          tenantClient,
          refs.webProjects.getProject,
          { projectId: project.id },
          true,
        ),
      ).toBeNull();
      await expect(
        call(tenantClient, refs.webProjects.saveDraft, {
          projectId: project.id,
          document,
          expectedRevision: current.revision,
        }),
      ).rejects.toThrow(/WEB_PROJECT_UNAVAILABLE/);
      // A stale CAS and an unapproved update leave exact old public bytes in place.
      const stale = await call<{ ok: boolean; code: string }>(
        owner,
        refs.webProjects.updateVersion,
        {
          projectId: project.id,
          version: 2,
          contentHash: edited.contentHash,
          expectedRevision: current.revision - 1,
        },
      );
      expect(stale).toMatchObject({ ok: false, code: "STALE_REVISION" });
      expect(await (await anonymous.request.get(publicPath)).text()).toBe(expectedHtml);
      await page.goto(`/dashboard/sites?project=${project.id}`);
      await page
        .getByLabel("Structured content JSON")
        .fill(JSON.stringify({ ...document, title: `Update ${project.width}` }));
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByRole("status")).toContainText("Draft saved");
      const unapproved = await call<Project>(
        owner,
        refs.webProjects.getProject,
        { projectId: project.id },
        true,
      );
      const refused = await call<{ ok: boolean; code: string }>(
        owner,
        refs.webProjects.updateVersion,
        {
          projectId: project.id,
          version: 3,
          contentHash: "bad",
          expectedRevision: unapproved.revision,
        },
      );
      expect(refused).toMatchObject({ ok: false, code: "NOT_APPROVED" });
      expect(await (await anonymous.request.get(publicPath)).text()).toBe(expectedHtml);
      await page.getByRole("button", { name: "Approve exact version" }).click();
      await expect(page.getByRole("status")).toContainText("Version approved");
      await page.getByRole("button", { name: "Publish update" }).click();
      await expect(page.getByRole("status")).toContainText("Published version updated");
      const updated = await call<Version>(
        owner,
        refs.webProjects.getVersion,
        { projectId: project.id, version: 3 },
        true,
      );
      expect(await (await anonymous.request.get(publicPath)).text()).toBe(
        updated.artifacts?.find((item) => item.pageSlug === pageSlug)?.html,
      );
      await page.getByRole("button", { name: "Approve v2" }).click();
      await expect(page.getByRole("status")).toContainText("approved for rollback");
      await page.getByRole("button", { name: "Rollback to v2" }).click();
      await expect(page.getByRole("status")).toContainText("Rolled back to exact version 2");
      expect(await (await anonymous.request.get(publicPath)).text()).toBe(expectedHtml);
      await page.getByRole("button", { name: "Unpublish" }).click();
      await expect(page.getByRole("status")).toContainText("unpublished");
      expect((await anonymous.request.get(publicPath)).status()).toBe(404);
      await page.getByRole("button", { name: "Rollback to v2" }).click();
      await expect(page.getByRole("status")).toContainText("Rolled back");
      expect(await (await anonymous.request.get(publicPath)).text()).toBe(expectedHtml);
    }
    // The rendered landing CTA and form retain their original IDs and attribution after edits.
    const landing = v2Projects.find(
      (item) => item.kind === "campaign-landing" && item.width === 1280,
    );
    if (!landing) throw new Error("landing control project missing");
    await publicPage.goto(`${site.origin}/p/${landing.slug}/campaign`);
    await publicPage.getByRole("button", { name: "Continue locally" }).click();
    await publicPage.waitForURL(`${site.origin}/p/${landing.slug}/campaign`);
    const email = `phase49-lead-${randomUUID()}@example.test`;
    emails.push(email);
    const anonymousContext = anonymous;
    const form = (data: Record<string, string>, key: string) =>
      anonymousContext.request.post(`${site.origin}/p/${landing.slug}/campaign/forms/signup`, {
        form: data,
        headers: { "Idempotency-Key": key, "X-Forwarded-For": "198.51.100.49" },
        maxRedirects: 0,
      });
    expect(await (await form({ email, consent: "on" }, "phase49-accepted")).json()).toEqual({
      ok: true,
      outcome: "accepted",
    });
    expect(await (await form({ email, consent: "on" }, "phase49-accepted")).json()).toEqual({
      ok: true,
      outcome: "duplicate",
    });
    expect(
      await (
        await form(
          { email: `phase49-no-consent-${randomUUID()}@example.test` },
          "phase49-no-consent",
        )
      ).json(),
    ).toEqual({ ok: false, outcome: "consent_required" });
    const observed = await call<{
      submissions: Array<{ outcome: string; attribution?: { source?: string } }>;
      metrics: Array<{ kind: string }>;
    }>(
      admin,
      privateRefs.smoke.inspectPhase48Acceptance,
      { tenantId, projectIds: [landing.id] },
      true,
    );
    expect(observed.submissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "accepted",
          attribution: expect.objectContaining({ source: "phase49-integrated" }),
        }),
        expect.objectContaining({ outcome: "consent_required" }),
      ]),
    );
    expect(observed.metrics.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["page_view", "cta_click", "form_accepted", "form_rejected"]),
    );
    // Owner-only storefront materialization, tenant darkness, direct mutation refusal and a
    // deliberately malformed stored pointer all hit the same code-owned commerce boundary.
    await page.goto("/ops");
    const card = page.getByRole("article", { name: names[2] });
    await expect(card).toContainText("Commerce unavailable");
    const slug = `phase49-private-${randomUUID().slice(0, 8)}`;
    await card.getByLabel("Private storefront slug").fill(slug);
    await card.getByRole("button", { name: "Create private storefront artifact" }).click();
    await expect(card.getByTestId("storefront-readback")).toContainText("v2");
    const id = (await card.getByTestId("storefront-readback").innerText()).match(
      /Readback ([a-z0-9]+)/,
    )?.[1];
    if (!id) throw new Error("private storefront readback ID missing");
    ownedIds.push(id);
    const privateRow = await call<{ project: Project; version: Version }>(
      owner,
      refs.webRecipes.getStorefrontQualification,
      { projectId: id },
      true,
    );
    expect(privateRow.version.recipeRef).toMatchObject({
      name: names[2],
      version: 2,
      skillId: exact.get(2)?.get(names[2])?.skillId,
    });
    await page.goto(`/dashboard/sites/preview?project=${id}&version=1&qualification=only`);
    await expect(page.getByRole("note", { name: "Qualification-only preview" })).toContainText(
      "commerce unavailable",
    );
    await expect(
      page.frameLocator('iframe[title^="Preview Private catalogue"]').locator("body"),
    ).toContainText("Catalogue item");
    await tenantPage.goto(`/dashboard/sites/preview?project=${id}&version=1&qualification=only`);
    await expect(tenantPage.locator('iframe[title^="Preview Private catalogue"]')).toHaveCount(0);
    await expect(tenantPage.locator("body")).not.toContainText("Catalogue item");
    expect(
      (await call<Array<Project>>(owner, refs.webProjects.listProjects, {}, true)).some(
        (row) => row._id === id,
      ),
    ).toBe(false);
    await expect(
      call(tenantClient, refs.webRecipes.getStorefrontQualification, { projectId: id }, true),
    ).rejects.toThrow(/OWNER_REQUIRED/);
    expect(
      await call(tenantClient, refs.webRecipes.createProjectFromRecipe, {
        recipeId: "storefront-catalogue",
        values: {},
        slug: "forbidden",
        title: "Forbidden",
      }).then(
        () => "allowed",
        () => "refused",
      ),
    ).toBe("refused");
    for (const mutation of ["publishVersion", "updateVersion", "rollback"])
      expect(
        await call<{ ok: boolean; code: string }>(owner, refs.webProjects[mutation], {
          projectId: id,
          version: 1,
          contentHash: privateRow.version.contentHash,
          expectedRevision: privateRow.project.revision,
        }),
      ).toMatchObject({ ok: false, code: "COMMERCE_UNAVAILABLE" });
    expect(
      await call<{ ok: boolean; code: string }>(owner, refs.webProjects.unpublish, {
        projectId: id,
        expectedRevision: privateRow.project.revision,
      }),
    ).toMatchObject({ ok: false, code: "COMMERCE_UNAVAILABLE" });
    await call(admin, privateRefs.smoke.seedPhase49MalformedStorefrontPointer, {
      tenantId,
      projectId: id,
    });
    expect(
      (
        await call<{ state: string }>(
          admin,
          (internal as unknown as { webProjects: Record<string, unknown> }).webProjects
            .resolvePublished,
          { host: privateRow.project.publicHost, slug },
          true,
        )
      ).state,
    ).toBe("invalid_host");
    expect((await anonymous.request.get(`${site.origin}/p/${slug}/catalogue`)).status()).toBe(404);
    for (const name of names) {
      await page.goto("/ops");
      await page
        .getByRole("article", { name })
        .getByRole("button", { name: "Roll back to v1" })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Rolled back to exact eligible version 1",
      );
    }
    for (const kind of ["business-site", "campaign-landing"] as const) {
      const project = await createRecipe(page, backend, kind, 1, 390);
      ownedIds.push(project.id);
      expect(project.version.recipeRef.skillId).toBe(
        exact.get(1)?.get(`web-recipe-${kind}`)?.skillId,
      );
    }
    for (const project of v2Projects) {
      const readback = await call<Version>(
        owner,
        refs.webProjects.getVersion,
        { projectId: project.id, version: 1 },
        true,
      );
      expect(readback.recipeRef.version).toBe(2);
      expect(readback.contentHash).toBe(project.version.contentHash);
    }
    console.log(
      `Phase 49 integrated browser matrix: site/landing desktop/mobile lifecycle, two tenants, anonymous exact bytes, private storefront darkness; projects ${ownedIds.length}; bundle ${WEB_RECIPE_BUNDLE_HASH}`,
    );
  } catch (error) {
    failure = error;
  } finally {
    await anonymous?.close();
    await tenantContext?.close();
    if (ownedIds.length) {
      try {
        await call(admin, privateRefs.smoke.cleanupPhase48Acceptance, {
          tenantId,
          projectIds: ownedIds,
          contactEmails: emails,
        });
      } catch (error) {
        failure ??= error;
      }
    }
    if (fixtureRunId && createdRows.length) {
      try {
        const result = await call<{ removed: number }>(
          admin,
          privateRefs.skills.cleanupWebRecipeQualification,
          { qualificationFixtureRunId: fixtureRunId, createdIds: createdRows },
        );
        expect(result.removed).toBe(createdRows.length);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  if (failure) throw failure;
});
