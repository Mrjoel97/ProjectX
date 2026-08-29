import { expect, test } from "@playwright/test";

// Phase 29 (KNOW-01) — the browser gate for unified knowledge search.
//
// ⚠ THIS FILE HAS NEVER BEEN EXECUTED. It was written against the real components and the real
// selectors, but running it needs a live Convex deployment, a seeded E2E user and real credentials,
// which 29-09 could not use. The exact commands, env vars and expected evidence are recorded in
// `.planning/phases/29-unified-knowledge-and-routines/29-SEARCH-GATE.md`, and the plan's browser
// criterion is NOT met until an operator runs it and pastes the output there.
//
// AUTH: none of this file signs in. The `setup` project in `playwright.config.ts` signs in once
// through the real /signin form and saves `e2e/.auth/user.json`; the `chromium` project inherits it
// via `storageState`.
//
// ── THE TWO MODES, AND WHY THEY CANNOT SHARE A DEPLOYMENT ────────────────────────────────────
//
// `offlineSeamAvailable()` (convex/lib/models.ts) is `PIKAR_OFFLINE_FIXTURES === "1"` AND NO model
// key. So the `SMOKE::knowledge-plan::` directives below drive the planner offline at $0 ONLY on a
// deployment with the operator's fixture consent and no key — and on a KEYED deployment those same
// strings would be sent to a real model and BILLED. That is why the mode is an explicit env choice
// with an offline default, never a guess:
//
//   PIKAR_E2E_KNOWLEDGE_MODE=offline  (default) — fixture-driven, $0, deterministic gap states
//   PIKAR_E2E_KNOWLEDGE_MODE=live               — a real question against a real model. COSTS MONEY.
//
// ── THE SECOND IDENTITY ──────────────────────────────────────────────────────────────────────
//
// The two-tenant test runs only when `E2E_USER_B_EMAIL` / `E2E_USER_B_PASSWORD` name a SECOND
// loggable account. On the deployments this repo has, they do not exist — there is one loggable
// human account. The API-level isolation proof lives in `convex/knowledgeSearch.test.ts`
// ("two tenants asking the same question in the same thread read different coverage"); this block
// is the browser half and it is skipped, not faked, when the credentials are absent.

const MODE = process.env.PIKAR_E2E_KNOWLEDGE_MODE ?? "offline";
const PANEL = "Search everything you have connected";

/** Open the cockpit and the search card, through the keyboard path a user actually has. */
async function openPanel(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/workspace");
  await expect(page.getByPlaceholder("What business outcome should we work on?")).toBeVisible({
    timeout: 15_000,
  });
  const options = page.getByRole("button", { name: "Chat options" });
  await options.focus();
  await options.press("Enter");
  await page.getByRole("menuitem", { name: "Search your knowledge" }).click();
  const panel = page.getByRole("region", { name: PANEL });
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(panel: import("@playwright/test").Locator, question: string) {
  const field = panel.getByLabel("What do you want to know?");
  await expect(field).toBeVisible();
  await field.fill(question);
  const submit = panel.getByRole("button", { name: "Search" });
  await expect(submit).toBeEnabled();
  await submit.click();
  // The answer card is the completion signal; the search fans out over real connectors.
  await expect(panel.getByTestId("knowledge-answer").first()).toBeVisible({ timeout: 60_000 });
}

test.describe("the search card is reachable and refuses an empty question", () => {
  test("the control is labelled, keyboard-reachable and disabled until there is a question", async ({
    page,
  }) => {
    const panel = await openPanel(page);
    const field = panel.getByLabel("What do you want to know?");
    const submit = panel.getByRole("button", { name: "Search" });

    // No question, no search — and the reason is the disabled control, not a silent no-op.
    await expect(submit).toBeDisabled();
    await field.fill("   ");
    await expect(submit).toBeDisabled();
    await field.fill("anything");
    await expect(submit).toBeEnabled();

    // Closing is reachable by its accessible name, not by a bare glyph.
    await panel.getByRole("button", { name: "Close knowledge search" }).click();
    await expect(page.getByRole("region", { name: PANEL })).toBeHidden();
  });
});

test.describe("offline fixture seam — deterministic gap states at $0", () => {
  test.skip(MODE !== "offline", "PIKAR_E2E_KNOWLEDGE_MODE is not 'offline'");

  test("a mailbox that is not connected is never rendered as an empty mailbox", async ({
    page,
  }) => {
    const panel = await openPanel(page);
    // The offline planner plans exactly what the directive names. Nothing else is searched, so the
    // other four sources are `unplanned` and this run reads no source at all.
    await ask(panel, "SMOKE::knowledge-plan::inbox|renewal — what did we agree on renewal?");

    const answer = panel.getByTestId("knowledge-answer").first();
    // Every knowledge source states its own outcome. Five, always — a missing row is a silent gap.
    await expect(answer.getByTestId("knowledge-source-state")).toHaveCount(5);

    // If the E2E user has no Gmail connection this is the exact sentence. If they DO have one, the
    // mailbox was searched and this assertion fails loudly rather than passing on a weaker match —
    // the gate doc records "the E2E tenant must have no Gmail connection" as a precondition.
    await expect(
      answer.getByText("your mailbox is not connected yet, so it was not searched."),
    ).toBeVisible();
    // The pair. Nothing was read, so the card must not say the sources were searched and empty.
    await expect(
      answer.getByText("None of your sources could be searched, so there is no answer to give."),
    ).toBeVisible();
    await expect(
      answer.getByText("The sources that were searched had nothing on this."),
    ).toBeHidden();
    await expect(panel.getByText("no results")).toBeHidden();
  });

  test("the source Phase 28 never landed names its unlock rather than reading as empty", async ({
    page,
  }) => {
    const panel = await openPanel(page);
    await ask(panel, "SMOKE::knowledge-plan::support-desk|tickets — any open tickets?");

    const answer = panel.getByTestId("knowledge-answer").first();
    await expect(
      answer.getByText(
        "your connected support inbox is not available in Pikar yet, so it was not searched. It would need connecting your support desk.",
      ),
    ).toBeVisible();
  });

  test("an unsearchable source is a gap, and the card offers no way to act on it", async ({
    page,
  }) => {
    const panel = await openPanel(page);
    await ask(panel, "SMOKE::knowledge-plan::inbox|renewal — what did we agree on renewal?");

    // A search READS. The card carries exactly two controls: close, and search again.
    const buttons = panel.getByRole("button");
    const names = await buttons.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""),
    );
    expect(names.sort()).toEqual(["Close knowledge search", "Search"]);
  });
});

