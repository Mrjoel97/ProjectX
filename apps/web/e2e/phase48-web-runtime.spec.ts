import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { internal } from "@pikar/backend/api";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

// Repository/local qualification only. This matrix uses the real authenticated editor, the
// anonymous Convex HTTP boundary and internal, local-only fixture seams. It never contacts a
// provider, custom domain, mailbox or model and never manufactures Wave 7/8 acceptance.
test.describe.configure({ mode: "serial", retries: 0 });
test.setTimeout(300_000);

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const disposable = process.env.PIKAR_PHASE48_DISPOSABLE === "1";
const publicOrigin = process.env.PIKAR_PHASE48_PUBLIC_ORIGIN ?? "http://127.0.0.1:3211";
const runId = Date.now().toString(36);
const acceptedEmail = `phase48-${runId}@example.test`;
const suppressedEmail = `phase48-suppressed-${runId}@example.test`;

type ProjectEvidence = {
  id: string;
  slug: string;
  publicHost: string;
  publishedVersion?: number;
  publishedContentHash?: string;
};
type AcceptanceEvidence = {
  projects: ProjectEvidence[];
  versions: Array<{
    projectId: string;
    version: number;
    contentHash: string;
    artifacts: Array<{ pageSlug: string; byteLength: number; html: string }>;
  }>;
  metrics: Array<{ projectId: string; version: number; kind: string; count: number }>;
  submissions: Array<{
    projectId: string;
    outcome: string;
    attribution?: { source?: string; medium?: string; campaign?: string };
  }>;
};

const disposableRoot = process.env.PIKAR_PHASE48_DISPOSABLE_ROOT;
const disposableConfig = process.env.PIKAR_PHASE48_FIXTURE_CONFIG;
if (
  disposable &&
  (process.env.PIKAR_PHASE49_QUALIFICATION !== "1" ||
    process.env.PIKAR_PHASE49_DISPOSABLE !== "1" ||
    !disposableRoot ||
    !disposableConfig ||
    !isAbsolute(disposableRoot) ||
    !isAbsolute(disposableConfig) ||
    resolve(disposableConfig) !== resolve(disposableRoot, "config.json"))
)
  throw new Error("Phase 48 disposable fixture must be the owned isolated stack");
const localConfig = JSON.parse(
  readFileSync(
    disposable ? disposableConfig! : resolve(backendDir, ".convex/local/default/config.json"),
    "utf8",
  ),
) as { adminKey: string; ports: { cloud: number; site: number } };
if (new URL(publicOrigin).port !== String(localConfig.ports.site))
  throw new Error("Phase 48 public origin does not match the selected isolated local deployment.");
if (
  disposable &&
  (new URL(publicOrigin).origin !== `http://127.0.0.1:${localConfig.ports.site}` ||
    process.env.PIKAR_PHASE49_BACKEND_URL !== `http://127.0.0.1:${localConfig.ports.cloud}`)
)
  throw new Error("Phase 48 disposable fixture origins disagree");
const fixtures = new ConvexHttpClient(`http://127.0.0.1:${localConfig.ports.cloud}`);
(fixtures as ConvexHttpClient & { setAdminAuth(token: string): void }).setAdminAuth(
  localConfig.adminKey,
);
const fixtureMutation = <T>(reference: unknown, args: unknown) =>
  fixtures.mutation(reference as FunctionReference<"mutation">, args as never) as Promise<T>;
const fixtureQuery = <T>(reference: unknown, args: unknown) =>
  fixtures.query(reference as FunctionReference<"query">, args as never) as Promise<T>;

async function signIn(page: Page) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) throw new Error("Phase 48 requires the disposable local E2E identity.");
  await page.goto("/signin");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

async function tenantIdOf(page: Page): Promise<string> {
  const jwt = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  const payload = jwt?.split(".")[1];
  if (!payload) throw new Error("Phase 48 storage state has no Convex JWT.");
  const subject = (
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string }
  ).sub;
  if (!subject) throw new Error("Phase 48 JWT has no stable subject.");
  return subject.split("|")[0] ?? subject;
}

