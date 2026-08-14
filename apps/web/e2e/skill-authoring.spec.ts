import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "@pikar/backend/api";
import { USER_SKILL_ADAPTATION_MAX_BYTES } from "@pikar/contracts/skill";
import { expect, type Page, test } from "@playwright/test";
import { fetchQuery } from "convex/nextjs";

// Phase 21's browser gate. The first test performs exactly one candidate publication through the
// shipped UI, then proves routine-v0 with an OFFLINE SMOKE turn (zero model/provider spend). The
// second test is deliberately read-only and runs only after 21-07 supplies the sealed result.
//
// The browser mutation response is captured from Convex's WebSocket frame. Looking up the newest
// row after clicking Save would be ambiguous in this append-only/shared deployment and is expressly
// forbidden by 21-06. The response's `tenantSkillId` is the candidate identity handed to 21-07.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const backendDir = process.env.PIKAR_E2E_BACKEND_DIR ?? resolve(repoRoot, "packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";
const PRIVATE_PREFIX = "PHASE21_PRIVATE_NEEDLE";
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

type Auth = { token: string; url: string };
type ThreadRef = { threadId: string; title?: string };
type CandidateResponse = {
  inserted: boolean;
  name: string;
  status: "candidate";
  tenantSkillId: string;
  version: number;
};
type PrivacyCounts = {
  auditNeedleCount: number;
  evidenceNeedleCount: number;
  logNeedleCount: number;
  dlqNeedleCount: number;
  telemetryNeedleCount: number;
};

function convexCli(args: string[]): string {
  const result = spawnSync(process.execPath, [convexBin, ...args], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`Convex CLI failed to start: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`convex ${args.join(" ")} failed:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
  return result.stdout ?? "";
}

function convexData(table: string): Array<Record<string, unknown>> {
  const raw = convexCli(["data", table, "--limit", "10000", "--format", "json"]);
  try {
    return JSON.parse(raw) as Array<Record<string, unknown>>;
  } catch {
    throw new Error(`convex data ${table} returned non-JSON output`);
  }
}

function occurrenceCount(text: string, needle = PRIVATE_PREFIX): number {
  return text.split(needle).length - 1;
}

/** Scan only the five governed log/evidence planes. tenantSkills.body and savedPrompts.text are
 * content-plane storage and are expected to contain the private sentinel. */
function privateNeedleCounts(): PrivacyCounts {
  const tenantSkills = convexData("tenantSkills");
  return {
    auditNeedleCount: occurrenceCount(JSON.stringify(convexData("audit"))),
    evidenceNeedleCount: occurrenceCount(
      JSON.stringify(tenantSkills.map((row) => row.evidence ?? null)),
    ),
    logNeedleCount: occurrenceCount(convexCli(["logs", "--history", "1000", "--jsonl"])),
    dlqNeedleCount: occurrenceCount(JSON.stringify(convexData("deadLetters"))),
    telemetryNeedleCount: occurrenceCount(JSON.stringify(convexData("telemetry"))),
  };
}

async function authFor(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!token) throw new Error("Phase 21 E2E has no Convex Auth JWT in storageState.");
  return { token, url: CONVEX_URL };
}

async function threads(auth: Auth): Promise<ThreadRef[]> {
  return (await fetchQuery(api.cockpit.listThreads, {}, auth)) as ThreadRef[];
}

async function waitForNewThread(auth: Auth, before: Set<string>): Promise<string> {
  let found = "";
  await expect
    .poll(
      async () => {
        const fresh = (await threads(auth)).find((row) => !before.has(row.threadId));
        found = fresh?.threadId ?? "";
        return found;
      },
      { timeout: 30_000, message: "the ordinary cockpit path must mint one fresh thread" },
    )
    .not.toBe("");
  return found;
}

function findCandidateResponse(value: unknown): CandidateResponse | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCandidateResponse(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.tenantSkillId === "string" &&
    row.status === "candidate" &&
    typeof row.name === "string" &&
    typeof row.version === "number" &&
    typeof row.inserted === "boolean"
  ) {
    return row as CandidateResponse;
  }
  for (const child of Object.values(row)) {
    const found = findCandidateResponse(child);
    if (found) return found;
  }
  return null;
}

function onlyZeroCounts(counts: PrivacyCounts): void {
  expect(counts).toEqual({
    auditNeedleCount: 0,
    evidenceNeedleCount: 0,
    logNeedleCount: 0,
    dlqNeedleCount: 0,
    telemetryNeedleCount: 0,
  });
}

