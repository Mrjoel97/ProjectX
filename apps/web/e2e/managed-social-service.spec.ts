import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type BrowserContext,
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

// Attended, local-draft-only browser protocol. No agent start, provider refresh, publication,
// account provisioning, fixture seeding or qualification writer is implemented here. Generation,
// exact-content human approval, native receipts and the two recurring occurrences remain separate
// live checkpoints. Discovery and these draft controls cannot certify the complete service.
// Execute only with --no-deps --workers=1 --retries=0 and separately authorized private auth.
// PIKAR_SOCIAL_BROWSER_PACKET points to private JSON; its exact bytes must match
// PIKAR_SOCIAL_BROWSER_PACKET_SHA256. Do not check content/auth packets into the repository.
type RowPin = { postId: string; textSha256: string };
type Packet = {
  schema: "social-draft-browser.v1";
  origin: string;
  edit: RowPin & { revisedText: string };
  reject: RowPin;
  recovery: RowPin & { replacementCampaign: string; revisedText: string };
  unknown: RowPin;
};
const enabled = process.env.PIKAR_SOCIAL_BROWSER_ACCEPTANCE === "1";
let packet: Packet;
let context: BrowserContext | undefined;
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function demand(ok: unknown): asserts ok {
  if (!ok) throw new Error("SOCIAL_BROWSER_PACKET_INVALID");
}
function rowPin(value: unknown): value is RowPin & Record<string, unknown> {
  return (
    record(value) &&
    typeof value.postId === "string" &&
    /^[a-z0-9]{20,64}$/.test(value.postId) &&
    typeof value.textSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.textSha256)
  );
}
function readPacket(baseURL: string | undefined): Packet {
  demand(process.env.PIKAR_E2E_PROVISION !== "1" && process.env.PIKAR_E2E_STORAGE_STATE);
  const file = process.env.PIKAR_SOCIAL_BROWSER_PACKET;
  const hash = process.env.PIKAR_SOCIAL_BROWSER_PACKET_SHA256;
  demand(file && hash && /^[a-f0-9]{64}$/.test(hash));
  let raw: Buffer;
  let value: unknown;
  try {
    raw = readFileSync(file);
    demand(raw.byteLength <= 32_768 && sha(raw) === hash);
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("SOCIAL_BROWSER_PACKET_INVALID");
  }
  demand(record(value) && value.schema === "social-draft-browser.v1");
  demand(typeof value.origin === "string" && baseURL === value.origin);
  let origin: URL;
  try {
    origin = new URL(value.origin);
  } catch {
    throw new Error("SOCIAL_BROWSER_PACKET_INVALID");
  }
  demand(origin.origin === value.origin && !origin.username && !origin.password);
  demand(
    origin.protocol === "https:" ||
      (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname)),
  );
  demand(
    rowPin(value.edit) && rowPin(value.reject) && rowPin(value.recovery) && rowPin(value.unknown),
  );
  demand(
    new Set([value.edit.postId, value.reject.postId, value.recovery.postId, value.unknown.postId])
      .size === 4,
  );
  demand(record(value.edit) && record(value.recovery));
  for (const input of [value.edit.revisedText, value.recovery.revisedText])
    demand(typeof input === "string" && input.trim().length > 0 && input.length <= 10_000);
  demand(
    typeof value.edit.revisedText === "string" &&
      sha(value.edit.revisedText) !== value.edit.textSha256,
  );
  demand(typeof value.recovery.revisedText === "string");
  demand(
    typeof value.recovery.replacementCampaign === "string" &&
      /^SOCIAL-BROWSER-[A-Za-z0-9_-]{8,80}$/.test(value.recovery.replacementCampaign),
  );
  // Unknown extra keys never create new browser authority.
  demand(Object.keys(value).sort().join() === "edit,origin,recovery,reject,schema,unknown");
  demand(Object.keys(value.edit).sort().join() === "postId,revisedText,textSha256");
  demand(Object.keys(value.reject).sort().join() === "postId,textSha256");
  demand(
    Object.keys(value.recovery).sort().join() ===
      "postId,replacementCampaign,revisedText,textSha256",
  );
  demand(Object.keys(value.unknown).sort().join() === "postId,textSha256");
  return {
    schema: "social-draft-browser.v1",
    origin: value.origin,
    edit: {
      postId: value.edit.postId,
      textSha256: value.edit.textSha256,
      revisedText: value.edit.revisedText,
    },
    reject: { postId: value.reject.postId, textSha256: value.reject.textSha256 },
    recovery: {
      postId: value.recovery.postId,
      textSha256: value.recovery.textSha256,
      revisedText: value.recovery.revisedText,
      replacementCampaign: value.recovery.replacementCampaign,
    },
    unknown: { postId: value.unknown.postId, textSha256: value.unknown.textSha256 },
  };
}

