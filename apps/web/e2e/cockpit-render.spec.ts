import { expect, test } from "@playwright/test";

// SC1: the /dashboard/workspace cockpit renders a two-pane shell under the (app) auth gate.
// Auth comes from the storageState set up in auth.setup.ts.
test("cockpit renders both panes under the auth gate", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  // Both titled panes are present (the shell renders regardless of Gmail state).
  await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  await expect(page.getByTestId("split-handle")).toBeVisible();

  // No eternal spinner: the gate resolves to EITHER the composer OR the Connect-Gmail CTA.
  await expect(
    page
      .getByPlaceholder("Describe your goal…")
      .or(page.getByRole("link", { name: "Connect Gmail to start planning" })),
  ).toBeVisible({ timeout: 15_000 });
});
