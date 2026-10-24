import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type BrowserContext, expect, type Page, request, test } from "@playwright/test";
import {
  ARTIFACT_QA_APP,
  ARTIFACT_QA_BACKEND,
  ARTIFACT_QA_PRIVATE,
  ARTIFACT_QA_ROOT,
  type ArtifactChatFixture,
  type ArtifactFixture,
  type ArtifactFixtures,
  type ArtifactIdentity,
  artifactType,
  loadArtifactFixtures,
  loadArtifactIdentities,
} from "./workspaceArtifactFixtures";

// Run only with the dedicated workspace-artifacts.config.ts against the disposable local stack.
// No Phase23/48 users, stored sessions, CLI calls, model turns or generation controls are used.
const enabled = process.env.PIKAR_PHASE53_ARTIFACT_QA === "1";
const output = resolve(ARTIFACT_QA_PRIVATE, "browser-qa");
const runFile = promisify(execFile);
let fixtures: ArtifactFixtures;
let identities: Record<"A" | "B", ArtifactIdentity>;
let context: BrowserContext;
let page: Page;
let pageErrors = 0;
const runtimeErrors: string[] = [];
const externalOrigins = new Set<string>();
const observations: Record<string, unknown> = {
  provenance:
    "LOCAL native password auth; dedicated synthetic fixtures; no hosted/provider acceptance",
  checks: [],
};
const passed = (name: string, details: Record<string, unknown> = {}) =>
  (observations.checks as unknown[]).push({ name, passed: true, ...details });
const fileHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const workspace = () => page.getByTestId("artifact-workspace");
const panel = () => workspace().getByRole("tabpanel");

async function nativeSignIn(role: "A" | "B") {
  const identity = identities[role];
  let stage = "NAVIGATE";
  try {
    await page.goto(`${ARTIFACT_QA_APP}/signin`, { waitUntil: "domcontentloaded" });
    stage = "HYDRATED";
    // Next's SSR input is visible before React 19 attaches its controlled-field event props.
    // Observe attachment only; this reads no credential, token or application authority.
    await expect
      .poll(
        () =>
          page
            .getByLabel("Password", { exact: true })
            .evaluate((element) =>
              Object.keys(element).some((key) => key.startsWith("__reactProps")),
            ),
        { timeout: 60_000 },
      )
      .toBe(true);
    stage = "INTERACTIVE";
    // An empty-field toggle proves hydration before entering private controlled values.
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    stage = "FILL";
    await page.getByLabel("Email Address", { exact: true }).fill(identity.email);
    await page.getByLabel("Password", { exact: true }).fill(identity.password);
    expect(
      (await page.getByLabel("Email Address", { exact: true }).inputValue()) === identity.email,
    ).toBe(true);
    expect(
      (await page.getByLabel("Password", { exact: true }).inputValue()) === identity.password,
    ).toBe(true);
    stage = "SUBMIT";
    await page.getByRole("button", { name: /^sign in$/iu }).click();
    stage = "AUTHENTICATED";
    await expect(page.getByRole("button", { name: /^sign out$/iu })).toBeVisible({
      timeout: 60_000,
    });
  } catch {
    observations.nativeAuthFailure = { role, stage };
    writeFileSync(
      resolve(output, "native-auth-stage.json"),
      JSON.stringify(
        {
          role,
          stage,
          pathname: new URL(page.url()).pathname,
          pageErrors,
          externalOrigins: [...externalOrigins],
        },
        null,
        2,
      ),
    );
    await page
      .getByLabel("Password", { exact: true })
      .fill("", { timeout: 1000 })
      .catch(() => {});
    await page
      .getByLabel("Email Address", { exact: true })
      .fill("", { timeout: 1000 })
      .catch(() => {});
    throw new Error(`PHASE53_NATIVE_${role}_${stage}_FAILED`);
  }
}

