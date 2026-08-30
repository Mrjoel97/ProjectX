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
// The plan asks for "exact-version activation" and "rollback". **NEITHER IS REACHABLE IN THIS
// RELEASE AND THIS FILE DOES NOT PRETEND OTHERWISE.** `planTenantActivation` refuses every `pack-*`
// name with `PACK_GATE`, fail-closed, and both activation and rollback are `ownerMutation`. On top
// of that `cockpit.ts` passes no `tenantSkillIds`, so a published customization is INERT: a run
// uses the approved template. The honest consequences ARE asserted — that no control offers
// activation, and that the surface never calls a saved customization live or pending — but the
// activation path itself is recorded as not met in `29-10-SUMMARY.md` rather than faked here.
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

async function settle(page: Page): Promise<Locator | null> {
  await page.setViewportSize({ width: 1280, height: 1400 });
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
