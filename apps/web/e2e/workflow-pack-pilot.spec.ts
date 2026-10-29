import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PACK_BROWSER_MATRIX, validatePackBrowserScope } from "./workflowPackBrowserProtocol";

// Qualification material and account-bearing traffic must never enter test recordings.
test.use({ trace: "off", video: "off", screenshot: "off" });

// ══ 27-09 (PACK-02/PACK-04): the authenticated browser evidence plane for the pack pilot ═══════
//
// ⚠️ THIS SPEC HAS NEVER BEEN RUN GREEN. It was authored in the session that built the surfaces it
// drives, on a deployment whose model provider had no balance, so the paid half could not execute.
// Historical card/lifecycle receipts exist; the complete per-pack behavioral protocol is still
// missing. The @evidence block now REFUSES without calling the backend. Card-only reachability,
// stale files and imported artifacts cannot produce a new qualification receipt.
// Do NOT read discovery as coverage or record browser evidence from a partial pass — the pack gate
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

/**
 * 27-12: the SECOND copy of the deployment-target defect already fixed in `smokeRun.mjs`. This
 * helper spawned `convex run` with NO deployment flag, so a browser-evidence run pointed at
 * production by `PIKAR_E2E_BASE_URL` would have driven the PROD app and then written its evidence
 * to the DEV skills row — a run that certifies a deployment it never touched, which is the exact
 * failure the per-deployment rule exists to prevent. It is a separate copy because a .ts spec
 * cannot import the .mjs helper (see the note at the pinned-prompt pairing below).
 * Unflagged still means dev, so nothing reaches production without asking for it.
 */
const TARGET_ARGS = process.env.PIKAR_CONVEX_TARGET === "prod" ? ["--prod"] : [];

/**
 * IS THE TARGET A SHARED DEPLOYMENT? Guards the two DESTRUCTIVE drills below.
 *
 * MEASURED 2026-09-08, on production. 27-12 made this file runnable against prod so the pack
 * BROWSER EVIDENCE plane could be earned there — and every test already in the file inherited that
 * reach without being re-read under it. `@drill rollback` clicks "Turn off <pack>" and HAS NO
 * RESTORE STEP: it asserts the pack left the surface, asserts it came back as a candidate, and
 * stops. That is correct against a local deployment and an OUTAGE against a live one, and it is an
 * outage on a GREEN run — the failure that exposed it merely made it visible. `pack-business-pulse`
 * was left archived on production with no active row until it was re-activated by hand.
 *
 * The drills prove PRODUCT behaviour, not deployment-specific behaviour, so skipping them off-local
 * costs nothing: the browser-evidence plane is the only thing that genuinely needs prod, and it is
 * `@evidence`, not `@drill`. Guarding rather than restoring is deliberate — a restore step is one
 * more thing that can fail halfway, and it would still leave the pack dark for the seconds in
 * between, on a surface real users are looking at.
 *
 * Mirrors `provision-owner.setup.ts`, which hard-refuses any non-local deployment for the same
 * class of reason.
 */
const targetIsShared = !/127\.0\.0\.1|localhost/.test(appOrigin);

/** ⚠️ ENDS THE BROWSER SESSION. Never call this before a navigation you still need. */
function convexRun<T>(fn: string, args: Record<string, unknown>): T {
  const result = spawnSync(
    process.execPath,
    [convexBin, "run", ...TARGET_ARGS, fn, JSON.stringify(args)],
    {
      cwd: backendDir,
      encoding: "utf8",
    },
  );
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`${fn} failed:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
  try {
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    // A VOID FUNCTION PRINTS NOTHING, and that is a SUCCESS, not a failure. `recordPackBrowserEvidence`
    // returns no value, so `convex run` writes an empty stdout — `JSON.parse("")` then throws and the
    // call looks failed. This used to be masked on dev by the Windows/Node-24 libuv closing-handle
    // assertion below, which reliably dirtied stderr and tripped the rescue; production returned a
    // CLEAN stderr and the throw escaped, failing a write that had in fact succeeded.
    // `CLI_FAILURE` above is what decides failure. Reaching here with empty stdout and no failure
    // signature means the CLI ran the function and it returned nothing.
    if (!result.stdout.trim()) return undefined as T;
    throw new Error(`${fn} returned no valid result:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
}

