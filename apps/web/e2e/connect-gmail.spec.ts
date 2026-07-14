import { expect, test } from "@playwright/test";

// Groundwork E2E (SC-prereq): the Connect-Gmail page and the cockpit gate both resolve to a
// BOUNDED state — no eternal spinner. This verifies the already-landed 18c8442 fix (the `(app)`
// `<Authenticated>` gate) by observation; it does NOT re-touch layout.tsx's auth gate. Signed-in
// via storageState (auth.setup.ts). Also covers the `gmailConnectUrl` residual flagged in
// RESEARCH-ui §2.1: the consent CTA must resolve, not hang on "Preparing consent link…".

test("connect-gmail resolves to a bounded state (no eternal spinner)", async ({ page }) => {
  await page.goto("/connect-gmail");
  await expect(page.getByRole("heading", { name: "Connect Gmail" })).toBeVisible();

  // Status resolves: either the consent CTA (unconnected/reconnect) or the "Gmail connected" panel.
  await expect(
    page.getByRole("link", { name: /connect gmail/i }).or(page.getByText("Gmail connected")),
  ).toBeVisible({ timeout: 15_000 });

  // The loading placeholders are gone — neither the status probe nor the connect-URL mint hangs.
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByText("Preparing consent link…")).toHaveCount(0);
});

test("workspace gate resolves (no eternal spinner) — the 18c8442 fix", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  // The shell renders regardless of mailbox state (both panes present).
  await expect(page.getByRole("heading", { name: "Pikar AI" })).toBeVisible();

  // The composer gate resolves to EITHER the composer OR the Connect-Gmail CTA — never stuck loading.
  await expect(
    page
      .getByPlaceholder("Describe your goal…")
      .or(page.getByRole("link", { name: "Connect Gmail to start planning" })),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("chat-pane").getByText("Loading…")).toHaveCount(0);
});
