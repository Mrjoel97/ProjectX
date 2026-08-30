import { expect, type Locator, type Page, test } from "@playwright/test";

// ══ 29-10 — the two-identity half of the pack gate, IN ITS OWN FILE ═══════════════════════════
//
// IT LIVES HERE BECAUSE OF A MEASURED INTERACTION, not tidiness. In `workflow-packs.spec.ts` this
// test is the fourth to run in a `mode: "serial"` file, and there it hangs for the FULL timeout on
// tenant A's own pack list — the `Brand review` button never becomes clickable — while passing in
// ~10s when run alone, and still hanging after being given a completely fresh browser context for
// A. So it is not the reused `page`: the trigger is something the serial WORKER accumulates.
// Playwright gives each spec file its own worker process, which is why splitting it fixes it.
//
// ROOT CAUSE, FOUND 2026-08-30 AND REPRODUCED DETERMINISTICALLY. It is not positional and it is not
// this test: **a rapid `page.goto` loop poisons the NEXT page in the same browser context.**
//
// A four-test serial probe, each test loading /dashboard/workflows and counting the buttons inside
// `main.canvas-main` after a fixed 6s settle:
//
//     baseline                 buttons=14  chars=3791
//     inside the reload loop   buttons=14  chars=3791   <- the looping page itself is FINE
//     immediately after it     buttons=0   chars=0      <- the NEXT test renders nothing
//
// Five identical tests with NO loop all read buttons=14, so it is the loop and not the position.
// In the failing state the shell is painted and the route is right (`settle()` succeeds on the
// heading), the session is valid (`Sign out` present, no redirect), there are no console errors —
// the client subscriptions simply never resolve, so every `useQuery` stays undefined and the page
// content never mounts. Consistent with Convex websockets from the abandoned navigations not being
// released before the next client opens one.
//
// WHY THAT MATTERS BEYOND THIS FILE: `workflow-packs.spec.ts`'s persistence test drives exactly such
// a loop (`expect(...).toPass()` re-reads by reloading), so ANY test after it in the same worker
// inherits the poisoned context. Splitting this file fixes it because Playwright gives each spec
// file its own worker and therefore its own browser context. If a third test ever needs to follow a
// reload loop, give it its own file too — or stop reloading to re-read.

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
  await expect(page.getByRole("heading", { name: "Make a workflow fit your business" })).toBeVisible(
    { timeout: 20_000 },
  );
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

test.describe("two identities — one tenant's customization is not another's", () => {
  const emailB = process.env.E2E_USER_B_EMAIL;
  const passwordB = process.env.E2E_USER_B_PASSWORD;
  test.skip(
    !emailB || !passwordB,
    "E2E_USER_B_EMAIL / E2E_USER_B_PASSWORD name no second account on this deployment",
  );

  // Two full sign-ins, two settles, a save and a second browser context — comfortably past
  // Playwright's 30s default, which is what failed here first (a bare `Test timeout exceeded`, not
  // a locator problem). It passes alone in ~10s; the budget is for the serial run.
  test.setTimeout(120_000);

  test("B opens the same pack and does not see A's words", async ({ browser }) => {
    // BOTH identities get a FRESH context, A included. Reusing the shared `page` — which three
    // earlier tests in this serial file have already navigated, saved through and reload-looped —
    // made this test hang on A's own pack list for the full timeout while passing in isolation.
    // An isolation test should own both sides of the comparison rather than inherit one of them.
    const contextA = await browser.newContext({ storageState: STORAGE_STATE });
    const pageA = await contextA.newPage();
    const main = await settle(pageA);
    test.skip(main === null, "no pack is active on this deployment");
    const section = await openCustomizer(main as Locator);
    // READ A's value rather than writing a new one. The persistence test above already saved a
    // customization for this tenant and pack, and there is exactly ONE row per (tenant, pack) — so
    // writing again here is a redundant mutation of shared state that made this test slower and
    // order-dependent for no extra proof. What isolation needs is a string that IS A's and is not
    // B's, and A's stored value is exactly that.
    const term = await section.getByLabel(FIELDS[0]).inputValue();
    expect(term, "tenant A has no saved customization to be isolated from").not.toBe("");

    // B from a CLEAN context — no cookies, no localStorage, no shared storageState.
    const contextB = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const pageB = await contextB.newPage();
    try {
      await pageB.goto("/signin");
      await pageB.getByLabel("Email Address").fill(emailB as string);
      await pageB.getByLabel("Password", { exact: true }).fill(passwordB as string);
      await pageB.getByRole("button", { name: /sign in/i }).click();
      await expect(pageB.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15_000 });

      const mainB = (await settle(pageB)) as Locator;
      test.skip(mainB === null, "no pack is active for B");
      const sectionB = await openCustomizer(mainB);
      // The field is B's own — empty, or B's own words, but never A's.
      await expect(sectionB.getByLabel(FIELDS[0])).not.toHaveValue(term);
      expect(await mainB.innerText()).not.toContain(term);
    } finally {
      await contextB.close();
      await contextA.close();
    }
  });
});