async function scrub(page: Page) {
  try {
    await page.goto("about:blank", { timeout: 5_000 });
  } catch {
    try {
      await page.evaluate(() => document.body.replaceChildren());
    } catch {
      /* best effort */
    }
  }
}
// One native context survives refresh-token rotation across serial scenarios. No auth is exported.
const test = base.extend({
  page: async ({ browser, baseURL }, use) => {
    context ??= await browser.newContext({
      baseURL,
      storageState: process.env.PIKAR_E2E_STORAGE_STATE ?? { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await scrub(page);
      await page.close();
    }
  },
});
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial", retries: 0, timeout: 60_000 });
test.beforeEach(async ({ baseURL }) => {
  test.skip(
    !enabled,
    "Requires an attended private draft protocol; no ordinary run mutates drafts.",
  );
  packet = readPacket(baseURL);
});
test.afterAll(async () => {
  await context?.close();
  context = undefined;
});

async function checkedJourney(page: Page, name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch {
    // Do not put expected draft content, raw page snapshots or provider errors in reports.
    await scrub(page);
    throw new Error(`SOCIAL_BROWSER_${name}_FAILED`);
  }
}
async function openRow(page: Page, pin: RowPin): Promise<Locator> {
  await page.goto("/dashboard/marketing");
  const row = page.getByTestId(`buffer-post-${pin.postId}`);
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  // The text hash is verified via the actual native edit form for editable cases, and the
  // displayed body for locked cases; headings/channel/status must not enter the content hash.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  return row;
}
async function verifyEditor(row: Locator, pin: RowPin, button: string) {
  await row.getByRole("button", { name: button, exact: true }).click();
  const editor = row.getByRole("form", { name: "Edit social draft" });
  await expect(editor).toBeVisible();
  expect(
    sha(await editor.getByLabel("Post text", { exact: true }).inputValue()) === pin.textSha256,
  ).toBe(true);
  return editor;
}

test("edit an exact existing draft and require a new review", async ({ page }) => {
  await checkedJourney(page, "EDIT", async () => {
    const row = await openRow(page, packet.edit);
    // Opening the approval preview grants no publication authority. Editing must clear it.
    await row.getByRole("button", { name: "Review approval", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Approve and schedule", exact: true }),
    ).toBeVisible();
    const editor = await verifyEditor(row, packet.edit, "Edit draft");
    await editor.getByLabel("Post text", { exact: true }).fill(packet.edit.revisedText);
    await editor.getByRole("button", { name: "Save changes for review", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Approve and schedule", exact: true }),
    ).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Review approval", exact: true })).toBeVisible();
    const saved = await verifyEditor(
      row,
      { ...packet.edit, textSha256: sha(packet.edit.revisedText) },
      "Edit draft",
    );
    await saved.getByRole("button", { name: "Cancel editing", exact: true }).click();
  });
});

test("reject an exact draft without scheduling it", async ({ page }) => {
  await checkedJourney(page, "REJECT", async () => {
    const row = await openRow(page, packet.reject);
    const editor = await verifyEditor(row, packet.reject, "Edit draft");
    await editor.getByRole("button", { name: "Cancel editing", exact: true }).click();
    await row.getByRole("button", { name: "Discard draft", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Draft rejected. It will not be scheduled." }),
    ).toBeVisible();
    // Native history/absence of a dispatch must be independently read after browser work.
  });
});

test("replace only an explicitly known failed draft and preserve its failed history", async ({
  page,
}) => {
  await checkedJourney(page, "RECOVERY", async () => {
    const row = await openRow(page, packet.recovery);
    await expect(
      page.getByRole("heading", { name: packet.recovery.replacementCampaign, exact: true }),
    ).toHaveCount(0);
    const editor = await verifyEditor(row, packet.recovery, "Create replacement draft");
    await editor
      .getByLabel("Campaign name", { exact: true })
      .fill(packet.recovery.replacementCampaign);
    await editor.getByLabel("Post text", { exact: true }).fill(packet.recovery.revisedText);
    // A previously expired time is deliberately replaced with an unscheduled queue draft.
    await editor.getByLabel("When", { exact: true }).selectOption("addToQueue");
    await editor.getByRole("button", { name: "Save changes for review", exact: true }).click();
    await expect(row).toContainText("This failed version will not be resubmitted.");
    await expect(
      row.getByRole("button", { name: "Create replacement draft", exact: true }),
    ).toHaveCount(0);
    const replacement = page.locator("article").filter({
      has: page.getByRole("heading", { name: packet.recovery.replacementCampaign, exact: true }),
    });
    await expect(replacement).toHaveCount(1);
    await expect(
      replacement.getByRole("button", { name: "Review approval", exact: true }),
    ).toBeVisible();
    await expect(
      replacement.getByRole("button", { name: "Approve and schedule", exact: true }),
    ).toHaveCount(0);
    await expect(
      replacement.getByRole("button", { name: "Edit draft", exact: true }),
    ).toBeVisible();
  });
});

test("an uncertain submission stays locked and cannot be automatically repeated", async ({
  page,
}) => {
  await checkedJourney(page, "UNKNOWN", async () => {
    const row = await openRow(page, packet.unknown);
    const text = await row.locator("p").nth(1).textContent();
    expect(text !== null && sha(text) === packet.unknown.textSha256).toBe(true);
    await expect(row).toContainText("Publishing outcome needs checking in Buffer");
    await expect(row).toContainText("automatically repeat an uncertain submission");
    for (const name of [
      "Edit draft",
      "Review approval",
      "Approve and schedule",
      "Discard draft",
      "Create replacement draft",
    ])
      await expect(row.getByRole("button", { name, exact: true })).toHaveCount(0);
  });
});
