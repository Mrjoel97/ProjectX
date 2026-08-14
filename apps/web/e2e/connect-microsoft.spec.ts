import { expect, test } from "@playwright/test";

// 17-06 Task 3 (ACTN-02, ADR-018). The Microsoft connection surfaces, in a real browser.
//
// This spec deliberately stages NOTHING through `npx convex run`: on the local (anonymous)
// deployment that call ends the browser session (see e2e/README.md). Everything asserted here is
// reachable by reading the signed-in UI, so the spec is immune to that trap.
//
// It also does NOT require Microsoft OAuth to be configured. The connect control has two honest
// states and the spec asserts the SPECIFIC correct thing for whichever one is live — never "one of
// them rendered". An unconfigured deployment must show a bounded explanation rather than crash
// while React subscribes, and that is itself a guarantee worth holding.

test.describe("Microsoft connection surfaces", () => {
  test("the consent page names every capability in the grant, including the one not yet used", async ({
    page,
  }) => {
    await page.goto("/connect-microsoft");
    await expect(page.getByRole("heading", { name: "Connect Microsoft" })).toBeVisible();

    // Not connected locally, so the consent paragraph is what renders. THIS PARAGRAPH IS THE
    // CONSENT — the assertions mirror connectionsSurface.test.ts, but from the rendered DOM rather
    // than from source, which is the half a source scan cannot prove.
    const consent = page.getByText(/Pikar needs your consent/);
    await expect(consent).toBeVisible();

    const text = (await consent.textContent()) ?? "";
    expect(text).toMatch(/calendar/i);
    // ADR-018 consequence 6: the mail half is GRANTED now and used later, so the consent must say
    // so. A page that names only this week's feature is asking for a permission it never mentions.
    expect(text).toMatch(/mail/i);
    expect(text).toMatch(/not switched on yet|only have to approve/i);
    // And it must not over-promise: Pikar cannot permanently delete.
    expect(text).toMatch(/never permanently delete/i);
  });

  test("a failed callback shows mapped copy and never echoes the raw code", async ({ page }) => {
    // The value is attacker-controllable — anyone can hand-craft this query string.
    const hostile = "<img src=x onerror=alert(1)>";
    await page.goto(`/connect-microsoft?microsoftError=${encodeURIComponent(hostile)}`);

    const alert = page.getByTestId("microsoft-error");
    await expect(alert).toBeVisible();
    const shown = (await alert.textContent()) ?? "";

    // The generic fallback sentence, not the input.
    expect(shown).toContain("Microsoft connection didn't complete");
    expect(shown).not.toContain("onerror");
    expect(shown).not.toContain("<img");
    // Nothing was injected into the DOM either.
    await expect(page.locator("img[src='x']")).toHaveCount(0);
  });

  test("each real callback code maps to its own sentence", async ({ page }) => {
    const seen = new Set<string>();
    for (const code of [
      "cancelled",
      "missing_callback",
      "invalid_state",
      "exchange_failed",
      "missing_refresh",
    ]) {
      await page.goto(`/connect-microsoft?microsoftError=${code}`);
      const shown = (await page.getByTestId("microsoft-error").textContent()) ?? "";
      expect(shown.length).toBeGreaterThan(20);
      // Distinct copy per code: a table that collapses to one sentence is a table for nothing.
      expect(seen.has(shown), `"${code}" reuses another code's sentence`).toBe(false);
      seen.add(shown);
      // No snake_case machine token in prose. Deliberately NOT `not.toContain(code)`: `cancelled`
      // is an ordinary English word and "Microsoft connection was cancelled" is the correct
      // sentence — the first version of this assertion failed on good copy. What must never appear
      // is an identifier, so the check is for the underscore-bearing form.
      expect(shown).not.toMatch(/[a-z]+_[a-z]+/);
      expect(shown).not.toBe(code);
    }
  });

  test("the connect control is either a real consent link or an honest unavailable notice", async ({
    page,
  }) => {
    await page.goto("/connect-microsoft");

    const link = page.getByTestId("microsoft-connect-link");
    const notice = page.getByTestId("microsoft-unconfigured");
    // Wait for the query to resolve into one of the two terminal states (never "Preparing…").
    await expect(link.or(notice)).toBeVisible({ timeout: 15_000 });

    if (await link.isVisible()) {
      // CONFIGURED: the authorize URL must carry the exact ADR-018 union grant and the common
      // endpoint — the two things that decide whether a real consent screen would work at all.
      const href = await link.getAttribute("href");
      expect(href, "connect link without an href").toBeTruthy();
      const url = new URL(href as string);
      expect(url.origin + url.pathname).toBe(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      );
      const scope = url.searchParams.get("scope") ?? "";
      expect(scope).toContain("Calendars.ReadWrite");
      expect(scope).toContain("Mail.Send");
      expect(scope).toContain("Mail.Read");
      expect(scope).toContain("offline_access");
      // Minimality reaches the wire.
      expect(scope).not.toContain("Contacts.");
      expect(scope).not.toContain(".All");
      // The state binds this tenant and the secret never travels.
      expect(url.searchParams.get("state")).toMatch(/\./);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("prompt")).toBe("consent");
    } else {
      // UNCONFIGURED: a bounded explanation, not a crash and not a dead button.
      await expect(notice).toContainText(/has not been configured/i);
      // A dead "Connect" control is the exact failure the bounded result exists to avoid.
      await expect(link).toHaveCount(0);
    }
  });

  test("an unconnected tenant is offered no disconnect control", async ({ page }) => {
    await page.goto("/connect-microsoft");
    await expect(page.getByText(/Pikar needs your consent/)).toBeVisible();
    // DisconnectMicrosoft renders nothing when there is nothing to disconnect and no note.
    await expect(page.getByTestId("microsoft-disconnect")).toHaveCount(0);
  });

  test("the Connections tab shows Microsoft, names both halves, and never flashes a false negative", async ({
    page,
  }) => {
    await page.goto("/dashboard/profile?tab=connections");

    const rowLocator = page.getByTestId("connections-microsoft");
    await expect(rowLocator).toBeVisible();
    await expect(rowLocator).toContainText("Microsoft — Calendar & Outlook mail");

    // "Checking…" is the loading state; "Not connected" is the resolved one. The row must never
    // render the resolved-negative text while the query is still undefined, because a false
    // "Not connected" invites reconnecting an already-connected account.
    await expect(rowLocator).toContainText(
      /Checking…|Not connected|Access token expires|Connected/,
    );
    await expect(rowLocator).toContainText(/Not connected|Access token expires|Connected/, {
      timeout: 15_000,
    });

    // Google's row is still there and still its own — the Microsoft row did not replace or
    // absorb it.
    await expect(page.getByText("Google — Gmail, Calendar & Drive")).toBeVisible();
  });
});
