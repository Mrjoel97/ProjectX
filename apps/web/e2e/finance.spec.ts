import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Connected FIN-01 browser evidence.
//
// EVERY MOVEMENT BELOW IS SEEDED THROUGH THE REAL LEDGER WRITER (`spendLedger:record`), so this
// proves the projection, the coverage semantics and the role boundary. **It proves nothing about a
// provider.** No model call, fal job or invoice is involved: a seeded `actual` row is an accounting
// state, not evidence that money reached OpenAI or fal. Any claim about a real external charge
// requires separately executed live evidence, recorded in the plan summary — never inferred from a
// green run here.
//
// The owner half is deliberately ordered: the NON-owner assertions run FIRST, because
// `owner:bootstrapOwner` has no inverse and once this user is the owner the boundary can no longer
// be observed from this account.

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const defaultAppOrigin = "http://127.0.0.1:3111";
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? defaultAppOrigin;
const ROUTE = "/dashboard/finance";

function convexRun<T>(fn: string, args: Record<string, unknown>): T {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`${fn} failed:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
  try {
    // Convex CLI 1.42.1 on Windows can print a valid committed result and then exit non-zero on a
    // libuv closing-handle assertion (approvals.spec.ts, verbatim). A missing/invalid result still
    // fails below, so this never turns a real Convex error green.
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    if (!result.stdout.trim() && /UV_HANDLE_CLOSING/.test(stderr)) return undefined as T;
    throw new Error(`${fn} returned no valid result:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
}

function tenantIdFrom(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  const userId = claims.sub?.split("|")[0];
  if (!userId) throw new Error("Convex Auth JWT carries no stable user id.");
  return userId;
}

async function tokenFor(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!token) throw new Error("Finance E2E has no Convex Auth JWT in storageState.");
  return token;
}

type Movement = {
  rail: "reasoning" | "media" | "ingest";
  phase: "estimated" | "reserved" | "actual" | "refunded" | "adjustment";
  amountCents: number;
  correlationId: string;
  createdAt: number;
  kind?: string;
  model?: string;
};

const record = (tenantId: string, movement: Movement) =>
  convexRun<string>("spendLedger:record", { tenantId, ...movement });

// `playwright.config.ts` sets `fullyParallel: true`, which otherwise gives NO guarantee that tests
// in this file run in declaration order or in the same worker. Every test below shares one signed-in
// identity (the same `storageState` file), and `owner:bootstrapOwner` has no inverse — so without
// forcing serial order, a non-owner assertion could race an owner-promoting test and observe a
// boundary that has already been crossed. This is what actually enforces "non-owner first, owner
// last," not the file order alone.
test.describe.configure({ mode: "serial" });

/**
 * Fresh local users sit behind the onboarding gate — the SAME seam the connected test below (the
 * one that calls `owner:bootstrapOwner`) already clears before its own assertions, via the same
 * `convexRun("onboarding:__seedOnboardedTenant", ...)` call. Every test that runs BEFORE that one
 * needs this too: an un-onboarded user redirected off `/dashboard/finance` would make a
 * `toHaveCount(0)`/`not.toBeVisible()` assertion pass VACUOUSLY — absent because the page never
 * rendered at all, not because the boundary the test means to check actually holds.
 */
async function seedOnboarded(page: Page): Promise<void> {
  await page.goto(`${appOrigin}${ROUTE}`);
  const token = await tokenFor(page);
  const tenantId = tenantIdFrom(token);
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });
  await page.reload();
}

test("the Finance page opens on Business, and a non-owner is offered no Operator tab", async ({
  page,
}) => {
  await seedOnboarded(page);
  const tablist = page.getByRole("tablist", { name: "Finance sections" });
  await expect(tablist.getByRole("tab", { name: "Business" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tablist.getByRole("tab", { name: "Pikar spend" })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: "Operator" })).toHaveCount(0);
});

test("the Cost console is intact behind the Pikar spend tab", async ({ page }) => {
  await seedOnboarded(page);
  await page.getByRole("tab", { name: "Pikar spend" }).click();
  await expect(page.getByRole("heading", { name: /budget rails/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /where it went/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /media job ledger/i })).toBeVisible();
});

test("a number entered in the panel appears as a business figure", async ({ page }) => {
  await seedOnboarded(page);
  // Seeds through the real mutation, so this proves the panel → mutation → derivation → render
  // path end to end. It proves nothing about any external system.
  await page.getByLabel("Cash on hand").fill("60000");
  await page.getByRole("button", { name: /save cash on hand/i }).click();
  await page.getByLabel("Monthly operating cost").fill("10000");
  await page.getByRole("button", { name: /save monthly operating cost/i }).click();
  await expect(page.getByText(/6 months/i)).toBeVisible();
});