const openWorkspace = async (page: Page) => {
  await page.goto(`${appOrigin}/dashboard/skills-workflows`);
  await expect(
    page.getByRole("heading", { name: "Skills and Workflows", exact: true }),
  ).toBeVisible();
  const manage = page.getByText("Review and manage workflows", { exact: true });
  if (await manage.count()) await manage.click();
};

/**
 * WAIT UNTIL THE PACK QUERIES HAVE ANSWERED, before asserting anything about what is or is not on
 * the page.
 *
 * **This is the difference between a guard and decoration, and it was measured.** `@dark` asserts
 * `toHaveCount(0)`, which SUCCEEDS ON ITS FIRST POLL — and on first paint the count is 0 because
 * the Convex query has not resolved. So `@dark` passed with all six packs ACTIVE and offered: the
 * central property of the phase was asserted by a test that could never fail. Absence needs a
 * settle signal exactly as much as presence does.
 *
 * The signal is a positive one: for the OWNER exactly one of the two owner sections is always
 * rendered once the queries land — candidates while the pilot is dark, live controls once anything
 * is active. Waiting for either proves the data arrived without assuming which state we are in.
 * Falls through after the timeout rather than throwing, so a non-owner run still asserts (it just
 * cannot settle on this signal, and says so by being slow rather than by being wrong).
 */
const settlePackQueries = async (page: Page) => {
  await Promise.race([
    candidates(page).waitFor({ state: "visible", timeout: 20_000 }),
    ownerControls(page).waitFor({ state: "visible", timeout: 20_000 }),
  ]).catch(() => undefined);
};

const quickStarts = (page: Page) => page.getByRole("region", { name: "Guided workflows" });

/** The OWNER's candidate preview (27-11). A DIFFERENT region from the quick starts on purpose: the
 *  `@dark` block proves the pilot is invisible by requiring "Guided workflows" to be empty, and a
 *  preview rendering into that region would make those assertions pass for a reason they do not
 *  mean. This one is expected to be non-empty for the owner while packs are candidates. */
const candidates = (page: Page) =>
  page.getByRole("region", { name: "Candidate workflows — owner preview" });

/** The OWNER's live-pack controls (27-11) — the turn-off switch, and the settle signal that tells
 *  `@dark` the pack queries have answered when something IS active. */
const ownerControls = (page: Page) =>
  page.getByRole("region", { name: "Live workflows — owner controls" });

/** Card TITLE -> pack id. The titles are code-owned in `@pikar/core`'s `WORKFLOW_PACKS`; this spec
 *  cannot import that (it drives a built app), so the pairing is stated once here and a title that
 *  is not in it fails the candidate-card assertion rather than silently skipping a pack. */
const TITLE_TO_PACK: Record<string, string> = {
  "Business pulse": "business-pulse",
  "Campaign plan": "campaign-plan",
  "Customer complaint reply": "customer-complaint",
  "Sales call prep": "sales-call-prep",
  "Process / SOP": "process-sop",
  "Brand review": "brand-review",
  "Offer and lead plan": "offer-and-lead-plan",
};

// FREE and offline: enumerate the actual intended per-pack obligations without a page,
// account, CLI or provider fixture. Passing these prepares inputs; it proves no browser journey.
// The @evidence refusal below deliberately remains unchanged until real journeys are earned.
test.describe("@protocol-fixture offline per-pack browser matrix preparation", () => {
  test("fixture scope and matrix integrity — no browser journeys observed", () => {
    validatePackBrowserScope();
    expect(PACK_BROWSER_MATRIX).toHaveLength(6 * 9 * 2);
    const keys = new Set<string>();
    for (const row of PACK_BROWSER_MATRIX) {
      keys.add(`${row.packId}:${row.cell}:${row.viewport.name}`);
      expect(row.instructions.length).toBeGreaterThan(0);
      expect(row.prerequisites.length).toBeGreaterThanOrEqual(3);
      expect(row.liveStatus).toBe("not-observed");
      expect(row.evidenceWritable).toBe(false);
      expect(row.viewport.width).toBeGreaterThan(0);
      expect(row.viewport.height).toBeGreaterThan(0);
    }
    expect(keys.size).toBe(PACK_BROWSER_MATRIX.length);
  });
});

