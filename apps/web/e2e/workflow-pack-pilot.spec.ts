import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// ══ 27-09 (PACK-02/PACK-04): the authenticated browser evidence plane for the pack pilot ═══════
//
// ⚠️ THIS SPEC HAS NEVER BEEN RUN GREEN. It was authored in the session that built the surfaces it
// drives, on a deployment whose model provider had no balance, so the paid half could not execute.
// Do NOT read it as coverage and do NOT record browser evidence from a partial pass — the pack gate
// takes `hasPassingPackBrowserEvidence`, and a row written from a run that never exercised a pack
// would certify a version nobody watched. The FIRST person to run this should expect to fix things.
//
// WHAT IT COSTS. `@dark` and `@discovery` are FREE — they assert what is NOT there, and during the
// pilot nothing is active, so no pack ever starts and no model is called. `@run` starts real pack
// turns and spends real money (~$0.02–0.25 a turn). Run the free tags first, always.
//
// ORDERING IS LOAD-BEARING. `convexRun` signs the browser out: one `convex run` against the local
// deployment kills the saved `storageState` and the next navigation lands on `/signin` (measured
// 2026-08-14, `apps/web/e2e/README.md`). Every browser assertion therefore happens BEFORE any
// `convexRun` in the same worker, and the activation/rollback drills live in their own file-final
// block. `skills.deactivatePack` is the product's dark path, but it is an `ownerMutation` and
// `convex run` carries no identity — so the rollback drills are RECORDED AS OWED at the bottom of
// this file rather than faked. See the @drill block.
//
// PREREQUISITES (see the plan's live-stack block):
//   • production build on :3111 — `next dev` OOMs on this very page
//   • `convex dev` RUNNING, not `--once`
//   • E2E_USER_EMAIL / E2E_USER_PASSWORD exported; an expired JWT self-heals via `--project=setup`
//   • the six candidates published (`npx convex run skills:seedPackCandidates`)

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111";

/** ⚠️ ENDS THE BROWSER SESSION. Never call this before a navigation you still need. */
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
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    // The Windows/Node-24 libuv closing-handle assertion prints a valid result then exits non-zero.
    if (!result.stdout.trim() && /UV_HANDLE_CLOSING/.test(stderr)) return undefined as T;
    throw new Error(`${fn} returned no valid result:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
}

const openWorkspace = async (page: Page) => {
  await page.goto(`${appOrigin}/dashboard/workspace`);
  await expect(page.getByTestId("workspace-pane")).toBeVisible();
};

const quickStarts = (page: Page) => page.getByRole("region", { name: "Guided workflows" });

// ── FREE: the pilot is dark, and the product proves it ────────────────────────────────────────
test.describe("@dark the pilot is invisible while every pack is a candidate", () => {
  // THE CENTRAL PROPERTY OF THE PHASE, asserted at the surface a real user looks at rather than
  // at the query. Six candidates exist on this deployment right now; not one may be offered.
  test("no guided workflow is offered at all", async ({ page }) => {
    await openWorkspace(page);
    await expect(quickStarts(page)).toHaveCount(0);
    // And no pack name leaks into the page some other way — a heading, a menu item, a tooltip.
    for (const title of [
      "Business pulse",
      "Campaign plan",
      "Customer complaint reply",
      "Sales call prep",
      "Process / SOP",
      "Brand review",
    ]) {
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    }
  });

  // A dark pilot must not advertise itself as "coming soon" either — an empty section with a
  // heading is still an exposure decision nobody made.
  test("there is no empty guided-workflows shell", async ({ page }) => {
    await openWorkspace(page);
    await expect(page.getByText("Guided workflows")).toHaveCount(0);
  });
});

// ── FREE: discovery shape, once at least one pack is active ───────────────────────────────────
//
// Skipped until something is active. It does NOT activate anything itself: activation is the
// owner's act behind a three-plane gate, and a spec that activated a pack to make itself runnable
// would be a test manufacturing its own premise.
test.describe("@discovery an active pack is offered honestly", () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    const shown = await quickStarts(page).count();
    test.skip(shown === 0, "no pack is active on this deployment — nothing to assert yet");
  });

  test("every offered pack states what it produces and what it cannot see", async ({ page }) => {
    const cards = quickStarts(page).getByRole("listitem");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      // The output contract, before the run — one of the three code-owned promises.
      await expect(
        card.getByText(/Answers here in the chat|Saves a document to your vault|nothing is sent/),
      ).toBeVisible();
      // The preflight. Every pack in this pilot has at least one matrix-missing source, so a card
      // with no "cannot read" line is a card hiding the phase's primary deliverable.
      await expect(card.getByText(/cannot read|partly readable|can read/)).toBeVisible();
    }
  });

  // BRAND §6 / the UAT matrix: desktop AND narrow mobile. Two viewports is also what
  // `hasPassingPackBrowserEvidence` requires before it will honour a browser evidence row.
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`the quick starts are usable at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openWorkspace(page);
      const start = quickStarts(page)
        .getByRole("button", { name: /^Start / })
        .first();
      await expect(start).toBeVisible();
      await expect(start).toBeEnabled();
      // Nothing may overflow the viewport horizontally — the narrow column is the failing case.
      const box = await quickStarts(page).boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width);
    });
  }

  // No marketplace, no install state, no tool grants. The unit test asserts this over the rendered
  // component; this asserts it over the real page, where a parent could have added one.
  test("no install, enable or tool-grant control is anywhere near a pack", async ({ page }) => {
    const text = (await quickStarts(page).innerText()).toLowerCase();
    for (const forbidden of ["install", "marketplace", "enable", "add tool", "grant"]) {
      expect(text, `the quick starts render a "${forbidden}" control`).not.toContain(forbidden);
    }
  });
});

