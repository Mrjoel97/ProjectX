import { expect, test } from "@playwright/test";

// Repository-only Google OAuth readiness. These checks stop at the consent URL: they never click
// the link, leave Pikar, authorize a grant, mutate a provider, or claim the consent screen ran.
test.describe("Google OAuth readiness before the provider boundary", () => {
  test("loading resolves to an honest configured or unavailable terminal state", async ({ page }) => {
    await page.goto("/connect-gmail");
    await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();
    await expect(
      page.getByTestId("gmail-connect-link").or(page.getByTestId("gmail-unconfigured")),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("gmail-status-loading")).toHaveCount(0);
    await expect(page.getByTestId("gmail-link-loading")).toHaveCount(0);
  });

  test("configured consent link has the shared grant and is inspected without navigation", async ({
    page,
  }) => {
    await page.goto("/connect-gmail");
    const link = page.getByTestId("gmail-connect-link");
    const unavailable = page.getByTestId("gmail-unconfigured");
    await expect(link.or(unavailable)).toBeVisible({ timeout: 15_000 });

    if (await link.isVisible()) {
      const href = await link.getAttribute("href");
      const url = new URL(href as string);
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("state")).toMatch(/\./);
      const scope = url.searchParams.get("scope") ?? "";
      for (const capability of [
        "gmail.modify",
        "calendar.freebusy",
        "calendar.events",
        "drive.readonly",
      ]) {
        expect(scope).toContain(capability);
      }
      await expect(page).toHaveURL(/\/connect-gmail/);
    } else {
      await expect(unavailable).toContainText(/has not been configured/i);
    }
  });

  test("callback errors are mapped and hostile input is never rendered", async ({ page }) => {
    const hostile = "<img src=x onerror=alert(1)>";
    await page.goto(`/connect-gmail?gmailError=${encodeURIComponent(hostile)}`);
    const alert = page.getByTestId("gmail-error");
    await expect(alert).toHaveText("Google connection failed. Please try again.");
    await expect(page.locator("img[src='x']")).toHaveCount(0);

    await page.goto("/connect-gmail?gmailError=missing_refresh");
    await expect(page.getByTestId("gmail-error")).toContainText(/lasting access/i);
  });

  test("connected state offers reconnect and disconnect with honest revocation semantics", async ({
    page,
  }) => {
    await page.goto("/connect-gmail");
    await expect(
      page.getByTestId("gmail-connect-link").or(page.getByTestId("gmail-unconfigured")),
    ).toBeVisible({ timeout: 15_000 });

    if (await page.getByTestId("gmail-connected").isVisible()) {
      await expect(page.getByTestId("gmail-connect-link")).toHaveText("Reconnect Google");
      await expect(page.getByTestId("gmail-disconnect")).toBeVisible();
    } else {
      await expect(page.getByText(/Pikar needs your consent/)).toBeVisible();
      await expect(page.getByTestId("gmail-disconnect")).toHaveCount(0);
    }
  });
});
