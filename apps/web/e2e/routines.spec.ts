import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Locator, type Page, expect, test } from "@playwright/test";

// Phase 29 (ROUT-02) — THE BROWSER HALF OF THE DEFERRED RECURRENCE BRANCH.
//
// `29-RECURRENCE-DECISION.md` records `decision: defer` and `check-routine-gate.mjs
// --validate-decision` exits 0 on it, so recurrence does not ship in Phase 29. The static half of
// that proof is `app/(app)/dashboard/workflows/routineBranch.test.ts` (no file, no mount, no API
// binding) and `convex/routines.test.ts` (no table, no module, no cron, no dependency). This file
// is the half neither of them can reach: what a signed-in person actually SEES at
// /dashboard/workflows — that the manual "Run again" is there, and that nothing beside it offers or
// promises a run that happens by itself.
//
// ── WHY EVERY ABSENCE HERE IS PRECEDED BY A SETTLE SIGNAL ────────────────────────────────────
//
// This repo has already shipped a vacuous absence spec. `e2e/workflow-pack-pilot.spec.ts`'s `@dark`
// block asserted `toHaveCount(0)` and PASSED WITH ALL SIX PACKS ACTIVE, because `toHaveCount(0)`
// succeeds on its FIRST POLL — before the Convex query has resolved and before anything has
// rendered. An empty page passes every absence assertion ever written.
//
// So `openWorkflows()` below returns only after the page has SETTLED on a positive landmark that
// proves the Convex queries resolved: a pack row's own control, or the empty-state sentence
// `PinnedWorkflowsView` renders in its place. Until one of those is visible the surface is still
// showing "Loading your workflows…" and no absence claim below means anything.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────────────────────
//
// Nothing here signs in for identity A: the `setup` project signs in once through the real /signin
// form and the `chromium` project inherits `e2e/.auth/user.json` via `storageState`. Identity B
// signs in explicitly, from a clean context, and only when `E2E_USER_B_EMAIL` /
// `E2E_USER_B_PASSWORD` name a second account — skipped, never faked, when they do not.
//
// COSTS NOTHING. Every assertion is a read of a rendered page. No model is called on this route.

const here = dirname(fileURLToPath(import.meta.url));
// e2e -> web -> apps -> repo root.
const decisionPath = join(
  here,
  "..",
  "..",
  "..",
  ".planning",
  "phases",
  "29-unified-knowledge-and-routines",
  "29-RECURRENCE-DECISION.md",
);

/** The recorded decision, read from the artifact — never assumed. `readFileSync` throws `ENOENT`
 *  on a wrong path rather than returning "nothing", so this cannot silently default. */
function recordedDecision(): string {
  const text = readFileSync(decisionPath, "utf8");
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const line = block === null ? null : /^decision:\s*(\S+)\s*$/m.exec(block[1] as string);
  if (line === null) throw new Error(`${decisionPath} has no parseable \`decision:\` frontmatter`);
  return line[1] as string;
}

/** The three sentences `PinnedWorkflowsView` can settle on. One of them being visible is the proof
 *  that `listPacks` and `listPins` BOTH resolved — the loading branch renders none of them. */
/** The sentence the pinned surface renders when the tenant has no approved pack. It is the third
 *  legitimate settled state, beside "there is a pin" and "there is something pinnable" — and unlike
 *  the intro copy it cannot appear until `listPacks` has actually answered. */
const EMPTY_STATE = "No approved workflows are available to you yet.";

/** Open /dashboard/workflows and return the canvas `<main>`, only once the page has settled.
 *
 *  Scoped to `main` on purpose: the app shell's rail and its banners live outside it, and a nav
 *  label or a reconnect banner is not this surface's copy. */
async function openWorkflows(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard/workflows");
  const main = page.locator("main.canvas-main");

  // LANDMARK 1 — the route rendered at all (static headline, so this alone proves nothing about
  // the queries).
  await expect(page.getByRole("heading", { name: "Make a workflow fit your business" })).toBeVisible(
    { timeout: 20_000 },
  );
  // LANDMARK 2 — `PinnedWorkflowButton` is mounted. ROUT-02's deferred branch requires the manual
  // rerun surface to still be there, so this is an assertion, not only a wait.
  await expect(
    page.getByRole("heading", { name: "Workflows you run more than once" }),
  ).toBeVisible();
  // SETTLE SIGNAL — the Convex queries resolved. THIS is what makes the `toHaveCount(0)`s below
  // mean something.
  //
  // IT MUST MATCH A CONTROL, NOT PROSE, AND THAT IS NOT A STYLE PREFERENCE — measured 2026-08-30.
  // This was `main.getByText("Run again")`, and the surface's always-present intro reads
  // "Nothing starts by itself — you press Run again." So the settle matched STATIC COPY that is on
  // screen before a single query resolves, fired instantly, and every absence claim below then ran
  // against a page still showing "Loading your workflows…". The scan's own positive control caught
  // it (0 controls found); without that control this file would have reported a green absence proof
  // over a DOM it never read — the exact defect `workflow-pack-pilot.spec.ts`'s @dark block shipped.
  //
  // A button named "Run again" cannot exist until `listPins`/`listPacks` have answered, and the
  // empty-state sentence cannot render until they have answered either. Prose can be anywhere.
  const settled = main
    .getByRole("button", { name: "Pin this workflow", exact: true })
    .or(main.getByRole("button", { name: "Run again", exact: true }))
    .or(main.getByText(EMPTY_STATE, { exact: false }));
  await expect(settled.first()).toBeVisible({ timeout: 30_000 });
  return main;
}