// ── FREE: the pilot is dark, and the product proves it ────────────────────────────────────────
/**
 * IS ANY PACK LIVE ON THIS DEPLOYMENT? Asked OUT OF BAND, through the CLI, and that is the point.
 *
 * `@dark` asserts a property that only holds WHILE EVERY PACK IS A CANDIDATE. On production two
 * packs are now active, so the block fails where it should skip — and the obvious guard is a TRAP:
 * the block's own assertion is `expect(quickStarts).toHaveCount(0)`, so skipping when a pack IS
 * offered would make it unfalsifiable. This exact block once PASSED WITH ALL SIX PACKS ACTIVE,
 * which is what that failure mode looks like from the outside.
 *
 * So the precondition is read from the DEPLOYMENT, never from the page under assertion. `loadSkill`
 * fails closed with `NO_ACTIVE_SKILL` when a name has no active row, so a throw for every pack means
 * dark and one success means live. Memoised: seven CLI round trips, asked once.
 */
let packLive: boolean | null = null;
const somePackIsLive = (): boolean => {
  if (packLive !== null) return packLive;
  packLive = Object.values(TITLE_TO_PACK).some((packId) => {
    try {
      return (
        convexRun<{ version?: number } | null>("skills:getActiveSkill", {
          name: `pack-${packId}`,
        })?.version !== undefined
      );
    } catch {
      return false;
    }
  });
  return packLive;
};

