import { createHash } from "node:crypto";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";

// Deliberately no auth extraction, operator CLI, model call, send, account provisioning or traces.
// Run with --no-deps --workers=1 and an actual browser-exported private storageState.
// Required private fixture inputs are an exact synthetic Vault ID + known original SHA256,
// and an explicitly retained @example.test contact. Never pick the first real Vault/contact row.
test.describe.configure({ mode: "serial", retries: 0 });
test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  storageState: process.env.PIKAR_E2E_STORAGE_STATE ?? { cookies: [], origins: [] },
});
const enabled = process.env.PIKAR_MARKETING_UAT === "1";
const artifactId = process.env.PIKAR_MARKETING_ARTIFACT_ID;
const expectedHash = process.env.PIKAR_MARKETING_ARTIFACT_SHA256;
const leadEmail = process.env.PIKAR_MARKETING_LEAD_EMAIL;
const marketing = "/dashboard/marketing";

async function clearPrivatePage(page: Page) {
  try {
    await page.goto("about:blank", { timeout: 5_000 });
  } catch {
    // Error-context snapshots are independent of screenshot/trace settings. Scrub DOM before
    // closing if navigation failed; neither cleanup failures nor their URLs are rethrown.
    try {
      await page.evaluate(() => document.body.replaceChildren());
    } catch {
      /* best effort */
    }
    try {
      await page.close();
    } catch {
      /* best effort */
    }
  }
}

function prerequisites() {
  test.skip(
    !enabled,
    "Set PIKAR_MARKETING_UAT=1 only after the qualified backend and UI are deployed.",
  );
  test.skip(
    !process.env.PIKAR_E2E_STORAGE_STATE,
    "A private storageState exported from the existing signed-in browser is required; no owner provisioning or JWT extraction.",
  );
  if (process.env.PIKAR_E2E_PROVISION === "1")
    throw new Error("Marketing acceptance forbids account provisioning.");
}
async function openMarketing(page: Page) {
  await page.goto(marketing);
  await expect(
    page.getByRole("heading", { name: "Build reach with a clear next step" }),
  ).toBeVisible();
}
async function counts(row: Locator): Promise<number[]> {
  const text = await row.innerText();
  const match = /Visits: (\d+) · Claims: (\d+) · Downloads: (\d+)/.exec(text);
  if (!match) throw new Error("Tracked link did not expose three known integer counts.");
  return match.slice(1).map(Number);
}
async function checkLayout(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await openMarketing(page);
  const gmail = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Gmail", exact: true }) });
  await expect(gmail).toContainText(/Connected|Connect Gmail|Google OAuth is not configured/);
  for (const name of ["Meta/Instagram", "LinkedIn", "TikTok", "X", "YouTube"]) {
    const channel = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(channel).toContainText("legal entity is not formed");
    await expect(channel).toContainText(
      "provider suitability and permissions review has not started",
    );
    await expect(channel.getByRole("button")).toHaveCount(0);
  }
  await expect(page.getByText("Social publishing is unavailable.", { exact: false })).toBeVisible();
  const title = page.getByLabel("Link title", { exact: true });
  await title.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Source", { exact: true })).toBeFocused();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(
    fits,
    "The document should fit the viewport; internal scrollers may remain reachable.",
  ).toBe(true);
}

// HTTP failures are replaced with closed errors: never print a secret request URL or Location.
async function publicRequest(context: APIRequestContext, url: string, method = "GET") {
  try {
    const response = await context.fetch(url, { method, maxRedirects: 0, timeout: 30_000 });
    return { status: response.status(), headers: response.headers(), bytes: await response.body() };
  } catch {
    throw new Error("Anonymous fixture request failed; secret URL withheld.");
  }
}
async function deactivateOwned(page: Page, title: string) {
  await openMarketing(page);
  const row = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(row).toBeVisible();
  if (await row.getByRole("button", { name: "Deactivate", exact: true }).count()) {
    await row.getByRole("button", { name: "Deactivate", exact: true }).click();
    await row.getByRole("button", { name: "Confirm deactivation", exact: true }).click();
  }
  await expect(row).toContainText("deactivated");
  return row;
}

test("Marketing dark route is reachable with desktop and mobile keyboard controls", async ({
  page,
}) => {
  prerequisites();
  try {
    await checkLayout(page, 1440);
    await checkLayout(page, 390);
  } finally {
    await clearPrivatePage(page);
  }
});

