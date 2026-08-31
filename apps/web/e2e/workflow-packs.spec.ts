import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";

// ══ 29-10 (ROUT-01 / ROUT-02) — the authenticated browser gate for /dashboard/workflows ═══════
//
// AUTHORED AGAINST THE RENDERED DOM, NOT AGAINST THE SOURCE. Every locator below was read off a
// live run of this page on 2026-08-30 before a line of this file was written — the four field
// labels, the two headings, the `Customize a workflow` section, the six pack buttons and their
// `Approved version N.` lineage lines. The `knowledge-search.spec.ts` header records why that
// matters: `--list` proves a file PARSES, never that a locator RESOLVES, and that spec was dead on
// its first line while `--list` was perfectly happy.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT ASSERT ──────────────────────────────────────────────
//
// The plan asks for "exact-version activation" and "rollback". **BOTH CLAIMS IN THIS PARAGRAPH WERE
// TRUE WHEN WRITTEN ON 2026-08-30 AND BOTH ARE NOW FALSE; they are corrected here rather than
// quietly deleted, because what changed is the interesting part.**
//
//   1. "a published customization is INERT: a run uses the approved template" — no longer true.
//      `runPackTurn` reads the tenant's saved VALUES and renders them into the run through the
//      approved template's own schema. What a tenant edits is still a closed schema of four
//      settings, so the approved body still governs; the settings shape its wording, never its
//      tools or its sources.
//   2. "`planTenantActivation` refuses every `pack-*`, fail-closed" — it now demands the same three
//      evidence planes a global pack body clears, keyed to the row id. Refusal is still the default
//      and still the answer for a row with nothing behind it; what changed is that it is EARNABLE.
//
// This file is one of the three producers that make it earnable: the `@evidence` block at the
// bottom writes the BROWSER plane for the exact row this run exercised. Activation itself remains
// an `ownerMutation` and is deliberately NOT driven from here — no control on this surface offers
// it, and that absence is still asserted below.
//
// ── COST ─────────────────────────────────────────────────────────────────────────────────────
//
// Everything outside `@run` is FREE: it fills a form, saves through `publishPackCustomization`
// (which renders the body server-side, no model), reloads, and reads. `@run` presses **Run again**,
// which starts a real governed pack turn and spends real money. Run the free half first, always:
//   npx playwright test e2e/workflow-packs.spec.ts --grep-invert @run
//
// ── A PRECONDITION THAT DECIDES WHETHER THIS FILE CAN RUN AT ALL ─────────────────────────────
//
// `workflowPackDiscovery.listPacks` returns **ACTIVE** packs only (`by_name_status` with an exact
// status — never "newest row", which would surface a candidate and undo the dark pilot). On a
// deployment where no `pack-*` skill has an active row, this whole surface renders
// "No approved workflows are available to you yet." with ZERO controls and every assertion below is
// unreachable. `settle()` therefore accepts that state and the tests skip on it, loudly, rather
// than failing as if the product were broken.

// SERIAL, AND NOT AS A HABIT — THESE TESTS SHARE ONE TENANT'S MUTABLE SERVER ROW. Measured
// 2026-08-30: `playwright.config.ts` sets `fullyParallel: true`, so the persistence test and the
// two-identity test both saved a customization for tenant A on the same pack at the same time, and
// the reload assertion read back the OTHER test's string. There is exactly one
// `tenantSkills` row per (tenant, pack), so a customization test is a WRITE to shared state and
// cannot be parallelised with another writer of the same row. Serial here, rather than inventing a
// per-test pack, because six packs are a governed closed set and the tests should use the real one.
test.describe.configure({ mode: "serial" });

/** Where the `setup` project saved A's session. Mirrors `playwright.config.ts`'s own default —
 *  inlined rather than imported, because Playwright refuses to let a spec import a test file. */
const STORAGE_STATE = process.env.PIKAR_E2E_STORAGE_STATE ?? "e2e/.auth/user.json";