test("connected cost console: coverage, rails, unlanded meaning and the owner boundary", async ({
  page,
}) => {
  test.setTimeout(180_000);

  if (appOrigin !== defaultAppOrigin) {
    const state = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json"), "utf8"),
    ) as {
      origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    };
    const saved = state.origins?.find((entry) => entry.origin === defaultAppOrigin)?.localStorage;
    if (!saved) throw new Error("No saved storage state for the canonical origin.");
    await page.addInitScript((entries: Array<{ name: string; value: string }>) => {
      for (const entry of entries) window.localStorage.setItem(entry.name, entry.value);
    }, saved);
  }

  await page.goto(ROUTE);
  const token = await tokenFor(page);
  const tenantId = tenantIdFrom(token);
  // Fresh local users sit behind the onboarding gate; this seam clears it with no model spend.
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });
  await page.reload();

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();

  // ── 1. The route is reachable directly while its nav item is still "Soon" ────────────
  await expect(page.getByRole("heading", { name: "Know what it costs" })).toBeVisible({
    timeout: 20_000,
  });
  // Task 1 ships the route with navigation still disabled — activation is Task 3, after UAT.
  await expect(page.getByRole("link", { name: "Finance" })).toHaveCount(0);

  // ── 2. NON-OWNER FIRST — the boundary is unobservable once this account is promoted ──
  const deployment = page
    .getByRole("region", { name: "Deployment controls" })
    .or(
      page.locator("section", { has: page.getByRole("heading", { name: "Deployment controls" }) }),
    );
  await expect(page.getByText("managed by the operator")).toBeVisible();
  await expect(deployment.getByRole("button")).toHaveCount(0);
  // Not a single deployment ceiling may be in the DOM of a caller who is not the owner.
  const nonOwnerHtml = await page.content();
  for (const ceiling of ["$50.00", "$100.00", "$250.00"]) {
    expect(nonOwnerHtml).not.toContain(ceiling);
  }
  // …and the API refuses directly, which is the real boundary. The UI absence above is cosmetic.
  const refusal = await page.evaluate(
    async ([url, jwt]) => {
      const response = await fetch(`${url}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ path: "finance:controls", args: {}, format: "json" }),
      });
      return JSON.stringify(await response.json());
    },
    [process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210", token],
  );
  expect(refusal).toContain("OWNER_REQUIRED");

  // ── 3. Coverage: an untracked period is Unknown, never $0 ───────────────────────────
  // Asserted BEFORE any `record` call, because `recordMovement` opens coverage as a side effect.
  const coverage = convexRun<number | null>("spendLedger:coverage", { tenantId });
  if (coverage === null) {
    await expect(page.getByText(/Unknown/)).toBeVisible();
    await expect(page.getByText(/has not started/)).toBeVisible();
  }

  // ── 4. One controlled movement per rail and phase ───────────────────────────────────
  const at = now - 60 * 60 * 1000;
  record(tenantId, {
    rail: "reasoning",
    phase: "actual",
    amountCents: 42,
    correlationId: `e2e:${suffix}:reasoning`,
    createdAt: at,
  });
  record(tenantId, {
    rail: "ingest",
    phase: "reserved",
    amountCents: 900,
    correlationId: `e2e:${suffix}:folder`,
    createdAt: at,
  });
  record(tenantId, {
    rail: "ingest",
    phase: "refunded",
    amountCents: 400,
    correlationId: `e2e:${suffix}:folder`,
    createdAt: at,
  });
  record(tenantId, {
    rail: "media",
    phase: "reserved",
    amountCents: 300,
    correlationId: `mediabatch:e2e-${suffix}`,
    createdAt: at,
    kind: "video",
  });
  record(tenantId, {
    rail: "media",
    phase: "actual",
    amountCents: 110,
    correlationId: `mediabatch:e2e-${suffix}:j1`,
    createdAt: at,
    kind: "video",
  });
  // A replayed movement must not double-count: identity is (tenant, correlation, phase).
  record(tenantId, {
    rail: "media",
    phase: "actual",
    amountCents: 110,
    correlationId: `mediabatch:e2e-${suffix}:j1`,
    createdAt: at,
    kind: "video",
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Know what it costs" })).toBeVisible({
    timeout: 20_000,
  });

  // Each movement appears exactly ONCE in its rail/phase — the replay above added no second row.
  await expect(page.getByRole("row", { name: /Media generation/ })).toHaveCount(1);
  const ledgerRows = page.locator(`tr:has-text("mediabatch:e2e-${suffix}:j1")`);
  await expect(ledgerRows).toHaveCount(1);

  // ── 5. Unlanded says two different things, on one page ──────────────────────────────
  // ingest: reserved 900 − refunded 400 = 500 still out, and it can still resolve.
  await expect(page.getByText(/\$5\.00 unlanded/)).toBeVisible();
  await expect(page.getByText(/still expected to land/)).toBeVisible();
  // media: reserved 300 − actual 110 = 190 that is NEVER coming back.
  await expect(page.getByText(/\$1\.90 unlanded/)).toBeVisible();
  await expect(page.getByText(/no refund path/)).toBeVisible();

  // Coverage is open now, so the window states a confident figure rather than Unknown.
  await expect(page.getByRole("row", { name: /All rails/ })).toBeVisible();

  // ── 6. The enforcement clock is labelled UTC and is not the chart's timezone ─────────
  await expect(page.getByText(/resets .*\(UTC\)/).first()).toBeVisible();

  // ── 7. OWNER LAST — promote, then prove the controls return effective state ─────────
  const granted = convexRun<{ changed: boolean }>("owner:bootstrapOwner", { userId: tenantId });
  expect(typeof granted.changed).toBe("boolean");
  await page.reload();

  await expect(page.getByText("there is no single combined limit")).toBeVisible({
    timeout: 20_000,
  });
  // Three separate ceilings, never one combined number.
  const ownerHtml = await page.content();
  for (const ceiling of ["$50.00", "$100.00", "$250.00"]) {
    expect(ownerHtml).toContain(ceiling);
  }

  // A deployment-wide pause takes two deliberate clicks, and the second is explicitly a confirm.
  const mediaToggle = page.locator('[data-control="Media kill switch"]');
  await mediaToggle.getByRole("button", { name: /^Turn on$/ }).click();
  await mediaToggle.getByRole("button", { name: /^Confirm — Turn on$/ }).click();
  await expect(mediaToggle.getByText("On — paid generation is paused.")).toBeVisible();
  // The master switch is INDEPENDENT: pausing generation must not pause the email cockpit.
  await expect(
    page.locator('[data-control="Master kill switch"]').getByText("Off — model calls permitted"),
  ).toBeVisible();

  // Put it back, so a shared deployment is not left paused by a test run.
  await mediaToggle.getByRole("button", { name: /^Turn off$/ }).click();
  await mediaToggle.getByRole("button", { name: /^Confirm — Turn off$/ }).click();
  await expect(mediaToggle.getByText("Off — paid generation permitted.")).toBeVisible();

  // ── 8. Responsive + keyboard, at the two breakpoints the UAT also checks ────────────
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Know what it costs" })).toBeVisible();
    // A wide table must scroll inside its own container, never make the page scroll sideways.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, `page scrolls horizontally at ${viewport.width}px`).toBe(false);
  }
});

// Runs AFTER the test above, which is what promotes this browser's user to owner via
// `owner:bootstrapOwner`. That grant has no inverse, so an owner-tab assertion placed before it
// would observe nothing and one placed in an earlier file/worker could poison the non-owner
// assertions above — hence one file, one ordering, owner last. Deliberately does NOT call
// `seedOnboarded` again: the connected test above already cleared the onboarding gate for this
// same signed-in tenant, and that state does not un-set itself.
test("an owner gets the Operator tab, and the deployment controls live there", async ({ page }) => {
  await page.goto(`${appOrigin}${ROUTE}`);
  await page.getByRole("tab", { name: "Operator" }).click();
  await expect(page.getByRole("heading", { name: /deployment controls/i })).toBeVisible();
  // And they are NOT VISIBLE on the tenant's own tabs any more — the original complaint. NOT
  // `toHaveCount(0)`: `FinanceTabs.tsx` mounts Operator only for an owner but then toggles it with
  // `hidden`, same as Business/Pikar-spend — the panel stays in the DOM while another tab is
  // active (that is what lets a half-typed number survive a tab switch), so a count-based
  // assertion here would find the hidden node and fail. `not.toBeVisible()` is what "not on this
  // tab" actually means for a panel that is designed to stay mounted.
  await page.getByRole("tab", { name: "Business" }).click();
  await expect(page.getByText(/master kill switch/i)).not.toBeVisible();
});
