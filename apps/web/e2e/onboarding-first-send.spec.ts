import { expect, test } from "@playwright/test";

// BETA-03 browser proof. The fixture flag is opt-in because the journey requires the existing
// authenticated thin-profile/SMOKE seed; without it this file remains discoverable but never
// pretends an unseeded local stack is evidence. The flow stops at the governed plan/report UI and
// does not authorize a provider, send a real message, or claim release qualification.
test("thin onboarding → self-recipient offer → governed plan terminal", async ({ page }) => {
  test.skip(
    process.env.PIKAR_E2E_FIRST_SEND !== "1",
    "run only with the controlled thin-profile fixture enabled",
  );

  await page.goto("/dashboard/workspace");
  const offer = page.getByTestId("first-send-offer");
  await expect(offer).toBeVisible({ timeout: 20_000 });
  await expect(offer).toContainText("signed-in address");

  await offer.getByRole("button", { name: "Review first-send draft" }).click();
  await expect(page.getByRole("button", { name: "Review first-send draft" })).toHaveCount(0);
  // The governed plan and its email-draft preview intentionally repeat the subject.
  await expect(page.getByText("A first message from Pikar-AI").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();

  // The fixture path may refuse at the mailbox/postal boundary. In either case the same proposed
  // plan remains visible; no second plan or client-supplied recipient is accepted.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Approving…" })).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(
    page
      .locator('[role="alert"]:not(#__next-route-announcer__)')
      .or(page.getByText("REPORT", { exact: true }))
      .first(),
  ).toBeVisible({ timeout: 20_000 });
});