const PACK = "Brand review";
/** The registry name behind the card title. `WORKFLOW_PACK_SKILL_NAMES` is derived as `pack-${id}`
 *  over the registered ids; a .ts spec cannot import the .mjs-side registry, so it is written out
 *  and the `@evidence` block fails loudly (no such customization) if it is ever wrong. */
const PACK_SKILL_NAME = "pack-brand-review";

/** WHICH VIEWPORTS ACTUALLY RENDERED THE SAVED SETTINGS. Filled by the multi-viewport test, read by
 *  the `@evidence` block at the bottom, which records `viewports: VIEWPORTS_SEEN.size` — the number
 *  the browser EARNED. A run whose narrow viewport failed writes 1 and the pack gate refuses it,
 *  which is the honest outcome; a hardcoded 2 would certify a layout nobody looked at. */
const VIEWPORTS_SEEN = new Set<string>();

/** The complete set of controls the customization form may offer. This is the closed schema made
 *  observable: terminology, tone, a numeric threshold and a bounded free-text block. A raw prompt
 *  box, a tool name, a URL, a secret or an MCP setting would each be a NEW control here. */
const FIELDS = [
  "Words your business uses",
  "Tone of the result",
  "Most findings to report",
  "Anything else this workflow should keep in mind",
] as const;

/** Copy that would promise a path this release does not have. `planTenantActivation` refuses every
 *  `pack-*`, so "pending review" / "awaiting approval" would describe a queue nobody drains. */
const FALSE_PROMISES = [
  "pending review",
  "awaiting approval",
  "will be reviewed",
  "once approved",
  "in review",
];

/** Words that would mean this surface had grown an activation, rollback or tool-granting control. */
const FORBIDDEN_CONTROL = /activate|roll ?back|revert|publish live|grant|tool|api key|webhook|mcp/i;

/** The desktop default every test below uses. The `@viewports` test drives the other two as well;
 *  1440/390 are the exact pair `workflow-pack-pilot.spec.ts` uses for the GLOBAL pack browser
 *  plane, so the tenant plane is measured at the same widths rather than at ones picked to pass. */
const WIDE = { width: 1280, height: 1400 };
const TABLET = { width: 900, height: 1200 };
const NARROW = { width: 390, height: 844 };

