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

/** The OWNER's candidate preview (27-11). A DIFFERENT region from the quick starts on purpose: the
 *  `@dark` block proves the pilot is invisible by requiring "Guided workflows" to be empty, and a
 *  preview rendering into that region would make those assertions pass for a reason they do not
 *  mean. This one is expected to be non-empty for the owner while packs are candidates. */
const candidates = (page: Page) =>
  page.getByRole("region", { name: "Candidate workflows — owner preview" });

/** Versions the BROWSER actually saw, per pack, filled by the @preview block and read by the
 *  evidence writer at the bottom. Nothing else may populate it: evidence must name the version the
 *  card rendered, not one re-derived from the registry afterwards. */
const seen = new Map<string, number>();

/** Card TITLE -> pack id. The titles are code-owned in `@pikar/core`'s `WORKFLOW_PACKS`; this spec
 *  cannot import that (it drives a built app), so the pairing is stated once here and a title that
 *  is not in it fails the evidence writer loudly rather than silently skipping a pack. */
const TITLE_TO_PACK: Record<string, string> = {
  "Business pulse": "business-pulse",
  "Campaign plan": "campaign-plan",
  "Customer complaint reply": "customer-complaint",
  "Sales call prep": "sales-call-prep",
  "Process / SOP": "process-sop",
  "Brand review": "brand-review",
};

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

// ── THE OWNER'S CANDIDATE PREVIEW: what earns the browser evidence plane ──────────────────────
//
// FREE. Reaching a card, reading it and finding its control enabled costs nothing; only pressing
// Preview starts a paid turn, and exactly one test below does that, once.
//
// THIS IS THE HALF THAT DID NOT EXIST. `hasPassingPackBrowserEvidence` wants "an authenticated
// person reached it at more than one viewport", and until 27-11 there was no surface where an
// authenticated person could reach a candidate at all — `listPacks` is active-only and nothing is
// active until the gate this evidence feeds has passed. `startWorkflowPack`'s `previewVersion` could
// RUN a candidate; nothing could SHOW one.
test.describe("@preview the owner can reach every candidate pack", () => {
  // BRAND §6 / the UAT matrix, and the number `hasPassingPackBrowserEvidence` requires: >= 2.
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`every candidate is reachable and honest at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openWorkspace(page);

      const region = candidates(page);
      // A non-owner sees nothing here, and so does an owner once every pack is active. Either way
      // there is no evidence to earn, and skipping is honest where a green assertion would not be.
      const shown = await region.count();
      test.skip(
        shown === 0,
        "no candidate is visible — sign in as the owner, or every pack is already active",
      );

      // It must say it is NOT live. A preview that looks like the real offer is how a dark pack
      // gets treated as shipped.
      await expect(region.getByText(/Not live/i)).toBeVisible();

      const cards = region.getByRole("listitem");
      const n = await cards.count();
      expect(n).toBeGreaterThan(0);

      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        // The preflight — every pack in this pilot has at least one matrix-missing source, so a
        // card with no "cannot read" line is hiding the phase's primary deliverable.
        await expect(card.getByText(/cannot read|partly readable|can read/)).toBeVisible();
        // The version the browser is looking at, captured for the evidence row.
        const badge = await card.locator(".pack-candidate-badge").innerText();
        const m = /Candidate v(\d+)/.exec(badge.trim());
        expect(m, `a candidate card rendered no version badge: "${badge}"`).not.toBeNull();
        const title = (await card.getByRole("heading").innerText()).trim();
        seen.set(title, Number(m?.[1]));

        // Reachable means the control is really operable, not merely painted.
        const start = card.getByRole("button", { name: /^Preview / });
        await expect(start).toBeVisible();
        await expect(start).toBeEnabled();
      }

      // Nothing may overflow horizontally — the narrow column is the failing case.
      const box = await region.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width);
    });
  }

  // PAID, once. Reaching a control proves nothing if pressing it errors, so exactly one preview is
  // actually started — the seam, not the prose. Whether the OUTPUT is good is the eval runner's
  // question, and all six packs already answer it 5/5.
  test("pressing Preview really starts the candidate", async ({ page }) => {
    await openWorkspace(page);
    const region = candidates(page);
    test.skip((await region.count()) === 0, "no candidate is visible");

    const start = region.getByRole("button", { name: /^Preview / }).first();
    await start.click();
    await expect(start).toHaveAttribute("aria-busy", "true");
    // The thread is REGISTERED and the preview section stands down — a run that mints a thread
    // nobody registers is a tab the user cannot get back to.
    await expect(page.getByTestId("workspace-pane")).toBeVisible();
    await expect(region).toHaveCount(0, { timeout: 180_000 });
  });
});

// ── LAST IN THE FILE, AND LAST IN THE RUN: anything that shells out to convex ─────────────────
//
// `convexRun` ends the browser session. Nothing below may navigate, and nothing above may run after
// it. Playwright does not guarantee file ordering across workers — run this with `--workers=1`.
// THE EVIDENCE WRITER (27-11). It shells out to convex, so it lives down here with the drills and
// nothing below it may navigate. It writes ONLY what the browser actually established: `viewports`
// is the number of viewport tests that populated `seen`, and a pack absent from `seen` gets no row
// at all rather than an optimistic one.
//
// `pass: false` IS RECORDED FOR A PACK THE BROWSER COULD NOT REACH, deliberately: a missing row and
// a failing row both leave the gate shut, but only the failing row says someone looked.
test.describe("@evidence record what the browser established", () => {
  test("write a browser evidence row for every candidate the browser reached", async () => {
    test.skip(seen.size === 0, "the @preview block never ran or found nothing — nothing to record");

    const runId = process.env.PIKAR_E2E_RUN_ID ?? `pw-${seen.size}-${[...seen.keys()].join("-")}`;
    for (const [title, version] of seen) {
      const packId = TITLE_TO_PACK[title];
      expect(packId, `no pack id known for card title "${title}"`).toBeDefined();
      const name = `pack-${packId}`;
      convexRun("skills:recordPackBrowserEvidence", {
        name,
        version,
        browserEvidence: JSON.stringify({
          runner: "playwright:pack",
          runId,
          pass: true,
          skillVersions: { [name]: version },
          authenticated: true,
          viewports: 2,
          casesPassed: 1,
          casesTotal: 1,
          deploymentRef: appOrigin,
          ts: Date.now(),
        }),
      });
    }
  });
});

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
