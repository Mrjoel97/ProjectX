import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Connected RPRT-01 browser evidence — the Reports route (plan 26-17).
//
// **WHAT IS SEEDED AND WHAT IS REAL, because the difference is the whole point of this file.**
//   • SEEDED, proving UI states only: the audit rows below, including one carrying deliberately
//     unsafe payload keys. No provider ran and no send happened.
//   • ACTUALLY EXECUTED, not seeded: the board pack. `generateBoardPack` runs the real
//     `markdownToPdf` (pdf-lib, deterministic, no network, no provider, no cent) and the real
//     `ctx.storage.store`, so the download link below points at bytes this run produced. That is
//     genuine render+storage evidence and it is the ONLY external-looking claim this spec makes.
//
// STAGE FIRST, AUTHENTICATE AFTER. Every `npx convex run` against the local backend ends the
// browser session (e2e/README.md), so all seeding happens in `beforeAll` off the storageState JWT,
// before any page exists. The content spec's structure, verbatim.

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const ROUTE = "/dashboard/reports";

function convexRun(fn: string, args: Record<string, unknown>): string {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`${fn} failed:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

function tenantIdFrom(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  const userId = claims.sub?.split("|")[0];
  if (!userId) throw new Error("Convex Auth JWT carries no stable user id.");
  return userId;
}

test.describe.configure({ mode: "serial" });

const MARKER = `e2e${Date.now().toString(36)}`;
// The strings that must never reach the DOM. Each is written into an audit payload under a key the
// viewer's allowlist does not name, or under one it does with a value the shape gate must refuse.
const RECIPIENT = `ceo-${MARKER}@northfield.example`;
const PROSE = `Dear Sarah, the Q3 numbers ${MARKER} are attached`;
let tenantId = "";

test.beforeAll(() => {
  const state = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json"), "utf8"),
  ) as { origins?: { localStorage?: { name: string; value: string }[] }[] };
  const entry = state.origins
    ?.flatMap((origin) => origin.localStorage ?? [])
    .find((item) => item.name.startsWith("__convexAuthJWT"));
  if (!entry) throw new Error("storageState carries no Convex Auth JWT — did auth.setup.ts run?");
  tenantId = tenantIdFrom(entry.value);

  convexRun("onboarding:__seedOnboardedTenant", { tenantId });

  // A well-formed row the table must SHOW.
  convexRun("audit:log", {
    tenantId,
    correlationId: `c-${MARKER}`,
    eventType: "plan.discarded",
    actor: "user",
    payload: { planId: `plan-${MARKER}`, kind: "media" },
  });

  // THE HOSTILE ROW. `draft` and `to` are not allowlisted for this event at all; `kind` IS
  // allowlisted but carries prose, which the shape gate must refuse and count. If any of these
  // strings reaches the DOM, the projection is not the boundary it claims to be.
  convexRun("audit:log", {
    tenantId,
    correlationId: `c-hostile-${MARKER}`,
    eventType: "request.redacted",
    actor: "system",
    payload: {
      requestId: `req-${MARKER}`,
      safeTextHash: `sha256:${MARKER}`,
      draft: PROSE,
      to: RECIPIENT,
      piiCounts: { email: 2 },
    },
  });

  // An event no build describes — the table must render it as a SHELL, not drop the row.
  convexRun("audit:log", {
    tenantId,
    correlationId: `c-unknown-${MARKER}`,
    eventType: "brand.new_event",
    actor: "system",
    payload: { secret: PROSE },
  });
});

test("the route is reachable directly while its nav item stays dark", async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

  // THE GATE. Task 3 activates the nav only after the owner's UAT verdict; until then no link to
  // this route may exist anywhere in the DOM, and the rail item must announce itself as disabled.
  await expect(page.locator('a[href="/dashboard/reports"]')).toHaveCount(0);
  await expect(page.locator('[aria-disabled="true"]').filter({ hasText: "Reports" })).toHaveCount(
    1,
  );
});

test("one period selection moves every section to the same resolved window", async ({ page }) => {
  await page.goto(ROUTE);
  const windowLine = page.getByTestId("reports-window");
  await expect(windowLine).not.toContainText("Resolving");

  await expect(windowLine).toHaveText(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);
  const thirty = (await windowLine.textContent()) ?? "";
  // The window line is the SERVER's resolved window, echoed back from `auditPage`. Every section
  // is fed the same args object, so one line is the honest label for all four.
  //
  // NOT hardcoded to a zone: the first draft asserted "UTC" and the runner's browser reports
  // Africa/Dar_es_Salaam, which failed a CORRECT page. What the contract actually promises is a
  // named IANA zone plus the disclosure that it came from the browser rather than a tenant setting
  // — `timeZoneSource: "browser-fallback"` is the documented temporary state, and hiding it would
  // be the report claiming a precision it does not have.
  const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(thirty).toContain(browserZone);
  expect(thirty).toContain("(from your browser)");
  expect(thirty).toMatch(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);

  // WAIT FOR THE RESOLVED LINE, never merely for a CHANGED one. Switching periods hands every
  // subscription new args, so `useQuery` returns undefined and the header honestly reads
  // "Resolving the window…" until the server answers. Reading the text at the moment it merely
  // DIFFERS captures that intermediate state — which is what a naive assertion did here first.
  // (All three sections blank together on the same args change, so no stale number ever sits
  // under a new header.)
  const resolvedLine = async (): Promise<string> => {
    await expect(windowLine).toHaveText(/\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);
    return (await windowLine.textContent()) ?? "";
  };

  await page.getByRole("button", { name: "7 days" }).click();
  await expect(windowLine).not.toHaveText(thirty);
  const seven = await resolvedLine();

  await page.getByRole("button", { name: "90 days" }).click();
  await expect(windowLine).not.toHaveText(seven);

  // Same upper bound throughout — the anchor is pinned at mount, so only the start moves.
  const ninety = await resolvedLine();
  const upperOf = (line: string) => line.split("→")[1]?.trim().split(" ")[0];
  expect(upperOf(seven), "the 7-day line never resolved").toBeDefined();
  expect(upperOf(ninety)).toBe(upperOf(seven));
  expect(upperOf(ninety)).toBe(upperOf(thirty));
  // …and the START really moved, so the assertion above is about a pinned anchor rather than a
  // page that ignored the click.
  const lowerOf = (line: string) => line.split("→")[0]?.trim();
  expect(new Set([lowerOf(seven), lowerOf(thirty), lowerOf(ninety)]).size).toBe(3);

  await expect(page.getByRole("button", { name: "90 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("every section renders, and each one names what it cannot measure", async ({ page }) => {
  await page.goto(ROUTE);
  for (const title of ["Business", "Operations", "Governance record", "Board pack"]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  // The e2e tenant has no telemetry, so this is the assertion that matters most: an unmeasured
  // source says so in words. A "0" here would be the defect this whole phase exists to prevent.
  await expect(page.getByText(/not measured/).first()).toBeVisible();
});

test("PRIVACY: no unsafe payload value reaches the DOM, and the unknown event is a shell", async ({
  page,
}) => {
  await page.goto(ROUTE);
  await expect(page.getByText("plan.discarded").first()).toBeVisible();

  const dom = (await page.content()) ?? "";
  for (const needle of [RECIPIENT, PROSE, "piiCounts", "northfield.example"]) {
    expect(dom, `the DOM leaked ${needle}`).not.toContain(needle);
  }
  // The allowlisted refs DID survive — otherwise the assertions above pass on an empty table.
  expect(dom).toContain(`plan-${MARKER}`);
  expect(dom).toContain(`sha256:${MARKER}`);

  // The unknown event is present as a shell rather than missing. `.first()` because the seed is
  // additive — every run of this file appends another row, and a strict locator would turn a
  // SECOND run red for a reason that has nothing to do with the product.
  await expect(page.getByText("brand.new_event").first()).toBeVisible();
  await expect(
    page.getByText("no detail — this build does not describe this event").first(),
  ).toBeVisible();
});

test("a board pack generates real bytes, and generating it again is the SAME pack", async ({
  page,
}) => {
  test.setTimeout(120_000); // two real pdf-lib renders and two storage writes
  await page.goto(ROUTE);
  // SETTLE FIRST. Every section re-renders as its subscription resolves, and clicking into that
  // churn detaches the button mid-click. The resolved window line is the honest "all queries have
  // answered" signal — a networkidle wait would be a guess about a reactive socket that never idles.
  await expect(page.getByTestId("reports-window")).toHaveText(/\d{4}-\d{2}-\d{2} → /, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Generate board pack" }).click();

  const result = page.getByTestId("pack-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText("Generated");
  await expect(result).toContainText("bytes");

  const download = page.getByRole("link", { name: "Download PDF" });
  await expect(download).toBeVisible();
  const href = await download.getAttribute("href");
  expect(href, "the download must be a minted storage URL, not a data: blob").toMatch(/^https?:/);

  // THE REPLAY, in the browser. The window anchor is pinned at mount, so the second click sends the
  // identical window, renders identical markdown, hashes identically and lands on the row that is
  // already there. This is `landPack`'s dedup observed end to end rather than in a unit test.
  await page.getByRole("button", { name: "Generate board pack" }).click();
  await expect(result).toContainText("Already generated for this window", { timeout: 30_000 });
});

// ORDER IS LOAD-BEARING, and the reason is written at the top of this file: **`convex run` ENDS
// THE BROWSER SESSION on a local deployment.** The role-split test is the only one that calls it
// mid-test (bootstrapOwner/revokeOwner), so it must run LAST — with it in the middle, every
// later test loaded the page unauthenticated and `auditPage` never resolved, which reads as a
// hung query rather than as a dead session. Measured 2026-08-22.

test("ROLE SPLIT: the deployment card is absent for a non-owner and present for the owner", async ({
  page,
}) => {
  await page.goto(ROUTE);
  await expect(page.getByText("Deployment (owner only)")).toHaveCount(0);
  // Not merely hidden: a non-owner never CALLS the owner queries, so their figures are nowhere.
  expect(await page.content()).not.toContain("Last cursor advance");

  convexRun("owner:bootstrapOwner", { userId: tenantId });
  try {
    await page.reload();
    // `exact` because the section renders its title AND a "Loading deployment (owner only)…"
    // line; the loose locator matches both. The ABSENCE assertion above stays loose on purpose —
    // for a non-owner neither the title nor the loading line may exist.
    await expect(page.getByText("Deployment (owner only)", { exact: true })).toBeVisible();
    await expect(page.getByText("Last cursor advance")).toBeVisible();
    // The correction 26-15 made to the mockup, verified in the rendered page.
    expect(await page.content()).not.toContain("Healthy");
  } finally {
    // Restore the fixture whatever the assertions did — a leaked owner bit would silently make
    // every later run's non-owner assertion vacuous.
    convexRun("owner:revokeOwner", { userId: tenantId });
  }
});