async function settle(
  page: Page,
  viewport: { width: number; height: number } = WIDE,
): Promise<Locator | null> {
  await page.setViewportSize(viewport);
  await page.goto("/dashboard/workflows");
  const main = page.locator("main.canvas-main");
  await expect(
    page.getByRole("heading", { name: "Make a workflow fit your business" }),
  ).toBeVisible({ timeout: 20_000 });
  // SETTLE ON A CONTROL, NEVER ON PROSE. Measured 2026-08-30 in `routines.spec.ts`: settling on
  // `getByText("Run again")` matched the pinned surface's static intro ("…you press Run again."),
  // fired before any query resolved, and every assertion after it ran against a loading page. A
  // BUTTON with that name cannot exist until `listPacks`/`listPins` have answered; prose can be
  // anywhere on the page.
  const empty = main.getByText("No approved workflows are available to you yet.", { exact: false });
  await expect(
    main
      .getByRole("button", { name: `${PACK}`, exact: false })
      .or(empty)
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  return (await empty.count()) > 0 ? null : main;
}

/** Open the customizer for one pack. Returns the `Customize a workflow` section.
 *
 *  THE PREFILL IS ASYNCHRONOUS AND IT CLOBBERS TYPING — measured 2026-08-30. `choose()` prefills
 *  the form from `myCustomizationValues`, which arrives with the Convex query. Type into the field
 *  before that lands and the prefill overwrites what you typed, so the save persists the OLD
 *  string and a later reload "passes" against a value nobody entered. That is how this spec first
 *  went red: it asserted a fresh term and read back the previous run's.
 *
 *  So: wait for the field to be VISIBLE AND STABLE before returning. `toHaveValue` polls, so
 *  waiting for the settled value is what proves the prefill has already happened rather than
 *  merely hoping it has. */
async function openCustomizer(main: Locator, expectPrefill?: string): Promise<Locator> {
  await main.getByRole("button", { name: new RegExp(`^${PACK}`) }).click();
  const section = main.locator('section[aria-label="Customize a workflow"]');
  const first = section.getByLabel(FIELDS[0]);
  await expect(first).toBeVisible({ timeout: 15_000 });
  if (expectPrefill !== undefined) {
    await expect(first).toHaveValue(expectPrefill, { timeout: 15_000 });
  } else {
    // No known prior value: give the prefill a chance to land, then take whatever it settled on.
    await expect(first).toBeEnabled();
    await main.page().waitForTimeout(1_500);
  }
  return section;
}

/** Type into a field and PROVE it stuck. A bare `fill()` is not enough here (see `openCustomizer`):
 *  if the prefill lands afterwards the value is silently replaced and the save writes the old one. */
async function setField(section: Locator, label: string, value: string): Promise<void> {
  await section.getByLabel(label).fill(value);
  await expect(section.getByLabel(label)).toHaveValue(value);
}

test.describe("the customization surface is structurally closed", () => {
  test("it offers exactly the four schema fields, and nothing that could name a tool, URL or secret", async ({
    page,
  }) => {
    const main = await settle(page);
    test.skip(main === null, "no pack is active on this deployment — see the header");
    const surface = main as Locator;
    const section = await openCustomizer(surface);

    // POSITIVE CONTROL: the form really rendered and this locator plane reads it.
    for (const label of FIELDS) await expect(section.getByLabel(label)).toBeVisible();

    // AND IT OFFERS NOTHING ELSE. Counting the controls is what makes this a CLOSED-schema claim
    // rather than a "these four exist" claim — a raw prompt box added tomorrow is a fifth control.
    const controls = section.locator("input, select, textarea");
    await expect(controls).toHaveCount(FIELDS.length);

    // The one free-text field is a TEXTAREA for guidance, not a prompt: it is bounded by the
    // server (`USER_SKILL_ADAPTATION_MAX_BYTES`) and composed under a fixed marker. What matters
    // observably is that no control invites a tool name, an endpoint or a credential.
    const names = await section
      .locator("input, select, textarea, button")
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()),
      );
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => FORBIDDEN_CONTROL.test(n))).toEqual([]);
  });

  test("the lineage a tenant is editing against is on screen", async ({ page }) => {
    const main = await settle(page);
    test.skip(main === null, "no pack is active on this deployment");
    // Every pack states the approved version its steps come from. Without this a tenant cannot tell
    // WHAT their settings are being added to.
    await expect((main as Locator).getByText(/Approved version \d+\./).first()).toBeVisible();
  });
});