test.describe.configure({ mode: "serial", retries: 0 });

test("candidate-only authoring and pinned prompt run use exact response and a fresh thread", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  const frames: unknown[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        frames.push(JSON.parse(payload.toString()) as unknown);
      } catch {
        // Non-JSON protocol frames cannot carry the JSON mutation result we are looking for.
      }
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/workspace");
  const auth = await authFor(page);

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Open the one authoring surface. Empty and over-cap states are honest, keyboard-reachable and
  // cause no write; the one valid click below is the only publication in this entire spec.
  const options = page.getByRole("button", { name: "Chat options" });
  await options.focus();
  await options.press("Enter");
  await page.getByRole("menuitem", { name: "Adapt a business skill" }).click();
  const panel = page.getByRole("region", { name: "Adapt a business skill" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Which skill").selectOption("offer-architect");

  const save = panel.getByRole("button", { name: "Save as draft" });
  const adaptation = panel.getByLabel("What should it do differently for your business?");
  await expect(save).toBeDisabled();
  await adaptation.fill("あ".repeat(Math.ceil((USER_SKILL_ADAPTATION_MAX_BYTES + 1) / 3)));
  await expect(panel.getByText(/too long to save/i)).toBeVisible();
  await expect(save).toBeDisabled();

  const nonce = randomUUID().replaceAll("-", "");
  const authoredNeedle = `${PRIVATE_PREFIX}_ADAPT_${nonce}`;
  await adaptation.fill(`Prefer concise proposals for ${authoredNeedle}.`);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByText(/Saved as version \d+\. It is a draft/i)).toBeVisible({
    timeout: 20_000,
  });

  await expect
    .poll(() => findCandidateResponse(frames)?.tenantSkillId ?? "", {
      timeout: 15_000,
      message: "capture tenantSkillId from the exact browser mutation response",
    })
    .not.toBe("");
  const candidate = findCandidateResponse(frames);
  if (!candidate) throw new Error("candidate response disappeared after the response poll");
  expect(candidate.inserted).toBe(true);
  expect(candidate.status).toBe("candidate");
  expect(candidate.name).toBe("offer-architect");

  const publishedAt = new Date().toISOString();
  await testInfo.attach("phase21-candidate-ref.json", {
    body: Buffer.from(
      JSON.stringify({ candidateId: candidate.tenantSkillId, publishedAt }, null, 2),
      "utf8",
    ),
    contentType: "application/json",
  });

  await expect(panel.getByText(authoredNeedle, { exact: false })).toBeVisible();
  await expect(panel.getByText(/Draft saved — waiting to be evaluated/i)).toBeVisible();
  await expect(panel.getByRole("button", { name: /activate/i })).toHaveCount(0);
  await expect(panel).not.toContainText("## Tenant-authored business adaptation");
  await panel.getByRole("button", { name: "Close skill authoring" }).click();

  // A real user turn, but an OFFLINE SMOKE operation: it follows the ordinary cockpit/activity/
  // plan path while making no provider/model call. Its high-entropy content must stay out of all
  // five governed log planes.
  const prompt = `SMOKE::agent::subject=${PRIVATE_PREFIX}_PROMPT_${nonce}`;
  const beforeSource = new Set((await threads(auth)).map((row) => row.threadId));
  await composer.fill(prompt);
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 20_000 });
  const sourceThreadId = await waitForNewThread(auth, beforeSource);
  await expect(
    fetchQuery(api.plans.byThread, { threadId: sourceThreadId }, auth),
  ).resolves.not.toBeNull();

  const userBubble = page.getByTestId("chat-message").filter({ hasText: prompt }).last();
  await expect(userBubble).toBeVisible({ timeout: 20_000 });
  const pin = userBubble.locator("..").getByRole("button", { name: "Pin prompt" });
  await pin.focus();
  await pin.press("Enter");
  await expect(userBubble.locator("..").getByRole("button", { name: "Pinned ✓" })).toBeVisible({
    timeout: 15_000,
  });

  const saved = await fetchQuery(api.savedPrompts.list, {}, auth);
  const savedRow = saved.find((row) => row.text === prompt);
  if (!savedRow) throw new Error("the browser pin produced no exact savedPrompt row");
  const pinnedPromptId = String(savedRow.id);

  // Reload proves persistence. Run closes the menu only after the same trusted hook returns a
  // distinct fresh thread, then Delete removes only the saved row.
  await page.reload();
  await expect(composer).toBeVisible({ timeout: 15_000 });
  const pinnedMenuButton = page.getByRole("button", { name: "Pinned prompts" });
  await pinnedMenuButton.focus();
  await pinnedMenuButton.press("Enter");
  const menu = page.getByRole("menu", { name: "Pinned prompts" });
  const run = menu.getByRole("menuitem", { name: `Run pinned prompt: ${prompt}` });
  await expect(run).toBeVisible({ timeout: 15_000 });
  const beforeRun = new Set((await threads(auth)).map((row) => row.threadId));
  await run.click();
  const runThreadId = await waitForNewThread(auth, beforeRun);
  expect(runThreadId).not.toBe(sourceThreadId);
  await expect(
    fetchQuery(api.plans.byThread, { threadId: runThreadId }, auth),
  ).resolves.not.toBeNull();

  await pinnedMenuButton.click();
  const deletePin = page
    .getByRole("menu", { name: "Pinned prompts" })
    .getByRole("button", { name: `Delete pinned prompt: ${prompt}` });
  await deletePin.click();
  await expect
    .poll(
      async () =>
        (await fetchQuery(api.savedPrompts.list, {}, auth)).some(
          (row) => String(row.id) === pinnedPromptId,
        ),
      { timeout: 15_000 },
    )
    .toBe(false);

  const finalThreads = new Set((await threads(auth)).map((row) => row.threadId));
  expect(finalThreads.has(sourceThreadId)).toBe(true);
  expect(finalThreads.has(runThreadId)).toBe(true);
  onlyZeroCounts(privateNeedleCounts());

  // The two viewports exercise the shipped responsive seam, and the menu remains keyboard
  // operable at both sizes. A horizontal overflow is a real narrow-layout failure.
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await pinnedMenuButton.focus();
    await pinnedMenuButton.press("Enter");
    await expect(page.getByRole("menu", { name: "Pinned prompts" })).toBeVisible();
    await pinnedMenuButton.press("Enter");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
});

