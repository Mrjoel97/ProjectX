import { expect, test } from "@playwright/test";

// SC1: the divider drags, clamps each pane to >=20%, keyboard-nudges, and the split
// survives a reload (localStorage, per-user). aria-valuenow is the persisted split %, so
// asserting on it is resilient to layout/pixel drift.
test("divider drags + clamps >=20% + nudges + persists across reload", async ({ page }) => {
  await page.goto("/dashboard/workspace");
  const handle = page.getByTestId("split-handle");
  await expect(handle).toBeVisible();

  // Default split is 30% left.
  expect(Number(await handle.getAttribute("aria-valuenow"))).toBe(30);

  // Drag the handle to the far left — past the clamp — to prove it STOPS at 20%, not 0%.
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, hb.y + hb.height / 2, { steps: 10 });
  await page.mouse.up();

  const clamped = Number(await handle.getAttribute("aria-valuenow"));
  expect(clamped).toBeGreaterThanOrEqual(20); // never below the 20% floor
  expect(clamped).toBeLessThanOrEqual(21); // rounding tolerance
  expect(clamped).toBeLessThan(30); // it actually moved left

  // Keyboard nudge: ArrowRight adds ~2%.
  await handle.focus();
  await handle.press("ArrowRight");
  const nudged = Number(await handle.getAttribute("aria-valuenow"));
  expect(nudged).toBe(clamped + 2);

  // Persist across reload.
  await page.reload();
  const persisted = Number(await page.getByTestId("split-handle").getAttribute("aria-valuenow"));
  expect(persisted).toBe(nudged);
});