function documentFor(kind: "site" | "landing", slug: string, revision: string) {
  return {
    kind,
    title: `${kind} ${revision}`,
    brand: { name: "Pikar AI" },
    navigation: kind === "site" ? [{ label: "About", path: `/p/${slug}/about` }] : [],
    pages: [
      {
        slug: "home",
        title: `Home ${revision}`,
        description: `Phase 48 ${kind} ${revision}`,
        nodes: [
          {
            kind: "hero",
            eyebrow: "LOCAL ACCEPTANCE",
            heading: `${kind} ${revision}`,
            body: "Exact immutable runtime bytes.",
          },
          {
            kind: "cta",
            id: "learn",
            label: "Continue locally",
            target: { kind: "local", path: `/p/${slug}/home` },
            analytics: true,
          },
          {
            kind: "form",
            id: "contact",
            heading: "Contact",
            fields: ["email", "name", "company"],
            consent: "I agree to hear from Pikar AI.",
            attribution: { source: "phase48", medium: "browser", campaign: revision },
          },
        ],
      },
      ...(kind === "site"
        ? [
            {
              slug: "about",
              title: "About",
              description: "About this controlled site",
              nodes: [
                {
                  kind: "section",
                  id: "about",
                  heading: "About",
                  children: [{ kind: "text", text: `About ${revision}` }],
                },
              ],
            },
          ]
        : []),
    ],
    footer: { kind: "footer", text: "Built with Pikar AI" },
  };
}

async function createProject(page: Page, kind: "site" | "landing") {
  await page.goto("/dashboard/sites");
  await page
    .getByRole("button", { name: kind === "site" ? "Create site" : "Create landing page" })
    .click();
  await page.waitForURL(/\/dashboard\/sites\?project=/);
  const projectId = new URL(page.url()).searchParams.get("project");
  if (!projectId) throw new Error("created project URL has no id");
  const article = page.getByRole("link", { name: "Editing" }).locator("xpath=ancestor::article");
  const meta = await article.locator("p").textContent();
  const slug = /^\/([^\s]+)/.exec(meta ?? "")?.[1];
  if (!slug) throw new Error("created project has no visible slug");
  return { projectId, slug };
}

const editorStatus = (page: Page) =>
  page.locator('section[aria-labelledby="editor-heading"]').getByRole("status");

