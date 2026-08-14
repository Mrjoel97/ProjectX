import { expect, test } from "@playwright/test";

// SC1: the /dashboard/workspace cockpit renders a two-pane shell under the (app) auth gate.
// Auth comes from the storageState set up in auth.setup.ts.
test("cockpit renders both panes under the auth gate", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  // Both titled panes are present (the operating shell renders regardless of Gmail state).
  // Headings follow the brand chrome: "Pikar AI" (chat) + the canvas heading, which is the
  // time-of-day business prompt on an empty canvas and "Live work canvas" once a thread is active.
  await expect(page.getByRole("heading", { name: "Pikar AI" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /What should we move forward\?|Live work canvas/ }),
  ).toBeVisible();
  await expect(page.getByTestId("split-handle")).toBeVisible();

  // No email prerequisite and no eternal spinner: the business composer is always available.
  await expect(page.getByPlaceholder("What business outcome should we work on?")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: "Connect Gmail to start planning" })).toHaveCount(0);
});