// ── PAID: a real pack turn ────────────────────────────────────────────────────────────────────
test.describe("@run starting a pack really runs the pack", () => {
  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
    test.skip((await quickStarts(page).count()) === 0, "no pack is active");
  });

  // Costs money. It asserts the SEAM, not the prose: a turn started, a thread was registered, and
  // the workspace's own in-flight signal behaved. Whether the OUTPUT is good is the eval runner's
  // question (`run-workflow-pack-evals.mjs`), not the browser's.
  test("a quick start opens a thread and the button reports itself busy", async ({ page }) => {
    const start = quickStarts(page)
      .getByRole("button", { name: /^Start / })
      .first();
    await start.click();
    await expect(start).toHaveAttribute("aria-busy", "true");
    // The thread is REGISTERED — a run that mints a thread nobody registers is a tab the user
    // cannot get back to.
    await expect(page.getByTestId("workspace-pane")).toBeVisible();
    await expect(quickStarts(page)).toHaveCount(0, { timeout: 120_000 });
  });
});

// ── LAST IN THE FILE, AND LAST IN THE RUN: anything that shells out to convex ─────────────────
//
// `convexRun` ends the browser session. Nothing below may navigate, and nothing above may run after
// it. Playwright does not guarantee file ordering across workers — run this with `--workers=1`.
test.describe("@drill rollback", () => {
  // ROLLBACK-TO-DARK IS OWED AND CANNOT BE DRILLED YET, and that is a real gap rather than a
  // scheduling detail. `skills.deactivatePack` is the product's dark path and it is an
  // `ownerMutation`, so `convex run` — which carries no identity — cannot call it. The only CLI
  // route left is the internal `archiveSkill`, and that is the command whose side effect
  // (`storageState` destroyed, next navigation lands on `/signin`) makes it unusable inside a spec.
  //
  // What closes this: an owner-facing deactivate CONTROL in the workspace, so the drill is a click
  // like every other browser assertion above. Until then, do not fake it — a green drill that never
  // turned a pack off is worse than a recorded gap.
  test.fixme("rollback-to-dark, driven by an owner in the browser", async ({ page }) => {
    await openWorkspace(page);
    // …click the owner's Turn off control, then assert the pack leaves `quickStarts`.
    expect(convexRun).toBeDefined();
  });

  // ROLLBACK-TO-PRIOR-VERSION is supported by the registry today (`activateSkill` on an earlier
  // version) and needs no CLI inside the browser session — but it needs a SECOND activated version
  // to roll back to, which no pack has while the pilot is dark.
  test.fixme("rollback to a prior pack version, once two versions have been activated", () => {});
});