test("refs-only post-live readback", async ({ page }) => {
  const supplied = process.env.PHASE21_LIVE_RESULT_PATH;
  test.skip(!supplied, "set PHASE21_LIVE_RESULT_PATH after the 21-07 live checkpoint");
  if (!supplied) return;

  const path = isAbsolute(supplied) ? supplied : resolve(repoRoot, supplied);
  const result = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const forbidden = new Set([
    "body",
    "authoredbody",
    "prompt",
    "prompttext",
    "fixture",
    "modeloutput",
    "rawevidence",
    "evidencejson",
    "message",
    "messages",
    "content",
    "text",
    "email",
    "secret",
    "token",
    "providerresponse",
    "headers",
    "authorization",
    "response",
    "output",
  ]);
  const walk = (value: unknown, at = "root"): void => {
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key.toLowerCase())) throw new Error(`forbidden result key ${at}.${key}`);
        walk(child, `${at}.${key}`);
      }
    } else if (
      typeof value === "string" &&
      (value.includes(PRIVATE_PREFIX) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value))
    ) {
      throw new Error(`forbidden result value at ${at}`);
    }
  };
  walk(result);
  expect(result.schema).toBe("phase21-live-result.v1");

  const promptRun = result.promptRun as {
    pinnedPromptId: string;
    sourceThreadId: string;
    runThreadId: string;
    pinRemoved: boolean;
    sourceThreadExists: boolean;
    runThreadExists: boolean;
  };
  const expectedPrivacy = result.privacy as PrivacyCounts & { passed: boolean };
  expect(promptRun.sourceThreadId).not.toBe(promptRun.runThreadId);

  await page.goto("/dashboard/workspace");
  const auth = await authFor(page);
  const liveThreads = new Set((await threads(auth)).map((row) => row.threadId));
  const pinStillExists = convexData("savedPrompts").some(
    (row) => String(row._id) === promptRun.pinnedPromptId,
  );
  const freshPrivacy = privateNeedleCounts();

  expect({
    pinnedPromptId: promptRun.pinnedPromptId,
    sourceThreadId: promptRun.sourceThreadId,
    runThreadId: promptRun.runThreadId,
    pinRemoved: !pinStillExists,
    sourceThreadExists: liveThreads.has(promptRun.sourceThreadId),
    runThreadExists: liveThreads.has(promptRun.runThreadId),
  }).toEqual(promptRun);
  expect({
    passed: Object.values(freshPrivacy).every((count) => count === 0),
    ...freshPrivacy,
  }).toEqual(expectedPrivacy);
});
