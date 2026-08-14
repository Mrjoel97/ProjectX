import { expect, test } from "@playwright/test";

// Groundwork E2E (SC-prereq): the optional Connect-Gmail page and the cockpit both resolve to a
// BOUNDED state — no eternal spinner. This verifies the already-landed 18c8442 fix (the `(app)`
// `<Authenticated>` gate) by observation; it does NOT re-touch layout.tsx's auth gate. Signed-in
// via storageState (auth.setup.ts). Also covers the `gmailConnectUrl` residual flagged in
// RESEARCH-ui §2.1: the consent CTA must resolve, not hang on "Preparing consent link…".

test("connect-gmail resolves to a bounded state (no eternal spinner)", async ({ page }) => {
  await page.goto("/connect-gmail");
  await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();

  // Status resolves: the consent CTA, the connected panel, or a bounded configuration warning.
  await expect(
    page
      .getByRole("link", { name: /connect google/i })
      .or(page.getByText("Google connected"))
      .or(page.getByRole("alert")),
  ).toBeVisible({ timeout: 15_000 });

  // The loading placeholders are gone — neither the status probe nor the connect-URL mint hangs.
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByText("Preparing consent link…")).toHaveCount(0);
});

test("workspace is usable without an upstream Gmail gate — the 18c8442 fix", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  // The operating shell and its composer render regardless of email-channel state.
  await expect(page.getByRole("heading", { name: "Pikar AI" })).toBeVisible();
  await expect(page.getByPlaceholder("What business outcome should we work on?")).toBeVisible({
    timeout: 15_000,
  });
  // Connecting Gmail is never a prerequisite for planning or using non-email capabilities.
  await expect(page.getByRole("link", { name: "Connect Gmail to start planning" })).toHaveCount(0);
  await expect(page.getByTestId("chat-pane").getByText("Loading…")).toHaveCount(0);
});
