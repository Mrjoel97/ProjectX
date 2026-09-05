import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// 28-16: authenticated browser evidence for the CURRENT provider truth. The final lane gate is
// red on one open condition per provider, so this run proves the parked branch: no connector card
// and no revenue workflow may be reconstructed from built modules, credentials or active skill rows.
// When a lane later passes, the same spec must be extended with that exact provider's live journey;
// an absence run is not evidence that any provider worked.

const artifacts = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../output/playwright/revenue-pack",
);

const viewports = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const providers = ["hubspot", "quickbooks", "stripe", "paypal"] as const;

test("parked revenue lanes stay absent across authenticated responsive views", async ({ page }) => {
  // Convex Auth rotates the refresh token. Reusing one storageState in parallel contexts makes
  // those contexts race that one-time token and turns a responsive check into a sign-out test.
  // Keep every viewport in this one authenticated context instead.
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard/workspace");

    await expect(page).not.toHaveURL(/\/signin(?:\?|$)/);
    const workspace = page.getByTestId("workspace-pane");
    await expect(workspace).toBeVisible();

    // Positive settle signal first: without it, `count === 0` passes on first paint before Convex
    // answers and cannot prove a parked lane stayed hidden.
    await expect(workspace.getByTestId("revenue-pack-settled")).toHaveCount(1);
    await expect(workspace.getByRole("region", { name: "Revenue workflows" })).toHaveCount(0);
    await expect(workspace.getByText("PLAN", { exact: true })).toHaveCount(0);
    await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);

    const workspaceOverflow = await workspace.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(workspaceOverflow).toBeLessThanOrEqual(1);

    await page.goto("/dashboard/profile?tab=connections");
    const connections = page.getByRole("region", { name: "Connections" });
    await expect(connections).toBeVisible();
    // Microsoft is an independent positive settle signal on this page. Once its authenticated
    // status answered, the connector query has had a real render cycle before absence is checked.
    await expect(connections.getByTestId("connections-microsoft")).toContainText(
      /Connected|Not connected|Access token expires/,
    );
    await expect(connections.getByText("Checking connector availability…")).toHaveCount(0);
    for (const provider of providers) {
      await expect(connections.getByTestId(`connections-${provider}`)).toHaveCount(0);
    }

    const pageOverflow = await page
      .locator("html")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);

    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: resolve(artifacts, `${viewport.name}-parked.png`),
      fullPage: true,
    });
  }
});