test("isolated public stages preserve original bytes and aggregate attribution, then deactivate", async ({
  page,
  playwright,
}) => {
  prerequisites();
  test.skip(
    !artifactId || !expectedHash,
    "Supply the exact disposable stored artifact ID and its independently known SHA256; no arbitrary Vault selection or paid upload.",
  );
  if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? ""))
    throw new Error("Fixture SHA256 must be a 64-character hexadecimal digest.");
  test.setTimeout(180_000);
  const title = `Marketing UAT ${Date.now()}`;
  const source = `uat-${Date.now()}`;
  let creationAttempted = false;
  const urls: string[] = [];
  try {
    await openMarketing(page);
    const picker = page.getByLabel("Original Vault file", { exact: true });
    await expect(page.getByText("Loading files…", { exact: true })).toHaveCount(0);
    let found = false;
    for (let i = 0; i < 100; i++) {
      found = await picker
        .locator("option")
        .evaluateAll(
          (options, wanted) =>
            options.some((option) => (option as HTMLOptionElement).value === wanted),
          artifactId,
        );
      if (found) break;
      const more = page.getByRole("button", { name: "Load more files", exact: true });
      if (!(await more.count())) break;
      await more.click();
      await expect(page.getByText("Loading more files…", { exact: true })).toHaveCount(0);
    }
    // A supplied fixture that is missing is a failure, not an environment skip after assertions.
    expect(found, "The explicitly supplied stored fixture must be downloadable.").toBe(true);
    await picker.selectOption(artifactId ?? "");
    await page.getByLabel("Link title", { exact: true }).fill(title);
    await page.getByLabel("Source", { exact: true }).fill(source);
    creationAttempted = true;
    await page.getByRole("button", { name: "Create tracked link", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Copy these links now" })).toBeVisible();
    for (const stage of ["visit", "claim", "download"])
      urls.push(await page.getByLabel(stage, { exact: true }).inputValue());
    // Clear the secret-bearing panel before any HTTP assertion or automatic failure snapshot.
    await page.getByRole("button", { name: "Close links", exact: true }).click();
    await expect(page.locator("input[readonly]")).toHaveCount(0);
    let row = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect.poll(() => counts(row)).toEqual([0, 0, 0]);
    let locationHash: string | undefined;
    for (const [index, url] of urls.entries()) {
      // A NEW empty request context for each stage: no browser cookies, localStorage or auth header.
      const anonymous = await playwright.request.newContext({
        storageState: { cookies: [], origins: [] },
      });
      try {
        expect((await anonymous.storageState()).cookies.length).toBe(0);
        const response = await publicRequest(anonymous, url);
        expect(response.status).toBe(302);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["referrer-policy"]).toBe("no-referrer");
        expect(response.headers["set-cookie"] === undefined).toBe(true);
        expect(response.bytes.length).toBe(0);
        const location = response.headers.location;
        expect(Boolean(location), "Redirect must identify the original stored artifact.").toBe(
          true,
        );
        if (!location) throw new Error("Stored artifact redirect missing.");
        const hash = createHash("sha256").update(location).digest("hex");
        if (locationHash)
          expect(hash === locationHash, "All stages must redirect to the same stored file.").toBe(
            true,
          );
        locationHash = hash;
        const file = await publicRequest(anonymous, location);
        expect(file.status).toBe(200);
        expect(
          createHash("sha256").update(file.bytes).digest("hex") === expectedHash?.toLowerCase(),
          "Downloaded bytes must match the independently supplied original fixture hash.",
        ).toBe(true);
        await expect
          .poll(() => counts(row))
          .toEqual([0, 1, 2].map((position) => (position <= index ? 1 : 0)));
      } finally {
        await anonymous.dispose();
      }
    }
    const anonymous = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    try {
      const visit = urls[0];
      if (!visit) throw new Error("Fixture visit URL missing.");
      expect((await publicRequest(anonymous, visit, "HEAD")).status).toBe(405);
      await expect.poll(() => counts(row)).toEqual([1, 1, 1]);
      const tampered = new URL(visit);
      tampered.searchParams.set("s", "different-source");
      expect((await publicRequest(anonymous, tampered.href)).status).toBe(302);
      await expect.poll(() => counts(row)).toEqual([2, 1, 1]);
      await expect(row).toContainText(`Source: ${source}`);
      row = await deactivateOwned(page, title);
      for (const url of urls) {
        const response = await publicRequest(anonymous, url);
        expect(response.status).toBe(404);
        expect(response.bytes.length).toBe(0);
        expect(response.headers.location === undefined).toBe(true);
      }
      await expect.poll(() => counts(row)).toEqual([2, 1, 1]);
    } finally {
      await anonymous.dispose();
    }
  } finally {
    // Even an ambiguous creation attempt is checked by its unique synthetic title; no retry.
    try {
      if (creationAttempted) await deactivateOwned(page, title);
    } finally {
      urls.length = 0;
      await clearPrivatePage(page);
    }
  }
});

test("explicit retained synthetic lead keeps provenance and suppression after capture", async ({
  page,
}) => {
  prerequisites();
  test.skip(
    !leadEmail,
    "Supply an exact retained synthetic PIKAR_MARKETING_LEAD_EMAIL fixture; Contacts has no delete seam.",
  );
  if (!/^marketing-uat-[a-z0-9-]+@example\.test$/.test(leadEmail ?? ""))
    throw new Error(
      "Lead fixture must use the controlled marketing-uat- prefix and example.test domain.",
    );
  try {
    // Read exact fixture before writing. Setup prepares this one contact and suppression through
    // existing native UI/APIs; no real contact is selected or suppressed by this test.
    await page.goto("/dashboard/pipeline");
    const contact = page.getByTestId("pipeline-contact-row").filter({ hasText: leadEmail });
    await expect(contact).toHaveCount(1);
    await expect(contact).toContainText("You added them");
    await expect(contact.getByTestId("contact-unsuppress-arm")).toBeVisible();
    await openMarketing(page);
    await page.getByLabel("Email", { exact: true }).fill(leadEmail ?? "");
    await expect(
      page.getByRole("checkbox", { name: "I have explicit email consent to record" }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Record lead", exact: true }).click();
    await expect(
      page.getByText("Suppressed: outbound email remains blocked.", { exact: true }),
    ).toBeVisible();
    await page.goto("/dashboard/pipeline");
    await expect(contact).toHaveCount(1);
    await expect(contact).toContainText("You added them");
    await expect(contact.getByTestId("contact-unsuppress-arm")).toBeVisible();
  } finally {
    await clearPrivatePage(page);
  }
  // Intentionally retained: never unsuppress or delete a tenant to fake fixture cleanup.
});