test.describe("@dark the pilot is invisible while every pack is a candidate", () => {
  // OUT OF BAND — see `somePackIsLive`. Reading the DEPLOYMENT rather than the page under
  // assertion is what keeps this a skip-when-inapplicable instead of a check that cannot fail.
  test.skip(somePackIsLive, "a pack is live on this deployment — the pilot is not dark");

  // THE CENTRAL PROPERTY OF THE PHASE, asserted at the surface a real user looks at rather than
  // at the query. Six candidates exist on this deployment right now; not one may be offered.
  test("no guided workflow is offered at all", async ({ page }) => {
    await openWorkspace(page);
    await settlePackQueries(page);
    await expect(quickStarts(page)).toHaveCount(0);
    // And no pack name leaks into the ORDINARY surface some other way — a heading, a menu item, a
    // tooltip.
    //
    // SCOPED PAST THE OWNER SECTIONS since 27-11, and the distinction is the property itself. The
    // owner's candidate preview shows pack names BY DESIGN while the pilot is dark — that is what it
    // is for, and it says "Not live" on it. What must never happen is a pack being OFFERED, so every
    // occurrence of a pack name has to be accounted for by an owner-only region. A name appearing
    // anywhere else still fails, which is what this is guarding.
    for (const title of [
      "Business pulse",
      "Campaign plan",
      "Customer complaint reply",
      "Sales call prep",
      "Process / SOP",
      "Brand review",
      "Offer and lead plan",
    ]) {
      const everywhere = await page.getByText(title, { exact: true }).count();
      const inOwnerOnly =
        (await candidates(page).getByText(title, { exact: true }).count()) +
        (await ownerControls(page).getByText(title, { exact: true }).count());
      expect(
        everywhere - inOwnerOnly,
        `"${title}" appears outside the owner-only sections while the pilot is dark`,
      ).toBe(0);
    }
  });

  // A dark pilot must not advertise itself as "coming soon" either — an empty section with a
  // heading is still an exposure decision nobody made.
  test("there is no empty guided-workflows shell", async ({ page }) => {
    await openWorkspace(page);
    await settlePackQueries(page);
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
    await settlePackQueries(page);
    const shown = await quickStarts(page).count();
    test.skip(shown === 0, "no pack is active on this deployment — nothing to assert yet");
  });

  test("every offered pack states what it produces and what it cannot see", async ({ page }) => {
    // SCOPED TO THE CARD, not `getByRole("listitem")`: `WorkflowPackPreflight` renders an <li> per
    // SOURCE inside each card, so the role query matches the cards AND every source row.
    const cards = quickStarts(page).locator("li.pack-quickstart");
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      // READ THE CARD'S TEXT rather than locating by it. A preflight lists several sources, so a
      // `getByText` regex resolves to MANY elements and dies of strict mode instead of asserting —
      // measured: this test could never have passed, which is why it had never been run green.
      const cardText = await cards.nth(i).innerText();
      // The output contract, before the run — one of the three code-owned promises.
      expect(
        cardText,
        `a quick start states no output contract: ${cardText.slice(0, 120)}`,
      ).toMatch(/Answers here in the chat|Saves a document to your vault|nothing is sent/);
      // The preflight. Every pack in this pilot has at least one matrix-missing source, so a card
      // with no "cannot read" line is a card hiding the phase's primary deliverable.
      expect(cardText, `a quick start states no preflight: ${cardText.slice(0, 120)}`).toMatch(
        /cannot read|partly readable|can read/,
      );
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
    await settlePackQueries(page);
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
      // WAIT BEFORE COUNTING. `locator.count()` does NOT auto-wait — it answers immediately — and
      // this section only exists once the Convex query resolves, so counting straight after the
      // navigation always saw 0 and skipped. MEASURED: every @preview test skipped on a deployment
      // where the cards were demonstrably rendering. Waiting first, then counting, keeps the skip
      // honest for the genuinely-empty case without faking the populated one.
      await region.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
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

      // SCOPED TO THE CARD, not `getByRole("listitem")`: `WorkflowPackPreflight` renders each
      // source as its own <li> INSIDE the card, so the role query matches the cards AND every
      // source row, and the loop walks into a row that has no version badge and times out.
      const cards = region.locator("li.pack-candidate");
      const n = await cards.count();
      expect(n).toBeGreaterThan(0);

      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        // The preflight — every pack in this pilot has at least one matrix-missing source, so a
        // card with no "cannot read" line is hiding the phase's primary deliverable. Read the
        // card's TEXT rather than locating by it: a preflight lists several sources, so a
        // `getByText` regex resolves to many elements and dies of strict mode instead of asserting.
        const cardText = await card.innerText();
        expect(
          cardText,
          `a candidate card rendered no preflight: ${cardText.slice(0, 120)}`,
        ).toMatch(/cannot read|partly readable|can read/);
        // The version the browser is looking at, captured for the evidence row.
        const badge = await card.locator(".pack-candidate-badge").innerText();
        // CASE-INSENSITIVE: the pill is `text-transform: uppercase` (BRAND §5), so `innerText` comes
        // back "CANDIDATE V2" and a case-sensitive match silently finds nothing.
        const m = /Candidate v(\d+)/i.exec(badge.trim());
        expect(m, `a candidate card rendered no version badge: "${badge}"`).not.toBeNull();
        const title = (await card.getByRole("heading").innerText()).trim();
        expect(TITLE_TO_PACK[title], `unknown candidate card: ${title}`).toBeDefined();
        expect(Number(m?.[1])).toBeGreaterThan(0);

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
  // A real pack turn is minutes. The inner `expect` already allowed 180s; the TEST did not, so it
  // died on Playwright's 30s default while the run it started was still going.
  test("pressing Preview really starts the candidate", async ({ page }) => {
    test.setTimeout(300_000);
    await openWorkspace(page);
    const region = candidates(page);
    await region.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
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

// ── FAIL-CLOSED: no browser evidence until the full per-pack protocol exists ───────────────────
// The former writer promoted persisted title/version observations to pass:true with two assumed
// viewports and one assumed passing case. That proves neither the current run nor 27-09's useful,
// partial/refusal, edit/reject, injection/privacy and recovery protocol. Remove its file importer
// and backend call entirely; old private observations and accepted registry receipts are untouched.
//
// Do not replace this refusal with artifact import or a caller-provided pass boolean. A future
// writer must derive evidence from this run's completed required cases, bind exact deployment,
// candidate/body/version and actual viewport outcomes, and refuse missing/failed/skipped cells.
// Independent owner judgment remains a separate act. This does not change the backend gate.
test.describe("@evidence full per-workflow browser acceptance", () => {
  test("refuses evidence while the required behavioral protocol is missing", () => {
    throw new Error(
      "PACK_BROWSER_PROTOCOL_MISSING: no evidence was written. " +
        "Current-run exact candidate/version/viewport observations and completed per-pack " +
        "useful, partial/refusal, edit/reject, injection/privacy and recovery outcomes are required. " +
        "Card reachability, historical files and imported artifacts cannot qualify a workflow. " +
        "See .planning/phases/48-readiness-and-qualification-closure/48-BROWSER-PREPARATION.md.",
    );
  });
});

test.describe("@drill rollback", () => {
  // ROLLBACK-TO-DARK, DRIVEN BY AN OWNER IN THE BROWSER. This was `fixme` until 27-11 because the
  // only dark path was `npx convex run skills:archiveSkill`, and one `convex run` against the local
  // deployment DESTROYS the browser session — the next navigation lands on /signin. So the drill
  // could not be a browser assertion at all, and rollback-to-dark was proven by NOTHING while six
  // packs sat one owner click away from being live. `skills.deactivatePack` + the owner control in
  // the workspace make it a click like every other assertion in this file.
  //
  // IT IS A REAL ROUND TRIP: the pack must be live at the start, gone from the quick starts after,
  // and the run must leave the deployment as it found it.
  test("an owner can turn a live pack off, and everyone stops being offered it", async ({
    page,
  }) => {
    test.skip(targetIsShared, `refusing to darken a live pack on ${appOrigin}`);
    test.setTimeout(120_000);
    await openWorkspace(page);

    const controls = page.getByRole("region", { name: "Live workflows — owner controls" });
    await controls.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    test.skip(
      (await controls.count()) === 0,
      "no pack is live, or this browser is not the owner — nothing to roll back",
    );

    // The pack we are about to darken, by name, so the assertion afterwards is about THIS one.
    const row = controls.locator("li.pack-owner-control").first();
    const title = (await row.innerText()).split("·")[0]?.trim() ?? "";
    expect(title.length).toBeGreaterThan(2);

    // It really is on offer to everyone right now — otherwise "it left" proves nothing.
    const offered = quickStarts(page).getByRole("button", { name: `Start ${title}` });
    await expect(offered).toBeVisible({ timeout: 20_000 });

    await row.getByRole("button", { name: `Turn off ${title}` }).click();

    // GONE from the surface every user sees, and the owner is told plainly.
    await expect(offered).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText(new RegExp(`${title} is off`, "i"))).toBeVisible();

    // And it is BACK as a candidate — turning off archives the active row, it does not delete the
    // version, so the owner can preview and re-activate it.
    const preview = candidates(page);
    await preview.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    await expect(
      preview.getByRole("button", { name: `Preview ${title}` }),
      "a turned-off pack must come back as a candidate, not vanish",
    ).toBeVisible({ timeout: 20_000 });
  });

  // ROLLBACK TO A PRIOR VERSION, driven by an owner in the browser. It needs a pack with TWO
  // versions that have both been live — the newest archived row is the target — so it skips rather
  // than fabricates one: a drill that activated its own precondition would be proving the harness,
  // not the product.
  //
  // THE EXEMPTION IS THE POINT. `planGlobalActivation` gates on `status === "candidate"`, so an
  // ARCHIVED row goes back WITHOUT re-running the evidence planes. That is deliberate — rollback
  // must work mid-incident and must never be blocked by a broken eval or browser harness — and this
  // is the only test that exercises it from the surface an owner would actually use.
  test("an owner can roll a live pack back to its previous version", async ({ page }) => {
    test.skip(targetIsShared, `refusing to roll back a live pack on ${appOrigin}`);
    test.setTimeout(120_000);
    await openWorkspace(page);

    const controls = ownerControls(page);
    await controls.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    test.skip((await controls.count()) === 0, "no pack is live, or this browser is not the owner");

    const row = controls
      .locator("li.pack-owner-control", {
        has: page.locator("button.pack-owner-roll-back"),
      })
      .first();
    test.skip(
      (await row.count()) === 0,
      "no pack has a previous live version to roll back to — nothing to drill",
    );

    const before = (await row.innerText()).replace(/\s+/g, " ").trim();
    const title = before.split("·")[0]?.trim() ?? "";
    const liveNow = /live v(\d+)/.exec(before)?.[1];
    const target = /Roll back to v(\d+)/.exec(before)?.[1];
    expect(title.length, `could not read the pack title from "${before}"`).toBeGreaterThan(2);
    expect(target, `no roll-back target in "${before}"`).toBeTruthy();
    // The two must DIFFER, or "it rolled back" would be indistinguishable from nothing happening.
    expect(target).not.toBe(liveNow);

    await row.getByRole("button", { name: `Roll back ${title} to v${target}` }).click();

    // The owner is told, and the row now reports the OLD version as live.
    await expect(page.getByText(new RegExp(`${title} is back on v${target}`, "i"))).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      controls.locator("li.pack-owner-control").filter({ hasText: title }),
    ).toContainText(`live v${target}`, { timeout: 30_000 });

    // AND IT IS STILL OFFERED. A rollback that darkened the pack would be an outage, not a
    // rollback — the whole point is that users keep a working version.
    await expect(
      quickStarts(page).getByRole("button", { name: `Start ${title}` }),
      "a rolled-back pack must still be on offer",
    ).toBeVisible({ timeout: 30_000 });
  });
});