test.describe("live — a real question against a real model (COSTS MONEY)", () => {
  test.skip(MODE !== "live", "PIKAR_E2E_KNOWLEDGE_MODE is not 'live'");

  test("a real answer carries per-source coverage and a closed confidence label", async ({
    page,
  }) => {
    const panel = await openPanel(page);
    await ask(panel, "What have we agreed with customers about pricing?");
    const answer = panel.getByTestId("knowledge-answer").first();

    // Code-owned regardless of what the model returned: every source states its outcome once.
    await expect(answer.getByTestId("knowledge-source-state")).toHaveCount(5);

    const claims = answer.getByTestId("knowledge-claim");
    if ((await claims.count()) > 0) {
      // An answer that exists is cited and carries one of the four closed confidence sentences.
      await expect(answer.getByTestId("knowledge-citation").first()).toBeVisible();
      await expect(answer.getByTestId("knowledge-confidence")).toHaveText(
        /^(High|Medium|Low|Not supported)/,
      );
    } else {
      // No claims is a legitimate outcome and must still be one of the two honest sentences.
      await expect(answer.getByTestId("knowledge-empty")).toBeVisible();
    }
  });
});

test.describe("two identities — tenant B reads none of tenant A", () => {
  const emailB = process.env.E2E_USER_B_EMAIL;
  const passwordB = process.env.E2E_USER_B_PASSWORD;
  test.skip(
    !emailB || !passwordB,
    "E2E_USER_B_EMAIL / E2E_USER_B_PASSWORD name no second account on this deployment",
  );

  test("B's own searches are the only ones B can see", async ({ browser, page }) => {
    // A searches first, in the storageState identity the chromium project already carries.
    const panelA = await openPanel(page);
    const needle = `KNOWSEARCH_A_${Date.now()}`;
    await ask(panelA, `SMOKE::knowledge-plan::inbox|${needle} — ${needle}`);
    await expect(panelA.getByTestId("knowledge-answer").first()).toContainText(needle);

    // B signs in from a CLEAN context — no cookies, no localStorage, no shared storageState.
    const contextB = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const pageB = await contextB.newPage();
    try {
      await pageB.goto("/signin");
      await pageB.getByLabel("Email Address").fill(emailB as string);
      await pageB.getByLabel("Password", { exact: true }).fill(passwordB as string);
      await pageB.getByRole("button", { name: /sign in/i }).click();
      await expect(pageB.getByRole("button", { name: "Sign out" })).toBeVisible({
        timeout: 15_000,
      });

      const panelB = await openPanel(pageB);
      // B's panel is scoped to B's own tenant and thread; A's question must not be reachable.
      await expect(panelB.getByText(needle)).toHaveCount(0);
    } finally {
      await contextB.close();
    }
  });
});