async function visit(chat: ArtifactChatFixture) {
  await page.goto(
    `${ARTIFACT_QA_APP}/dashboard/workspace?thread=${encodeURIComponent(chat.threadId)}`,
    { waitUntil: "domcontentloaded", timeout: 120_000 },
  );
  const showWork = page.getByRole("button", { name: "Show work", exact: true });
  // SplitPane SSR starts desktop; its existing 48rem media effect mounts this control later.
  if (await page.evaluate(() => window.matchMedia("(max-width: 48rem)").matches)) {
    await expect(showWork).toBeVisible();
    await expect
      .poll(() =>
        showWork.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps")),
        ),
      )
      .toBe(true);
    await showWork.click();
  }
  await expect(workspace()).toBeVisible({ timeout: 60_000 });
  await expect(workspace().getByRole("tab", { name: "Work", exact: true })).toBeVisible();
}

async function open(artifact: ArtifactFixture) {
  const browse = workspace().getByRole("button", { name: "Browse conversation outputs" });
  if ((await browse.getAttribute("aria-expanded")) !== "true") await browse.click();
  const library = workspace().getByRole("complementary", { name: "All conversation outputs" });
  await library.getByRole("textbox", { name: "Find an output" }).fill(artifact.title);
  const choice = library
    .getByRole("button")
    .filter({ has: page.getByText(artifact.title, { exact: true }) });
  for (let attempt = 0; attempt < 20 && !(await choice.count()); attempt++) {
    const older = library.getByRole("button", { name: "Load earlier outputs", exact: true });
    if (!(await older.count())) break;
    await expect(older).toBeEnabled();
    await older.click();
    await expect(library.getByRole("button", { name: "Loading…", exact: true })).toBeHidden();
  }
  await expect(choice).toHaveCount(1);
  await choice.click();
  await expect(workspace().getByRole("tab", { name: artifact.title, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

function primary(type: ReturnType<typeof artifactType>): ArtifactFixture {
  const artifact = fixtures.users.A.chats.primary.artifacts.find(
    (entry) => artifactType(entry) === type,
  );
  if (!artifact) throw new Error(`PHASE53_REQUIRED_FIXTURE_${type.toUpperCase()}`);
  return artifact;
}

function firstArtifact(chat: ArtifactChatFixture): ArtifactFixture {
  const artifact = chat.artifacts[0];
  if (!artifact) throw new Error("PHASE53_REQUIRED_CHAT_ARTIFACT");
  return artifact;
}

async function downloadOriginal(artifact: ArtifactFixture) {
  if (!artifact.sha256 || !artifact.bytes)
    throw new Error("PHASE53_ORIGINAL_HASH_EXPECTATION_REQUIRED");
  const downloaded = page.waitForEvent("download", { timeout: 20_000 });
  await panel().getByRole("button", { name: "Download original", exact: true }).first().click();
  const file = await downloaded.catch(() => {
    throw new Error("PHASE53_ORIGINAL_DID_NOT_DOWNLOAD");
  });
  const path = resolve(output, `original-${artifactType(artifact)}.bin`);
  await file.saveAs(path);
  const bytes = readFileSync(path);
  expect(bytes.byteLength).toBe(artifact.bytes);
  expect(fileHash(bytes)).toBe(artifact.sha256.toLowerCase());
  const expectedExtension =
    artifact.mimeType === "application/pdf" || artifactType(artifact) === "pdf"
      ? ".pdf"
      : artifact.mimeType ===
            "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
          artifactType(artifact) === "presentation"
        ? ".pptx"
        : artifact.mimeType ===
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            artifactType(artifact) === "workbook"
          ? ".xlsx"
          : artifact.mimeType === "image/svg+xml"
            ? ".svg"
            : null;
  if (expectedExtension)
    expect(file.suggestedFilename().toLowerCase()).toMatch(
      new RegExp(`\\${expectedExtension}$`, "u"),
    );
  passed(`original-${artifactType(artifact)}-download`, {
    sha256: fileHash(bytes),
    bytes: bytes.length,
    suggestedFilename: file.suggestedFilename(),
  });
}

async function noOverflow() {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

async function screenshot(name: string) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false });
}

/** Use the skill's own probes inside the native signed-in context; never export authentication. */
async function inspectTaste(width: number) {
  const skill = process.env.PIKAR_PHASE53_TASTE_DIR;
  if (!skill) return;
  const probes = await import(pathToFileURL(resolve(skill, "scripts/lib/probe.mjs")).href);
  const rules = await import(pathToFileURL(resolve(skill, "scripts/lib/rules.mjs")).href);
  const metrics = await page.evaluate(probes.probe);
  const appMetrics = await page.evaluate(probes.app);
  const findings = [
    ...rules
      .judge(metrics, { width, allow: [] })
      .filter(
        (finding: { id: string }) =>
          !rules.APP_SKIP.has(finding.id) &&
          finding.id !== "no-title" &&
          finding.id !== "small-title",
      ),
    ...rules.judgeApp(appMetrics, metrics, { width, allow: [] }),
  ];
  writeFileSync(
    resolve(output, `taste-${width}.json`),
    JSON.stringify(
      {
        width,
        provenance:
          "Official Taste app probes on actual native-auth local page; existing BRAND controls visual direction",
        findings,
      },
      null,
      2,
    ),
  );
}

test.describe("local native-auth artifact workspace", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!enabled, "Explicit local synthetic-fixture opt-in required");
  test.beforeAll(async ({ browser }) => {
    fixtures = loadArtifactFixtures();
    identities = loadArtifactIdentities(fixtures);
    mkdirSync(output, { recursive: true });
    observations.startedAt = new Date().toISOString();
    writeFileSync(resolve(output, "report.json"), JSON.stringify(observations, null, 2));
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: { cookies: [], origins: [] },
    });
    const localOrigin = (raw: string) => {
      const url = new URL(raw);
      if (url.protocol === "data:" || url.protocol === "blob:") return true;
      const origin = url.origin.replace(/^ws/u, "http");
      return [ARTIFACT_QA_APP, ARTIFACT_QA_BACKEND, "http://127.0.0.1:3341"].includes(origin);
    };
    await context.route("**/*", async (route) => {
      if (localOrigin(route.request().url())) await route.continue();
      else {
        externalOrigins.add(new URL(route.request().url()).origin);
        await route.abort("blockedbyclient");
      }
    });
    await context.routeWebSocket(/.*/u, (route) => {
      if (localOrigin(route.url())) route.connectToServer();
      else {
        externalOrigins.add(new URL(route.url()).origin);
        route.close({ code: 1008, reason: "Disposable local fixture target required" });
      }
    });
    page = await context.newPage();
    page.on("pageerror", (error) => {
      pageErrors++;
      // Keep actionable React/runtime diagnostics while suppressing IDs, email, URLs and tokens.
      runtimeErrors.push(
        error.message
          .replace(/https?:\/\/\S+/gu, "[url]")
          .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gu, "[email]")
          .replace(/\b[A-Za-z0-9_-]{24,}\b/gu, "[opaque]")
          .slice(0, 1000),
      );
    });
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (
        url.protocol !== "data:" &&
        url.protocol !== "blob:" &&
        ![ARTIFACT_QA_APP, ARTIFACT_QA_BACKEND, "http://127.0.0.1:3341"].includes(url.origin)
      )
        externalOrigins.add(url.origin);
    });
    await nativeSignIn("A");
  });
  test.afterEach(async () => {
    const info = test.info();
    if (observations.checks) {
      observations.lastTestStatus = info.status;
      observations.pageErrors = pageErrors;
      observations.runtimeErrors = runtimeErrors;
      observations.externalOrigins = [...externalOrigins];
      writeFileSync(resolve(output, "report.json"), JSON.stringify(observations, null, 2));
    }
  });
  test.afterAll(async () => {
    await context?.close();
    observations.finishedAt = new Date().toISOString();
    observations.pageErrors = pageErrors;
    observations.runtimeErrors = runtimeErrors;
    observations.externalOrigins = [...externalOrigins];
    writeFileSync(resolve(output, "report.json"), JSON.stringify(observations, null, 2));
  });

  test("native auth and anonymous refusal precede real owned document controls", async () => {
    const anonymous = await request.newContext();
    try {
      const response = await anonymous.post(`${ARTIFACT_QA_BACKEND}/api/query`, {
        data: {
          path: "workspaceArtifacts:list",
          format: "json",
          args: {
            threadId: fixtures.users.A.chats.primary.threadId,
            stream: "documents",
            paginationOpts: { numItems: 8, cursor: null },
          },
        },
      });
      const result = await response.json();
      expect(result.status).toBe("error");
      expect(result.errorMessage).toContain("UNAUTHENTICATED");
      passed("anonymous-public-query-refused");
    } finally {
      await anonymous.dispose();
    }
    await visit(fixtures.users.A.chats.primary);
    const pdf = primary("pdf");
    await open(pdf);
    const original = panel().getByRole("button", { name: "Original PDF", exact: true });
    // This synthetic PDF deliberately has both a reading twin and original bytes.
    // Wait for selected-document metadata before choosing the actual PDF renderer.
    await expect(original).toBeVisible();
    await original.click();
    await expect(panel().locator("canvas")).toBeVisible({ timeout: 60_000 });
    await expect(panel().getByRole("status")).toBeHidden();
    await expect(panel().locator('[data-pdf-page="1"]')).toContainText(/\S/u);
    await panel().getByRole("button", { name: "Next page", exact: true }).click();
    await expect(panel().locator('[data-pdf-page="2"]')).toBeVisible();
    await expect(panel().getByRole("status")).toBeHidden();
    await panel().getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(panel()).toContainText("125%");
    await panel().getByRole("button", { name: "Fit width", exact: true }).click();
    await expect(panel().getByRole("status")).toBeHidden();
    const selection = await panel()
      .locator('[data-pdf-page="2"]')
      .evaluate((element) => {
        const span = element.querySelector("div span");
        if (!span) return false;
        const range = document.createRange();
        range.selectNodeContents(span);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const selected = Boolean(selection?.toString().trim());
        selection?.removeAllRanges();
        return selected;
      });
    expect(selection).toBe(true);
    await screenshot("native-pdf-reader");
    passed("native-A-original-PDF-pages-text-selection-controls", { pagesExpected: pdf.pages });
    await downloadOriginal(pdf);

    const slides = primary("presentation");
    await open(slides);
    await expect(panel().getByRole("button", { name: "Next slide", exact: true })).toBeVisible();
    await panel().getByRole("button", { name: "Next slide", exact: true }).click();
    await expect(panel()).toContainText(`Slide 2 of ${slides.slides ?? 7}`);
    expect(await panel().locator("iframe").getAttribute("sandbox")).toBe("");
    await screenshot("native-slide-preview");
    await downloadOriginal(slides);

    const workbook = primary("workbook");
    await open(workbook);
    const sheets = panel().getByRole("combobox", { name: "Worksheet" });
    await expect(sheets).toBeVisible();
    expect(await sheets.locator("option").count()).toBeGreaterThan(1);
    await sheets.selectOption({ index: 1 });
    await expect(panel().getByRole("table")).toBeVisible();
    expect(await panel().locator("[contenteditable]").count()).toBe(0);
    await screenshot("native-workbook-preview");
    await downloadOriginal(workbook);
    passed("native-PPTX-and-XLSX-controls");

    const attachment = primary("attachment");
    await open(attachment);
    await downloadOriginal(attachment);
    passed("owned-thread-attachment-original");

    const image = primary("image");
    await open(image);
    const preview = panel().locator("img");
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth > 0))
      .toBe(true);
    await screenshot("native-image-preview");
    await downloadOriginal(image);
    passed("native-owned-image-preview-and-original");
  });

  test("chat-specific tabs close reopen restore and preserve selection when new output arrives", async () => {
    const chat = fixtures.users.A.chats.primary,
      pdf = primary("pdf"),
      workbook = primary("workbook"),
      slides = primary("presentation");
    await open(pdf);
    await workspace()
      .getByRole("button", { name: `Close tab: ${pdf.title}`, exact: true })
      .click();
    await expect(workspace().getByRole("tab", { name: pdf.title, exact: true })).toHaveCount(0);
    await open(pdf);
    if (
      await workspace()
        .getByRole("button", { name: `Close tab: ${slides.title}`, exact: true })
        .count()
    )
      await workspace()
        .getByRole("button", { name: `Close tab: ${slides.title}`, exact: true })
        .click();
    await open(workbook);
    await visit(fixtures.users.A.chats.secondary);
    await open(firstArtifact(fixtures.users.A.chats.secondary));
    await visit(chat);
    await expect(
      workspace().getByRole("tab", { name: workbook.title, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      workspace().getByRole("tab", { name: workbook.title, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(workspace().getByRole("tab", { name: slides.title, exact: true })).toHaveCount(0);
    passed("A-chat-switch-reload-close-reopen");

    const arrivalScript = resolve(ARTIFACT_QA_PRIVATE, "insert-arrival.mjs");
    if (!existsSync(arrivalScript)) throw new Error("PHASE53_LOCAL_ARRIVAL_HELPER_REQUIRED");
    writeFileSync(
      resolve(ARTIFACT_QA_PRIVATE, "arrival.request.json"),
      JSON.stringify({ requested: true, deliberateSelection: true }),
    );
    try {
      await runFile(process.execPath, [arrivalScript], {
        cwd: ARTIFACT_QA_ROOT,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
      });
    } catch {
      throw new Error("PHASE53_LOCAL_ARRIVAL_INSERT_FAILED");
    }
    const arrived = loadArtifactFixtures().arrival;
    if (!arrived.ready || !arrived.key || !arrived.title)
      throw new Error("PHASE53_LOCAL_ARRIVAL_OBSERVATION_REQUIRED");
    await expect(
      workspace().getByRole("button", { name: "Open latest", exact: true }),
    ).toBeVisible();
    await expect(
      workspace().getByRole("tab", { name: workbook.title, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await workspace().getByRole("button", { name: "Open latest", exact: true }).click();
    await expect(
      workspace().getByRole("tab", { name: arrived.title, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    passed("new-server-artifact-keeps-deliberate-selection-until-Open-latest");
  });

  test("forged restored references cannot expose foreign wrong-thread or deleted documents", async () => {
    const chat = fixtures.users.A.chats.primary;
    const wrongThread =
      fixtures.users.A.chats.secondary.artifacts.find(
        (entry) => entry.key === fixtures.attachmentCandidates?.wrongThreadKey,
      ) ?? firstArtifact(fixtures.users.A.chats.secondary);
    const invalid = [
      wrongThread,
      firstArtifact(fixtures.users.B.chats.primary),
      { key: fixtures.deleted.key, title: "Deleted fixture" },
    ];
    for (const artifact of invalid) {
      await page.evaluate(
        ({ owner, thread, key }) => {
          sessionStorage.setItem(
            `pikar.artifact-tabs.v1:${owner}:${thread}`,
            JSON.stringify({
              version: 1,
              open: [key],
              active: key,
              closed: [],
              seen: [key],
              unread: [],
              latestAt: 0,
              followLatest: false,
            }),
          );
        },
        { owner: fixtures.users.A.userId, thread: chat.threadId, key: artifact.key },
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(workspace()).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            ({ owner, thread, key }) => {
              const value = JSON.parse(
                sessionStorage.getItem(`pikar.artifact-tabs.v1:${owner}:${thread}`) ?? "{}",
              );
              return !Array.isArray(value.open) || !value.open.includes(key);
            },
            { owner: fixtures.users.A.userId, thread: chat.threadId, key: artifact.key },
          ),
        )
        .toBe(true);
      await expect(panel()).not.toContainText(artifact.title);
    }
    passed("untrusted-session-reference-refusal-and-pruning", { references: invalid.length });
  });

  test("real batch images video and expanded keyboard controls fit three widths", async () => {
    const campaign = primary("campaign");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      await visit(fixtures.users.A.chats.primary);
      await open(campaign);
      const collection = panel().getByRole("region", { name: `${campaign.title} media batch` });
      await expect(collection).toBeVisible();
      await collection.getByRole("button", { name: "Gallery", exact: true }).click();
      const tiles = collection.getByRole("navigation", { name: "Batch items" });
      expect(await tiles.getByRole("button").count()).toBeGreaterThan(1);
      const videoItem = campaign.items?.find(
        (item) => (item.type ?? item.mediaKind ?? item.kind) === "video",
      );
      if (!videoItem) throw new Error("PHASE53_VIDEO_ITEM_EXPECTATION_REQUIRED");
      if (width === 1440) {
        const imageItem = campaign.items?.find(
          (item) => (item.type ?? item.mediaKind ?? item.kind) === "image",
        );
        if (!imageItem) throw new Error("PHASE53_IMAGE_ITEM_EXPECTATION_REQUIRED");
        await tiles
          .getByRole("button")
          .filter({ has: page.getByText(imageItem.label, { exact: true }) })
          .click();
        // Stage image, not a thumbnail whose request may finish before selected resolution.
        const stageImage = collection.locator("[aria-label$='artifact viewer'] img");
        await expect(stageImage).toBeVisible();
        await expect
          .poll(() =>
            stageImage.evaluate((element) => (element as HTMLImageElement).naturalWidth > 0),
          )
          .toBe(true);
        await downloadOriginal({
          key: campaign.key,
          title: imageItem.label,
          type: "image",
          sha256: imageItem.sha256,
          bytes: imageItem.bytes,
        });
        passed("native-campaign-image-and-original");
      }
      await tiles
        .getByRole("button")
        .filter({ has: page.getByText(videoItem.label, { exact: true }) })
        .click();
      const video = collection.locator("video[controls]");
      await expect(video).toBeVisible();
      await video.evaluate(async (element) => {
        const media = element as HTMLVideoElement;
        media.muted = true;
        await media.play();
      });
      await expect
        .poll(() =>
          video.evaluate(
            (element) =>
              (element as HTMLVideoElement).readyState === 4 &&
              (element as HTMLVideoElement).currentTime > 0.3,
          ),
        )
        .toBe(true);
      expect(
        await video.evaluate((element) => {
          const box = element.getBoundingClientRect(),
            stage = element.parentElement?.getBoundingClientRect();
          return (
            stage &&
            box.height > 0 &&
            box.top >= stage.top - 1 &&
            box.bottom <= stage.bottom + 1 &&
            box.left >= stage.left - 1 &&
            box.right <= stage.right + 1
          );
        }),
      ).toBe(true);
      await video.evaluate((element) => (element as HTMLVideoElement).pause());
      if (width === 1440)
        await downloadOriginal({
          key: campaign.key,
          title: videoItem.label,
          type: "video",
          sha256: videoItem.sha256,
          bytes: videoItem.bytes,
        });
      await noOverflow();
      await screenshot(`native-batch-video-${width}`);
      await inspectTaste(width);
      passed("native-batch-video-fitted-controls", { width });
      await workspace().getByRole("button", { name: "Expand workspace", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Expanded artifact workspace" });
      await expect(dialog).toBeVisible();
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true);
      const controls = dialog.locator(
        'button:visible:not(:disabled):not([tabindex="-1"]),a[href]:visible:not([tabindex="-1"]),input:visible:not(:disabled):not([tabindex="-1"]),select:visible:not(:disabled):not([tabindex="-1"]),[tabindex="0"]:visible',
      );
      const first = controls.first(),
        last = controls.last();
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(last).toBeFocused();
      await last.focus();
      await page.keyboard.press("Tab");
      await expect(first).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(
        workspace().getByRole("button", { name: "Expand workspace", exact: true }),
      ).toBeFocused();
      passed("expanded-keyboard-focus-restoration", { width });
    }
  });

  test("fresh B sign-in cannot restore A tabs and A restores its own selection", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await visit(fixtures.users.A.chats.primary);
    const workbook = primary("workbook");
    await open(workbook);
    await page.getByRole("button", { name: /^sign out$/iu }).click();
    await expect(page.getByRole("button", { name: /^sign out$/iu })).toBeHidden();
    await nativeSignIn("B");
    await visit(fixtures.users.B.chats.primary);
    await open(firstArtifact(fixtures.users.B.chats.primary));
    await expect(workspace()).not.toContainText(workbook.title);
    await page.getByRole("button", { name: /^sign out$/iu }).click();
    await expect(page.getByRole("button", { name: /^sign out$/iu })).toBeHidden();
    await nativeSignIn("A");
    await visit(fixtures.users.A.chats.primary);
    await expect(
      workspace().getByRole("tab", { name: workbook.title, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(workspace()).not.toContainText(
      firstArtifact(fixtures.users.B.chats.primary).title,
    );
    expect([...externalOrigins]).toEqual([]);
    expect(pageErrors).toBe(0);
    passed("fresh-native-account-partition-and-A-restore");
  });
});
