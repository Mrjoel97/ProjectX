import { expect, type Page } from "@playwright/test";

/** Use only after the controlled B session and server-side handoff pins are qualified. */
export async function verifyPhase23PublicRefusal(page: Page) {
  await page.goto("/ops/qualification-check");
  await expect(page.getByTestId("phase23-access-identity")).toHaveText("B_IDENTITY_MATCH");
  await page.getByRole("button", { name: "Verify access once", exact: true }).click();
  await expect(page.getByTestId("phase23-access-result")).toHaveText("OWNER_REQUIRED");
  return {
    publicMutation: "skills:activateAgentCandidate" as const,
    code: "OWNER_REQUIRED" as const,
  };
}