/** Accessible names of every control inside a region, the way a keyboard or screen-reader user
 *  reaches them. */
async function controlNames(main: Locator): Promise<string[]> {
  return main
    .getByRole("button")
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()),
    );
}

/** A control that would create, pause, resume or revoke a repeating run. Matched against the
 *  ACCESSIBLE NAME, not against page prose: "Pikar is paused right now" is an honest sentence this
 *  surface may say, while a button called "Pause" is a lifecycle control that must not exist.
 *
 *  `repeat` is deliberately NOT in here. The Process/SOP pack's blurb — which is INSIDE its
 *  selection button, so it is part of that control's accessible name — reads "something you do
 *  repeatedly", and banning the stem would fail on a sentence about a document, not a schedule. */
const RECURRENCE_CONTROL =
  /schedul|recurr|cadence|daily|weekly|monthly|every day|every week|pause|resume|revoke|next run/i;

/** Phrases that PROMISE a run nobody started. Deliberately narrower than the control pattern: the
 *  bare word "schedule" is legitimate rendered copy here — the Process/SOP pack's preflight names
 *  "a task or publishing system" as a plane Pikar cannot reach — and banning it would fail on an
 *  honest sentence about something the product CANNOT do. */
const PROMISE_PHRASES = [
  "every day",
  "every week",
  "every month",
  "daily",
  "weekly",
  "monthly",
  "recurring",
  "on a schedule",
  "automatically",
  "next run",
];

/** Every absence claim, applied to one settled surface. Shared so identity B is held to exactly the
 *  same bar as identity A rather than a weaker copy of it. */
async function expectNoRecurrenceSurface(main: Locator) {
  // POSITIVE CONTROL ON THE SCAN ITSELF: the control scan really read this DOM. Without it a
  // mis-scoped locator returns [] and every filter below passes on nothing.
  const names = await controlNames(main);
  expect(names.length, "no controls were found — the scan is not reading the page").toBeGreaterThan(
    0,
  );
  // …and it read the PINNED surface specifically. Which of the two is present depends on whether
  // this tenant has a pin, so both are accepted — but one of them must be, or the scan settled on
  // some other part of the page and the claims below are about the wrong DOM.
  expect(
    names.filter((n) => n === "Pin this workflow" || n === "Run again").length,
  ).toBeGreaterThan(0);

  // CLAIM 1: no control creates, pauses, resumes or revokes a repeating run.
  expect(names.filter((n) => RECURRENCE_CONTROL.test(n))).toEqual([]);

  // CLAIM 2: no cadence or next-run input exists. The page-settled state is already established,
  // and the control count above proves this locator plane reads the real DOM.
  await expect(
    main.locator(
      'input[type="time"], input[type="date"], input[type="datetime-local"], input[type="week"], input[type="month"]',
    ),
  ).toHaveCount(0);

  // CLAIM 3: nothing on the surface PROMISES a run that starts by itself.
  const body = (await main.innerText()).toLowerCase();
  // POSITIVE CONTROL: this is the real rendered text of the pinned surface, and it says the true
  // thing in place of the banned ones.
  expect(body).toContain("nothing starts by itself");
  for (const phrase of PROMISE_PHRASES) {
    expect(body, `"${phrase}" is on the workflows page`).not.toContain(phrase);
  }
}

test.describe("the recurrence branch this spec was written for", () => {
  test("the recorded decision is still `defer`", () => {
    // NOT A SKIP. If the decision ever flips to `enable-safe`, this file's absence proof is the
    // wrong proof and must be REPLACED by a lifecycle spec (next local time, pause/resume/revoke,
    // reauth auto-pause, no catch-up, per-run approval for external writes). Going red is how that
    // gets noticed; skipping would let a stale absence proof sit quietly under a shipped feature.
    expect(recordedDecision()).toBe("defer");
  });
});

test.describe("deferred — /dashboard/workflows offers a manual rerun and no recurrence", () => {
  test("the manual Run again is there, and no control schedules, pauses or revokes a run", async ({
    page,
  }) => {
    const main = await openWorkflows(page);
    await expectNoRecurrenceSurface(main);
  });

  test("the honest sentence about what a pin does is the one actually on screen", async ({
    page,
  }) => {
    const main = await openWorkflows(page);
    // The whole INTRO, verbatim. A recurrence feature could not ship without rewriting this line,
    // so asserting it is a cheap tripwire on the copy that carries the promise.
    await expect(
      main.getByText(
        "Pinning a workflow remembers the approved version it runs. Nothing starts by itself — you press Run again.",
      ),
    ).toBeVisible();
  });
});

test.describe("two identities — the absence is not a property of one tenant's data", () => {
  const emailB = process.env.E2E_USER_B_EMAIL;
  const passwordB = process.env.E2E_USER_B_PASSWORD;
  test.skip(
    !emailB || !passwordB,
    "E2E_USER_B_EMAIL / E2E_USER_B_PASSWORD name no second account on this deployment",
  );

  test("an ordinary non-owner tenant sees the same surface with the same absence", async ({
    browser,
  }) => {
    // A CLEAN context — no cookies, no localStorage, none of the `chromium` project's storageState.
    // Recurrence being absent for the owner would say nothing about a tenant with different data,
    // a different pack list and no owner grant.
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

      const mainB = await openWorkflows(pageB);
      await expectNoRecurrenceSurface(mainB);
    } finally {
      await contextB.close();
    }
  });
});
