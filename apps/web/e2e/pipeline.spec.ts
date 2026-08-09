import { expect, type Page, test } from "@playwright/test";

// PIPE-01 / SC#8 browser evidence for the connected Pipeline route.
//
// ── THIS SPEC HAS NEVER EXECUTED. IT IS **NOT RUN**. ─────────────────────────────────────────────
// It was AUTHORED in plan 19-07 and is RUN by the owner at 19-10 — the 18-07 → 18-09 precedent.
// Nothing below is evidence of anything until someone runs it and reads the result.
//
// **A `--list` is NOT a run.** `playwright test --list` only proves the file parses and that the
// two tests are discoverable. **A blank/empty result means NOT RUN — never that it passed.** Both
// 26-05 and 26-10 stopped inside the canonical `auth.setup.ts` for want of credentials and produced
// exactly that shape of output; do not read it as green.
//
// WHAT A REAL RUN NEEDS, and why an executor cannot produce one:
//   • `playwright.config.ts` pins `baseURL` to `http://127.0.0.1:3111` and has **no `webServer`
//     block** — specs run against an ALREADY-RUNNING stack. Start it yourself.
//   • a live `convex dev` (NOT `--once`) for the local deployment the app talks to.
//   • Next serving on `:3111` (`pnpm --filter @pikar/web dev`, or a production build; the dev
//     server has OOM'd on heavy dashboard pages before).
//   • `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` in the environment. `auth.setup.ts` signs in once and
//     saves `e2e/.auth/user.json`; without those two variables it stops there and every test below
//     is skipped rather than failed. An executor cannot mint them.
//
// Resume command, verbatim:
//   pnpm --filter @pikar/web test:e2e -- e2e/pipeline.spec.ts
//
// ── PRECONDITION FOR TEST 1 ─────────────────────────────────────────────────────────────────────
// The first test pins the EMPTY-tenant state, which is what makes the second one non-vacuous: a
// "the tiles show numbers" assertion against a tenant that already had contacts proves nothing
// about a fresh workspace. It therefore needs the e2e tenant to have NO contacts, and the file runs
// `serial` so it observes that state before test 2 creates one. **On a re-run against the same
// tenant, test 1 fails because the tenant is no longer empty — that is a precondition failure, not
// a product defect.** Use a fresh `E2E_USER_EMAIL`, or read the failure for what it is.
//
// ponytail: no reset seam. The upgrade path, if this becomes annoying at 19-10, is a `__`-prefixed
// `internalMutation` in `convex/contacts.ts` that clears the tenant's contacts/followUps/
// suppressions (the `__seedOnboardedTenant` convention) plus an entry in that module's internal
// export-set pin. Deliberately not built for a spec that has never run.
//
// The route is reachable BY URL ONLY. The nav item is still `soon: true` and 26-18 owns flipping
// it, so the last assertion of test 2 is that no Pipeline link exists in the rail — activation
// cannot happen by accident.

const ROUTE = "/dashboard/pipeline";
const CONTACT_EMAIL = "pipeline-e2e@example.com";

test.describe.configure({ mode: "serial" });

/** The rendered value of one tile, as an integer. A tile that rendered a dash or "Unknown" makes
 *  this throw, which is the invariant-3 assertion stated as a parse. */
async function tileValue(page: Page, id: string): Promise<number> {
  const text = await page.getByTestId(`pipeline-tile-${id}`).locator(".stat-value").innerText();
  const value = Number.parseInt(text.trim(), 10);
  expect(Number.isInteger(value), `tile ${id} rendered "${text}" rather than a number`).toBe(true);
  return value;
}

test("an empty tenant reads four real zeroes and the one-action empty state", async ({ page }) => {
  await page.goto(ROUTE);

  await expect(page.getByTestId("pipeline-tiles")).toBeVisible();
  for (const id of ["needing-attention", "followups-due", "consent", "suppressed"]) {
    expect(await tileValue(page, id)).toBe(0);
  }
  // Never a hedge where a counted zero belongs.
  await expect(page.getByTestId("pipeline-tiles")).not.toContainText("Unknown");
  await expect(page.getByTestId("pipeline-tiles")).not.toContainText("—");

  // The table is REPLACED by the empty state, with exactly one action and no mailbox suggestions.
  await expect(page.getByTestId("pipeline-empty")).toBeVisible();
  await expect(page.getByTestId("add-first-contact")).toBeVisible();
  await expect(page.getByTestId("pipeline-contact-row")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-empty")).not.toContainText(/suggest/i);

  // The contactless section renders its own empty state, not the table's.
  await expect(page.getByRole("heading", { name: /nobody attached/i })).toBeVisible();
});

test("a contact can be added, suppressed, and un-suppressed in two deliberate clicks", async ({
  page,
}) => {
  await page.goto(ROUTE);

  // Create through the real UI — the only way a contact row may come into existence (invariant 1:
  // nothing accretes from reading the mailbox).
  const firstAction = page.getByTestId("add-first-contact");
  const opener = (await firstAction.count()) > 0 ? firstAction : page.getByTestId("add-contact");
  await opener.click();
  await page.getByTestId("add-contact-form").getByLabel("Email address").fill(CONTACT_EMAIL);
  await page.getByTestId("add-contact-form").getByLabel("Name (optional)").fill("Pipeline E2E");
  await page.getByTestId("add-contact-save").click();

  const row = page.getByTestId("pipeline-contact-row").filter({ hasText: CONTACT_EMAIL });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("No contact yet");
  await expect(row).toContainText("none on record");
  await expect(row).toContainText("Nothing scheduled");

  // A follow-up filed against the contact moves the "needing attention" tile off this person.
  const attentionBefore = await tileValue(page, "needing-attention");
  await row.getByTestId("contact-add-followup").click();
  await row
    .getByTestId("contact-followup-form")
    .getByLabel("Follow-up note")
    .fill("Send the quote");
  await row.getByTestId("contact-followup-form").getByLabel("Due date").fill("2026-12-01");
  await row.getByRole("button", { name: "Save follow-up" }).click();
  await expect(row).toContainText("Send the quote");
  await expect
    .poll(() => tileValue(page, "needing-attention"))
    .toBe(Math.max(attentionBefore - 1, 0));

  // Marking suppressed moves the contact into the suppressed count.
  const suppressedBefore = await tileValue(page, "suppressed");
  await row.getByTestId("contact-suppress").click();
  await expect.poll(() => tileValue(page, "suppressed")).toBe(suppressedBefore + 1);

  // Un-suppressing is TWO clicks, and the first one only arms. No browser modal is involved — a
  // `window.confirm` would block the page and this spec could not drive it at all.
  await expect(row.getByTestId("contact-unsuppress-confirm")).toHaveCount(0);
  await row.getByTestId("contact-unsuppress-arm").click();
  await expect(row).toContainText(/your responsibility/i);
  await row.getByTestId("contact-unsuppress-confirm").click();
  await expect.poll(() => tileValue(page, "suppressed")).toBe(suppressedBefore);
  await expect(row.getByTestId("contact-suppress")).toHaveCount(1);

  // The contactless section is its own section beneath the table, and the follow-up filed against
  // a PERSON above never appears in it.
  const unassigned = page.getByTestId("pipeline-unassigned");
  if ((await unassigned.count()) > 0) await expect(unassigned).not.toContainText("Send the quote");
  await expect(page.getByRole("heading", { name: /nobody attached/i })).toBeVisible();

  // 26-18 owns the nav. Activation is adding the href, so its absence is asserted here.
  await expect(page.locator('nav a[href="/dashboard/pipeline"]')).toHaveCount(0);
});