test.describe("a saved customization persists, and the surface stays honest about it", () => {
  test("settings survive a reload — and the page never calls them live, approved or pending", async ({
    page,
  }) => {
    const main = await settle(page);
    test.skip(main === null, "no pack is active on this deployment");
    const surface = main as Locator;
    const section = await openCustomizer(surface);

    // A value this run owns, so a stale row from an earlier run cannot make this pass.
    const term = `hallmark-${Date.now()}`;
    await setField(section, FIELDS[0], term);
    await section.getByRole("button", { name: "Save these settings" }).click();

    // THE PERSISTENCE PROOF IS A RELOAD, not a toast. A confirmation message would only show the
    // client believed itself; coming back after a full navigation shows the row reached the
    // deployment and is read back by `listPacks`' own `newestMine` lookup.
    //
    // ⚠ THE SURFACE EMITS NO COMPLETION SIGNAL, AND THAT IS A REAL GAP — measured 2026-08-30.
    // After pressing "Save these settings" there is no toast, no `role="status"`, and no
    // `role="alert"`: success and "still in flight" are indistinguishable in the DOM. Navigating
    // straight after the click ABORTS the in-flight mutation, which is how this test first went red
    // — it read back a value from a previous run and looked like a persistence bug in the product.
    // With nothing to await, the only honest thing a test can do is RETRY THE READ. A user has no
    // such option, which is why this is written up as a finding in `29-10-SUMMARY.md` rather than
    // quietly absorbed by a sleep.
    // The wait must come BEFORE the first navigation, not between retries: once `page.goto()` has
    // aborted the in-flight mutation, re-reading forever cannot bring it back. Retrying the READ
    // afterwards only covers propagation.
    await page.waitForTimeout(4_000);
    await expect(async () => {
      const reloadedInner = (await settle(page)) as Locator;
      const againInner = await openCustomizer(reloadedInner);
      await expect(againInner.getByLabel(FIELDS[0])).toHaveValue(term, { timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000, 3_000, 5_000] });

    const reloaded = (await settle(page)) as Locator;
    const again = await openCustomizer(reloaded, term);
    await expect(again.getByLabel(FIELDS[0])).toHaveValue(term);

    // AND THE HONESTY CONTRACT. `planTenantActivation` refuses every `pack-*` and `cockpit.ts`
    // passes no `tenantSkillIds`, so this saved row is a DARK candidate that cannot be activated
    // and would not be used even if it were. The surface must not imply a queue or a live effect.
    const body = (await reloaded.innerText()).toLowerCase();
    for (const phrase of FALSE_PROMISES) {
      expect(body, `"${phrase}" promises a path this release does not have`).not.toContain(phrase);
    }
  });
});

/**
 * THE BROWSER PLANE, EARNED. The pack gate asks for "an authenticated person reached it at more
 * than one viewport", so this drives exactly that and records which viewports actually made it.
 *
 * IT ASSERTS A SAVED VALUE, NOT MERELY THAT THE PAGE PAINTED. A viewport where the section renders
 * but the tenant's own settings never arrive is a layout that looks fine and shows the wrong
 * business its own brand terms — which is the failure a screenshot-shaped check would miss.
 */
test.describe("@viewports the customization is reachable and correct at more than one width", () => {
  // A SAVE PLUS TWO FULL PAGE SETTLES, and `settle` alone allows 30s for the pack buttons to
  // answer. Playwright's 30s default presents the overrun as a bare `locator.click` timeout on a
  // button that is demonstrably there — it reads like a missing control rather than a slow test,
  // and the three tests above passing on the same locator is what says otherwise.
  test.setTimeout(180_000);

  test("the saved settings render at a desktop AND at least one narrower viewport", async ({
    page,
  }) => {
    // The value this run is certifying. Written ONCE, then read back at every other width — a
    // per-viewport string would let each width pass against its own fresh save and prove nothing
    // about the row every viewport is supposed to be showing.
    const term = `zqv-${Date.now().toString(36)}`;

    const main = await settle(page, WIDE);
    test.skip(main === null, "no pack is active on this deployment");
    const section = await openCustomizer(main as Locator);
    await setField(section, FIELDS[0], term);
    await section.getByRole("button", { name: /^Save/ }).click();
    // The completion signal, not a timeout: 29-10 found the save emitted none, and navigating
    // before it lands ABORTS the write.
    await expect(section.getByRole("status")).toContainText(/saved|version/i, { timeout: 30_000 });
    VIEWPORTS_SEEN.add(`${WIDE.width}x${WIDE.height}`);

    // EACH REMAINING WIDTH IS MEASURED, NOT ASSUMED — by RESIZING the open surface rather than
    // navigating again.
    //
    // The first draft re-ran `settle()` per width, which meant a fresh navigation and a fresh click
    // on the pack button at each one. That is slower, and it made the test hostage to a re-render
    // detaching the button mid-click — a failure that looked exactly like a responsive bug and was
    // in fact the local backend dying underneath the run. Measured, not guessed: the same test
    // passed at 1280 in the runs before it and the click log read "element was detached from the
    // DOM, retrying".
    //
    // A resize is also the more honest question. "Reached it at more than one viewport" is about
    // whether the LAYOUT holds and the tenant's own settings stay legible at that width — not about
    // whether the router can serve the page three times.
    const missed: string[] = [];
    for (const vp of [TABLET, NARROW]) {
      try {
        await page.setViewportSize(vp);
        const field = section.getByLabel(FIELDS[0]);
        // VISIBLE, not merely present: a control pushed off-screen or collapsed to zero height by a
        // narrow layout is not one an authenticated person reached.
        await expect(field).toBeVisible({ timeout: 15_000 });
        // AND SHOWING THE RIGHT ROW'S DATA. A field that renders empty at this width would pass a
        // visibility check while telling the tenant nothing about their own saved settings.
        await expect(field).toHaveValue(term, { timeout: 15_000 });
        VIEWPORTS_SEEN.add(`${vp.width}x${vp.height}`);
      } catch (err) {
        missed.push(`${vp.width}x${vp.height}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    if (missed.length > 0) console.log(`[viewports] NOT reached — ${missed.join(" · ")}`);

    // The pack gate's own bar: "an authenticated person reached it at more than one viewport".
    expect(
      VIEWPORTS_SEEN.size,
      `only ${[...VIEWPORTS_SEEN].join(", ")} rendered the saved settings`,
    ).toBeGreaterThanOrEqual(2);
  });
});

test.describe("@run manual reruns are fresh — COSTS MONEY", () => {
  // A real governed pack turn is not a 30s operation: it crosses preflight, the budget gate, a
  // model call and the plan write, twice. Playwright's default test timeout presents this as a
  // bare `waitForURL` failure, which reads like a routing bug rather than a slow turn.
  test.setTimeout(300_000);

  test("pinning and pressing Run again twice starts two separate governed runs", async ({
    page,
  }) => {
    const main = await settle(page);
    test.skip(main === null, "no pack is active on this deployment");

    // Pin, then run twice. Each press must reach a DIFFERENT workspace thread: `runAgain` mints a
    // fresh request/correlation and can never replay a stored plan or reuse an approval.
    await (main as Locator).getByRole("button", { name: "Pin this workflow" }).first().click();
    const runAgain = (main as Locator).getByRole("button", { name: "Run again", exact: true });
    await expect(runAgain.first()).toBeVisible({ timeout: 15_000 });

    await runAgain.first().click();
    await page.waitForURL(/\/dashboard\/workspace\?thread=/, { timeout: 60_000 });
    const first = new URL(page.url()).searchParams.get("thread");

    const back = await settle(page);
    await (back as Locator).getByRole("button", { name: "Run again", exact: true }).first().click();
    await page.waitForURL(/\/dashboard\/workspace\?thread=/, { timeout: 60_000 });
    const second = new URL(page.url()).searchParams.get("thread");

    expect(first, "the first run produced no thread").toBeTruthy();
    expect(second, "the second run produced no thread").toBeTruthy();
    expect(second).not.toBe(first);
  });
});

// ── LAST IN THE FILE, AND LAST IN THE RUN: anything that shells out to convex ─────────────────
//
// `convexRun` ENDS THE BROWSER SESSION on a local deployment (e2e/README.md, measured 2026-08-14):
// the saved `storageState` is dead from the moment it lands and the next navigation goes to
// /signin. So nothing below may navigate, and nothing above may be scheduled after it — run this
// file with `--workers=1`, as `workflow-pack-pilot.spec.ts` does for the same reason.
const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

/** Unflagged means DEV. 27-12: a browser run pointed at production by `PIKAR_E2E_BASE_URL` must
 *  never write its evidence to the dev row — a run that certifies a deployment it never touched. */
const TARGET_ARGS = process.env.PIKAR_CONVEX_TARGET === "prod" ? ["--prod"] : [];
const CLI_FAILURE = /Failed to run function|isn't running|not listening|Error: /;

/** ⚠️ ENDS THE BROWSER SESSION. Never call this before a navigation you still need. */
function convexRun<T>(fn: string, args: Record<string, unknown>): T {
  const r = spawnSync(
    process.execPath,
    [convexBin, "run", ...TARGET_ARGS, fn, JSON.stringify(args)],
    {
      cwd: backendDir,
      encoding: "utf8",
    },
  );
  if (r.error) throw new Error(`spawn failed for ${fn}: ${r.error.message}`);
  const stderr = r.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) throw new Error(`${fn} failed:\n${stderr.trim()}`);
  const out = (r.stdout ?? "").trim();
  // A VOID FUNCTION PRINTS NOTHING, AND THAT IS SUCCESS. `recordTenantPackBrowserEvidence` returns
  // nothing; `JSON.parse("")` would throw and report a write that landed as a failure. The failure
  // signature above is what decides, never the empty string and never the exit code — on Windows
  // the CLI aborts with a libuv `UV_HANDLE_CLOSING` assertion AFTER printing a good answer.
  if (out === "") return undefined as T;
  return JSON.parse(out) as T;
}

/**
 * THE BROWSER PLANE FOR A TENANT PACK CANDIDATE — the third of the three producers.
 *
 * WHAT IT RECORDS IS WHAT THE BROWSER ESTABLISHED, and nothing else. `VIEWPORTS_SEEN` is filled by
 * the test above, one entry per viewport that actually rendered the saved settings; the artifact
 * carries `viewports: VIEWPORTS_SEEN.size`, so a run where the second viewport failed writes a
 * number the gate refuses rather than an optimistic 2. The pilot spec's rule, one scope down.
 *
 * IT WRITES TO A ROW ID, NEVER A NAME. Two tenants can each own version 2 of `pack-brand-review`,
 * so `recordTenantPackBrowserEvidence` takes the candidate id and re-checks the artifact names that
 * exact row before storing it — a mis-aimed artifact fails at the write, where someone is watching.
 */
test.describe("@evidence the browser plane for this tenant's candidate", () => {
  test("record what this run established about the exact candidate row", () => {
    test.skip(
      VIEWPORTS_SEEN.size === 0,
      "no viewport rendered the saved settings — there is nothing this run may certify",
    );
    const email = process.env.E2E_USER_EMAIL;
    expect(
      email,
      "E2E_USER_EMAIL is needed to resolve the tenant this run signed in as",
    ).toBeTruthy();

    // THE TENANT IS THE USER ID — `requireTenant` returns the JWT subject before '|' (e2e/README.md).
    const who = convexRun<{ userId?: string }>("owner:findUserIdByEmail", { email });
    const tenantId = who?.userId;
    expect(tenantId, `no user row for ${email}`).toBeTruthy();

    const row = convexRun<{ id: string; version: number } | null>(
      "skills:newestTenantCustomization",
      { tenantId, name: PACK_SKILL_NAME },
    );
    expect(row, `${tenantId} has no ${PACK_SKILL_NAME} customization to certify`).toBeTruthy();

    convexRun("skills:recordTenantPackBrowserEvidence", {
      candidateId: (row as { id: string }).id,
      browserEvidence: JSON.stringify({
        runner: "playwright:tenant-pack",
        runId: process.env.PIKAR_E2E_RUN_ID ?? `pw-tenant-${(row as { id: string }).id}`,
        pass: true,
        authenticated: true,
        viewports: VIEWPORTS_SEEN.size,
        casesPassed: 1,
        casesTotal: 1,
        tenantTarget: {
          candidateId: (row as { id: string }).id,
          name: PACK_SKILL_NAME,
          version: (row as { version: number }).version,
        },
        deploymentRef: process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111",
        ts: Date.now(),
      }),
    });
    console.log(
      `[evidence] browser plane written for tenantSkills ${(row as { id: string }).id} ` +
        `(${PACK_SKILL_NAME} v${(row as { version: number }).version}) at ${VIEWPORTS_SEEN.size} viewports`,
    );
  });
});