async function saveApprovePublish(page: Page, projectId: string, document: unknown) {
  await page.getByLabel("Structured content JSON").fill(JSON.stringify(document, null, 2));
  await page.getByRole("button", { name: "Save draft" }).click();
  try {
    await expect(editorStatus(page)).toContainText("Draft saved");
  } catch {
    const category = (await editorStatus(page).textContent())
      ?.replace(/[^a-zA-Z0-9 .:-]/g, "")
      .slice(0, 160);
    throw new Error(`Phase 48 draft refusal: ${category ?? "missing status"}`);
  }
  await page.getByRole("button", { name: "Approve exact version" }).click();
  await expect(editorStatus(page)).toContainText("Version approved");
  await page.getByRole("button", { name: /^Publish$/ }).click();
  await expect(editorStatus(page)).toContainText("Published on the Pikar platform path");
  await expect(page.getByText(/Hosting: Pikar platform path/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`));
}

async function postForm(
  context: BrowserContext,
  slug: string,
  data: Record<string, string>,
  key: string,
  abuse: string,
) {
  return context.request.post(`${publicOrigin}/p/${slug}/home/forms/contact`, {
    form: data,
    headers: { "Idempotency-Key": key, "X-Forwarded-For": abuse },
    maxRedirects: 0,
  });
}

test("Phase 48 exact local web runtime: author, publish, isolate, activate, recover and clean up", async ({
  page,
  browser,
}) => {
  const projectIds: string[] = [];
  let tenantId = "";
  let anonymous: BrowserContext | undefined;
  let failure: unknown;
  try {
    if (disposable) {
      const email = `phase48-${randomUUID()}@example.test`;
      const password = `Pikar-${randomUUID()}-test`;
      const invite = await fixtureMutation<{ code: string }>(internal.invites.__seedInvite, {
        email,
      });
      await page.goto(`/signup?invite=${invite.code}`);
      await page.getByPlaceholder("John Doe").fill("Phase 48 Tenant");
      await page.getByPlaceholder("name@company.com").fill(email);
      await page.getByPlaceholder("Create a password").fill(password);
      await page.getByPlaceholder("Confirm password").fill(password);
      await page.getByRole("button", { name: /Create Account/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 30_000 });
      const found = await fixtureQuery<{ result: { userId: string } | null }>(
        internal.owner.findUserIdByEmailForProvisioning,
        { email },
      );
      if (!found.result?.userId) throw new Error("Phase 48 disposable account subject missing");
      await fixtureMutation(internal.onboarding.__seedOnboardedTenant, {
        tenantId: found.result.userId,
      });
      process.env.E2E_USER_EMAIL = email;
      process.env.E2E_USER_PASSWORD = password;
    }
    await page.goto("/dashboard/sites");
    tenantId = await tenantIdOf(page);

    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("heading", { name: "Publish a focused page" })).toBeVisible();
      expect(
        await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    const landing = await createProject(page, "landing");
    projectIds.push(landing.projectId);
    await saveApprovePublish(page, landing.projectId, documentFor("landing", landing.slug, "v1"));

    const site = await createProject(page, "site");
    projectIds.push(site.projectId);
    await saveApprovePublish(page, site.projectId, documentFor("site", site.slug, "v1"));

    anonymous = await browser.newContext({
      baseURL: publicOrigin,
      storageState: { cookies: [], origins: [] },
    });
    const publicPage = await anonymous.newPage();
    for (const target of [landing, site]) {
      const response = await publicPage.goto(`${publicOrigin}/p/${target.slug}/home`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["cache-control"]).toBe("no-store");
      expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
      expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response?.headers()["x-pikar-hosting"]).toBe("pikar_platform_path");
      expect(response?.headers()["x-pikar-source"]).toBe("tenant_structured_content");
      await expect(
        publicPage.getByRole("heading", { name: `${target === site ? "site" : "landing"} v1` }),
      ).toBeVisible();
      await publicPage.setViewportSize({ width: 390, height: 844 });
      expect(
        await publicPage.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    const about = await publicPage.goto(`${publicOrigin}/p/${site.slug}/about`);
    expect(about?.status()).toBe(200);
    await expect(publicPage.getByText("About v1", { exact: true })).toBeVisible();

    // Activate the CTA exactly as rendered; no direct /cta request is made by this test.
    await publicPage.goto(`${publicOrigin}/p/${landing.slug}/home`);
    await publicPage.getByRole("button", { name: "Continue locally" }).click();
    await publicPage.waitForURL(`${publicOrigin}/p/${landing.slug}/home`);

    const accepted = await postForm(
      anonymous,
      landing.slug,
      { email: acceptedEmail, name: "Local Lead", company: "Example", consent: "on" },
      "accepted-1",
      "198.51.100.10",
    );
    expect(accepted.status()).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ ok: true, outcome: "accepted" });
    const duplicate = await postForm(
      anonymous,
      landing.slug,
      { email: acceptedEmail, name: "Local Lead", company: "Example", consent: "on" },
      "accepted-1",
      "198.51.100.10",
    );
    await expect(duplicate.json()).resolves.toEqual({ ok: true, outcome: "duplicate" });
    expect(
      (
        await postForm(anonymous, landing.slug, { email: "invalid" }, "invalid-1", "198.51.100.11")
      ).status(),
    ).toBe(400);
    const consent = await postForm(
      anonymous,
      landing.slug,
      { email: `phase48-consent-${runId}@example.test` },
      "consent-1",
      "198.51.100.12",
    );
    await expect(consent.json()).resolves.toEqual({ ok: false, outcome: "consent_required" });

    await fixtureMutation(internal.smoke.seedPhase48Suppression, {
      tenantId,
      email: suppressedEmail,
    });
    const suppressed = await postForm(
      anonymous,
      landing.slug,
      { email: suppressedEmail, consent: "on" },
      "suppressed-1",
      "198.51.100.13",
    );
    await expect(suppressed.json()).resolves.toEqual({ ok: false, outcome: "suppressed" });
    for (let index = 0; index < 5; index += 1) {
      const response = await postForm(
        anonymous,
        landing.slug,
        { email: `phase48-rate-${runId}-${index}@example.test`, consent: "on" },
        `rate-${index}`,
        "198.51.100.14",
      );
      expect(response.status()).toBe(200);
    }
    const limited = await postForm(
      anonymous,
      landing.slug,
      { email: `phase48-rate-${runId}-limited@example.test`, consent: "on" },
      "rate-limited",
      "198.51.100.14",
    );
    expect(limited.status()).toBe(429);

    // A stale editor refuses its write while public bytes remain the last exact published artifact.
    await signIn(page); // the local fixture CLI call above can expire the browser session
    await page.goto(`/dashboard/sites?project=${landing.projectId}`);
    const staleContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: await page.context().storageState(),
    });
    const stale = await staleContext.newPage();
    await stale.goto(`/dashboard/sites?project=${landing.projectId}`);
    await page
      .getByLabel("Structured content JSON")
      .fill(JSON.stringify(documentFor("landing", landing.slug, "v2")));
    await stale
      .getByLabel("Structured content JSON")
      .fill(JSON.stringify(documentFor("landing", landing.slug, "v2")));
    await Promise.all([
      page.getByRole("button", { name: "Save draft" }).click(),
      stale.getByRole("button", { name: "Save draft" }).click(),
    ]);
    const notices = async () =>
      (
        await Promise.all([editorStatus(page).textContent(), editorStatus(stale).textContent()])
      ).join(" ");
    await expect.poll(notices).toContain("Draft saved");
    await expect.poll(notices).toContain("stale");
    await staleContext.close();
    await page.reload();
    const stillV1 = await anonymous.request.get(`${publicOrigin}/p/${landing.slug}/home`);
    expect(await stillV1.text()).toContain("landing v1");

    await page.getByRole("button", { name: "Approve exact version" }).click();
    await expect(editorStatus(page)).toContainText("Version approved");
    await page.getByRole("button", { name: "Publish update" }).click();
    await expect(editorStatus(page)).toContainText("Published version updated");

    const collision = await fixtureMutation<{ projectId: string; publicHost: string }>(
      internal.smoke.seedPhase48Collision,
      { tenantId, slug: landing.slug },
    );
    projectIds.push(collision.projectId);
    const bindings = await fixtureQuery<AcceptanceEvidence>(
      internal.smoke.inspectPhase48Acceptance,
      { tenantId, projectIds: [landing.projectId, collision.projectId] },
    );
    expect(bindings.projects).toHaveLength(2);
    expect(new Set(bindings.projects.map((item) => `${item.publicHost}/${item.slug}`)).size).toBe(
      1,
    );
    await signIn(page);
    await page.goto(`/dashboard/sites?project=${landing.projectId}`);
    await page
      .getByLabel("Structured content JSON")
      .fill(JSON.stringify(documentFor("landing", landing.slug, "collision-refused")));
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(editorStatus(page)).toContainText("Draft saved");
    await page.getByRole("button", { name: "Approve exact version" }).click();
    await page.getByRole("button", { name: "Publish update" }).click();
    await expect(editorStatus(page)).toContainText("refused");
    expect((await anonymous.request.get(`${publicOrigin}/p/${landing.slug}/home`)).status()).toBe(
      404,
    );

    await fixtureMutation(internal.smoke.cleanupPhase48Collision, { tenantId, slug: landing.slug });
    projectIds.pop();
    expect(
      await (await anonymous.request.get(`${publicOrigin}/p/${landing.slug}/home`)).text(),
    ).toContain("landing v2");
    await signIn(page);
    await page.goto(`/dashboard/sites?project=${landing.projectId}`);
    await page.getByRole("button", { name: "Publish update" }).click();
    await expect(editorStatus(page)).toContainText("Published version updated");

    // Rollback is tied to a prior exact hash, then unpublish/refusal and explicit recovery.
    await page.getByRole("button", { name: "Approve v2" }).click();
    await expect(editorStatus(page)).toContainText("approved for rollback");
    await page.getByRole("button", { name: "Rollback to v2" }).click();
    await expect(editorStatus(page)).toContainText("Rolled back to exact version 2");
    expect(
      await (await anonymous.request.get(`${publicOrigin}/p/${landing.slug}/home`)).text(),
    ).toContain("landing v1");
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(editorStatus(page)).toContainText("unpublished");
    expect((await anonymous.request.get(`${publicOrigin}/p/${landing.slug}/home`)).status()).toBe(
      404,
    );
    await page.getByRole("button", { name: "Rollback to v2" }).click();
    await expect(editorStatus(page)).toContainText("Rolled back");

    const evidence = await fixtureQuery<AcceptanceEvidence>(
      internal.smoke.inspectPhase48Acceptance,
      { tenantId, projectIds },
    );
    const landingProject = evidence.projects.find((item) => item.id === landing.projectId);
    const published = evidence.versions.find(
      (item) =>
        item.projectId === landing.projectId && item.version === landingProject?.publishedVersion,
    );
    const runtime = await anonymous.request.get(`${publicOrigin}/p/${landing.slug}/home`);
    expect(await runtime.text()).toBe(
      published?.artifacts.find((item) => item.pageSlug === "home")?.html,
    );
    expect(landingProject?.publishedContentHash).toBe(published?.contentHash);
    expect(evidence.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: landing.projectId, kind: "page_view" }),
        expect.objectContaining({ projectId: landing.projectId, kind: "cta_click" }),
        expect.objectContaining({ projectId: landing.projectId, kind: "form_accepted" }),
        expect.objectContaining({ projectId: landing.projectId, kind: "form_rejected" }),
      ]),
    );
    expect(evidence.submissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "accepted",
          attribution: { source: "phase48", medium: "browser", campaign: "v1" },
        }),
        expect.objectContaining({ outcome: "consent_required" }),
        expect.objectContaining({ outcome: "suppressed" }),
      ]),
    );

    await fixtureMutation(internal.smoke.expirePhase48SubmissionWindows, {
      tenantId,
      projectId: landing.projectId,
    });
    await fixtureMutation(internal.webForms.cleanup, { tenantId });
    const cleaned = await fixtureQuery<AcceptanceEvidence>(
      internal.smoke.inspectPhase48Acceptance,
      { tenantId, projectIds },
    );
    expect(cleaned.submissions.filter((item) => item.projectId === landing.projectId)).toEqual([]);
  } catch (error) {
    failure = error;
  } finally {
    await anonymous?.close();
    if (tenantId && projectIds.length) {
      try {
        await fixtureMutation(internal.smoke.cleanupPhase48Acceptance, {
          tenantId,
          projectIds,
          contactEmails: [
            acceptedEmail,
            suppressedEmail,
            ...Array.from(
              { length: 5 },
              (_, index) => `phase48-rate-${runId}-${index}@example.test`,
            ),
          ],
        });
      } catch (cleanupError) {
        failure ??= cleanupError;
      }
    }
  }
  if (failure) throw failure;
});
