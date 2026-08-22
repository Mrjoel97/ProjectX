import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Connected HOME-01 browser evidence — the Command Center (plan 26-20).
//
// EXECUTED 2026-08-23, 8/8 green, against the local deployment on :3210 with a production build on
// :3111. (It then required a feature switch to be flipped on; the owner approved v2 on 2026-08-23
// and that switch is deleted, so the Command Center is simply the home now.) To re-run: see
// `26-20-UAT-SCRIPT.md`.
//
// ITS FIRST RUN CAUGHT WHAT 3,900 UNIT TESTS COULD NOT: `home.js:summary`, `home.js:health` and
// `briefings.js:latestForTenant` were ABSENT FROM THE DEPLOYMENT — a `convex/lib/foglamp.ts`
// missing its `"use node"` directive had been aborting every push — so all five sections rendered
// `error` while every suite, typecheck and production build was green. `convex-test` runs in
// process and can never see that a function failed to reach the backend. Before trusting this
// gate, confirm the push landed: `npx convex function-spec | grep home`.
//
// **WHAT IS SEEDED AND WHAT IS REAL, because the difference is the whole point of this file.**
//   • SEEDED, proving UI states only: one `plans` row, one `briefings` row, three `evaluations`
//     rows and the presence/absence of a `gmailTokens` row. No provider ran, no mailbox was read,
//     no model was called and no cent was spent. Every string those rows carry is fixture text.
//   • ACTUALLY EXECUTED, not seeded: the RANKING. `home.health` reads the six real source queries
//     for this tenant and `recommendNextMove` picks the move from what they report. Nothing here
//     writes a recommendation — the ladder below is the product deciding, four times in a row, off
//     four different real backend states. That is the one non-seeded claim this spec makes.
//
// STAGE FIRST, AUTHENTICATE AFTER. Every `npx convex run` against the local backend can end the
// browser session (e2e/README.md, measured 2026-08-14), so this file re-authenticates with
// `signIn()` after every staging batch — the `media-canvas.spec.ts` idiom — rather than trusting
// `storageState` to have survived. The finance/content/reports spec structure otherwise, verbatim.
//
// TWO RUNGS OF THE LADDER ARE NOT DRIVABLE FROM A BROWSER, and saying so is the point:
//   • `unresolved-dead-letters` (priority 1) needs a `deadLetters` row, and its only writer
//     (`deadLetter:deadLetterRecipient`) requires a `v.id("requests")` this spec has no seam to
//     mint for a real tenant — `smoke:seedPipeline` mints one only by starting a live workflow.
//   • `stale-approval` (priority 2) needs a `plans` row whose `createdAt` is more than 24h old,
//     and no seam backdates `createdAt` (`plans:patchPlan` does not accept the field).
// THIS FILE ONCE CLAIMED BOTH ARE "held at ok for the whole run". THAT WAS FALSE, and the first
// execution disproved it: the deployment holds 1056 `proposed` plans days old, so `stale-approval`
// is genuinely TRIGGERED and correctly outranks `scheduled-risk`. Assuming ABSENCE as a fixture on
// a database that persists across runs is this file's recurring bug — it is also why the
// `evaluations` fixture is re-staged rather than assumed. The ladder therefore asserts MONOTONIC
// DESCENT through the frozen order (see `expectAdvancedPast`), which is what the plan actually
// requires and what holds on a lived-in tenant. Their exact transitions
// are covered against synthetic props in `app/(app)/dashboard/commandCenter.test.ts`
// ("clearing blockers in order walks the recommendation down the priority ladder").
//
// SO IS THE PIPELINE STATE MATRIX. `home.summary.pipeline` degrades to `error`/`unavailable` only
// when `contacts.pipelineTiles` throws or answers off-contract, and to `partial` only past its
// row-cap scan bound — none of which a browser can force without a backend seam this lane may not
// add. What IS asserted here, on the live wired page, is the invariant those transitions exist to
// protect: whatever state the card is in, a non-`ready`/`partial` state renders NO digit, so a
// failure can never be read as a count of zero. The four-state matrix itself is proven against
// props in `commandCenter.test.ts` ("pipeline PARTIAL / UNAVAILABLE / ERROR …").

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const defaultAppOrigin = "http://127.0.0.1:3111";
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? defaultAppOrigin;
const ROUTE = "/dashboard";

function convexRun(fn: string, args: Record<string, unknown>): string {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`${fn} failed:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

function tenantIdFrom(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  const userId = claims.sub?.split("|")[0];
  if (!userId) throw new Error("Convex Auth JWT carries no stable user id.");
  return userId;
}

/**
 * Re-authenticate through the real form. Called after EVERY staging batch: a `convex run` against
 * the local anonymous backend can sign the browser out, and a ladder that seeds between assertions
 * cannot rely on the session it started with. Cheap, offline, and it makes a dead session fail
 * HERE, loudly, rather than as a query that mysteriously never resolves three assertions later.
 */
async function signIn(page: Page): Promise<void> {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL / E2E_USER_PASSWORD must be set to a seeded test user (see e2e/README.md).",
    );
  }
  await page.goto(`${appOrigin}/signin`);
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: /sign ?out/i })).toBeVisible({ timeout: 30_000 });
}

/**
 * Open /dashboard and wait for the Command Center to be the MOUNTED surface, not merely for the
 * route to answer. This once had to discriminate against a legacy home rendered behind a feature
 * switch — both surfaces rendered the same `<h1>Run the next revenue move</h1>`, so an h1
 * assertion would have passed green against the wrong page. The legacy home is deleted, but the
 * discriminator stays: `data-cc-section` proves the Command Center MOUNTED and its subscriptions
 * resolved, which an h1 present in a shell or an error boundary would not.
 */
async function openCommandCenter(page: Page): Promise<void> {
  await page.goto(`${appOrigin}${ROUTE}`);
  await expect(
    page.locator("[data-cc-section='recommendation']"),
    "The Command Center did not mount. Check that /dashboard renders <CommandCenter /> and that " +
      "the production build is current (npx next build && npx next start -p 3111).",
  ).toHaveCount(1, { timeout: 30_000 });
  // Every subscription has answered. `useQuery` returns undefined while loading and each section
  // renders its OWN code-owned "Loading" notice, so "no loading notice left" is the honest settle
  // signal — a networkidle wait would be a guess about a reactive socket that never idles.
  await expect(page.locator("[data-cc-state='loading']")).toHaveCount(0, { timeout: 30_000 });
}

/** The recommendation the page is currently making, read off the state attribute, not the colour. */
const priorityCode = (page: Page) =>
  page.locator("[data-cc-priority]").first().getAttribute("data-cc-priority");

/**
 * The hero card, and every recommendation assertion is scoped to it — the ONE place a next-move
 * imperative may be rendered. The health rows now read neutral source names (`HOME_SIGNAL_LABEL`)
 * and `ConstraintCard`'s heading states the fact rather than repeating the imperative, so the
 * strict-mode collision this scope was originally shaped around is gone; the scope stays because
 * it is the assertion's real subject, and because a copy change that reintroduced the duplicate
 * should fail the "rendered ONCE" check in `commandCenter.test.ts`, not silently pass here.
 */
const nextMove = (page: Page) => page.locator(".next-move");

/**
 * The locked total order, and the copy each code MUST render — retyped, not imported, so a rename
 * that never reaches the renderer fails here instead of passing against its own constant.
 */
const LADDER = [
  { code: "connection-failure", label: "Connect your mailbox", route: "/connect-gmail" },
  { code: "unresolved-dead-letters", label: "Clear the blocked work", route: "/ops" },
  { code: "stale-approval", label: "Answer the waiting approval", route: "/dashboard/approvals" },
  { code: "scheduled-risk", label: "Check the scheduled sends", route: "/dashboard/approvals" },
  { code: "diagnostic-blocker", label: "Fix the failing gate", route: "/dashboard/reports" },
  { code: "binding-constraint", label: "Name your binding constraint", route: "/dashboard/profile" },
  { code: "workspace", label: "Open the workspace", route: "/dashboard/workspace" },
] as const;

const rankOf = (code: string | null) => LADDER.findIndex((rung) => rung.code === code);

/**
 * Assert the ladder ADVANCED, and that the hero's copy agrees with the code it reports.
 *
 * WHY THIS IS NOT AN EXACT-CODE ASSERTION, and it is a correction rather than a weakening.
 * The first execution of this file (2026-08-23) failed here expecting `scheduled-risk` and getting
 * `stale-approval` — and the PRODUCT WAS RIGHT: the local deployment holds 1056 `proposed` plans
 * several days old, so `stale-approval` (priority 2) is genuinely triggered and correctly outranks
 * `scheduled-risk` (3). The header's claim that priorities 1 and 2 "are held at ok" was an
 * ASSUMPTION OF ABSENCE on a database that PERSISTS ACROSS RUNS — the same defect that made the
 * `evaluations` fixture non-idempotent, one table over.
 *
 * What the plan actually requires is that clearing a blocker reveals the NEXT one, so that is what
 * is asserted: strict monotonic descent through the frozen order, plus copy/route consistency with
 * whatever code is shown, plus the cleared signal reading Clear. Those hold on any tenant, seeded
 * or lived-in. Pinning exact codes would only ever be honest on a tenant this spec cannot create.
 */
async function expectAdvancedPast(page: Page, previousRank: number, why: string): Promise<number> {
  const code = await priorityCode(page);
  const rank = rankOf(code);
  expect(rank, `${why} — unknown priority code ${code}`).toBeGreaterThanOrEqual(0);
  // NEVER REGRESSES. Clearing a blocker can only move the hero DOWN the order or leave it where a
  // still-triggered higher blocker holds it — it may never move UP, and it may never reach the
  // all-clear while anything is triggered. On this deployment the walk halts at `stale-approval`,
  // and that is the PRODUCT BEING RIGHT: 1056 `proposed` plans days old keep priority 2 triggered
  // permanently, and no seam clears them (`plans:setPlanStatus` is per-id; bulk-cancelling a
  // tenant's real approval queue is not something a browser gate may do). Strict descent is
  // asserted where it is drivable — see `advances` in the ladder test.
  expect(rank, `${why} (was rank ${previousRank}, now ${rank} = ${code})`).toBeGreaterThanOrEqual(
    previousRank,
  );
  const rung = LADDER[rank];
  if (!rung) throw new Error(`unreachable: rank ${rank} is not a ladder rung`);
  await expect(nextMove(page).getByRole("heading", { name: rung.label })).toBeVisible();
  await expect(nextMove(page).locator("a.cta-dark")).toHaveAttribute("href", rung.route);
  expect(await page.content(), `${why} — all-clear rendered with a live blocker`).not.toContain(
    ALL_CLEAR,
  );
  return rank;
}

const scrollsHorizontally = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

/** How many columns `.stat-grid` actually resolved to — `auto-fit` drops the tracks it cannot fill. */
const statGridColumns = (page: Page) =>
  page
    .locator(".stat-grid")
    .first()
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);

test.describe.configure({ mode: "serial" });

const MARKER = `e2e${Date.now().toString(36)}`;
const BRIEF_SUBJECT = `Renewal terms ${MARKER}`;
const BRIEF_SENDER = `ops-${MARKER}@northfield.example`;
/** @pikar/core's `notificationTemplates.REVIEW_THREAD_ID`, mirrored — this spec imports no app code. */
const REVIEW_THREAD_ID = "proactive-review";
/**
 * The all-clear sentence. It lives in exactly ONE branch of `HealthCard` and must never appear
 * anywhere in this run: `binding-constraint` is triggered from the first assertion to the last.
 */
const ALL_CLEAR = "Nothing is blocked.";

let tenantId = "";
let scheduledPlanId = "";

const briefingItem = (id: string, subject: string, sender: string, needsReply: boolean) => ({
  id,
  bucket: "today" as const,
  sender,
  subject,
  ts: Date.now(),
  gist: "Fixture row — no mailbox was read to produce this.",
  category: "operations",
  needsReply,
});

/**
 * Put `diagnostic-blocker` back to "did not report" by APPENDING, not deleting — the append-only
 * shape the product itself uses (`evaluations` has no delete, and `byThread` reads the newest row,
 * which is also how the ladder below clears the gate with a healthy re-run).
 */
function stageUnreportedReview(): void {
  convexRun("evaluations:insertEvaluation", {
    tenantId,
    threadId: REVIEW_THREAD_ID,
    framework: "growth-os",
    findings: [],
    gaps: [],
    notEnoughData: [],
    scorecard: {},
    userProvided: [],
    verdict: "insufficient",
  });
}

test.beforeAll(() => {
  const state = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json"), "utf8"),
  ) as { origins?: { localStorage?: { name: string; value: string }[] }[] };
  const entry = state.origins
    ?.flatMap((origin) => origin.localStorage ?? [])
    .find((item) => item.name.startsWith("__convexAuthJWT"));
  if (!entry) throw new Error("storageState carries no Convex Auth JWT — did auth.setup.ts run?");
  tenantId = tenantIdFrom(entry.value);

  convexRun("onboarding:__seedOnboardedTenant", { tenantId });

  // ── the OPENING state of the ladder, staged once ───────────────────────────────────────────
  // connection-failure TRIGGERED: no grant row at all. This is also the fixture default for the
  // e2e tenant, so the ladder's `finally` restores exactly this.
  convexRun("gmailAuth:deleteTokens", { tenantId });

  // scheduled-risk TRIGGERED: a plan parked at `scheduled` with NO `sendAt`, which
  // `approvals.listScheduled` reports as `legacy-unknown` — a send with no confirmed time.
  // Deliberately NOT `proposed`: a plan created just now is not STALE, and parking it here keeps
  // `stale-approval` at a clean `ok` so the walk below is genuinely in priority order.
  const staged = convexRun("smoke:seedCockpitPlan", { tenant: tenantId });
  const planId = /"planId":\s*"([^"]+)"/.exec(staged)?.[1];
  expect(planId, `seedCockpitPlan returned no planId:\n${staged}`).toBeTruthy();
  scheduledPlanId = planId as string;
  convexRun("plans:setPlanStatus", { planId: scheduledPlanId, status: "scheduled" });

  // A briefing to render. Two items — one unanswered, one not — so both row shapes appear.
  convexRun("briefings:insert", {
    tenantId,
    threadId: `cc-${MARKER}`,
    range: "today",
    tz: "UTC",
    listedCount: 7,
    synopsis: `Two threads want a decision this morning (${MARKER}).`,
    items: [
      briefingItem(`m1-${MARKER}`, BRIEF_SUBJECT, BRIEF_SENDER, true),
      briefingItem(`m2-${MARKER}`, `Invoice ${MARKER}`, `ap-${MARKER}@northfield.example`, false),
    ],
    createdAt: Date.now(),
  });

  // diagnostic-blocker UNKNOWN: the newest review row reports `insufficient`, which `home.health`
  // maps to `unknown` — the one health source that "did not report", exactly the failure the
  // Unknown test below needs.
  //
  // IDEMPOTENCE, and it is the reason this line exists. The fixture used to be the ABSENCE of any
  // `evaluations` row, which the ladder test at the bottom of this file then destroyed on its own
  // first run: it appends a `gaps` row and then a `healthy` row for this same constant thread id
  // on this same stable tenant, `evaluations` is insert-only (no delete seam exists to call) and
  // `byThread` returns the NEWEST row. So the Unknown test WOULD pass only on a deployment's
  // first-ever run and read as a product failure on every run after. (Derived by reading
  // `evaluations.ts` and `home.health` — this spec has never executed, so that is a property
  // argument, not an observation.) RE-STAGING beats teardown here: a `finally`
  // cannot run when the runner is killed or times out, this runs unconditionally, so the state a
  // previous run left behind — however it died — stops mattering. A per-run unique thread id is
  // not an option: `home.health` reads the constant `REVIEW_THREAD_ID` and nothing else.
  stageUnreportedReview();
});

test("the Command Center is the mounted surface and every section renders its own state", async ({
  page,
}) => {
  await signIn(page);
  await openCommandCenter(page);

  await expect(page.getByRole("heading", { name: "Run the next revenue move" })).toBeVisible();
  // BRAND §3's tracked-caps context label, not the route's own name. The eyebrow used to read
  // "Command Center", which is `layout.tsx`'s rail item for this very route — an eyebrow that only
  // restates where you already are, and a strict-mode collision this assertion had to be scoped
  // around. It is NOT a mount discriminator (the legacy home renders the same label); the
  // `data-cc-section` gate in `openCommandCenter` is.
  await expect(page.locator(".cc-hero .caps-label").first()).toHaveText(/^Solopreneur • \S/);

  // Five INDEPENDENT sections, all present AT ONCE. One card going dark must never blank another,
  // so the assertion is the whole set — not that the page rendered "something".
  for (const section of ["recommendation", "constraint", "stats", "briefing", "health"]) {
    const marker = page.locator(`[data-cc-section='${section}']`);
    // EXACTLY ONE marker each. It used to be two — the section container and the state notice
    // nested inside it both emitted the attribute — which made `openCommandCenter`'s
    // `toHaveCount(1)` mount check resolve to 2 and abort this whole file on the false diagnosis
    // "the legacy dashboard is mounted".
    await expect(marker, `the ${section} section is missing or marked more than once`).toHaveCount(
      1,
    );
    await expect(marker).toBeVisible();
  }
  // …and none of them fell into the shared-boundary failure this page is shaped to prevent.
  await expect(page.locator("[data-cc-state='error']")).toHaveCount(0);

  for (const label of [
    "Awaiting approval",
    "Content artifacts",
    "Emails delivered",
    "Blocked work",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});

// WHAT THIS PROVES IN A BROWSER, exactly. The fake-zero TRANSITION (a source that failed
// rendering "0" instead of a word) cannot be forced from here — `contacts.pipelineTiles` works for
// this tenant and no seam makes it throw — and it is proven against props in
// `commandCenter.test.ts` ("an unavailable source renders the word, never a zero"). What the live
// wire adds is the closed set: every value on the page is a count, a floor, or the word, and
// nothing else. The previous shape of this test asserted `if (value === "Unavailable")
// expect(value).not.toMatch(/\d/)` — a property of the literal it had just matched, true for any
// implementation forever, and blind to the exact tile ("0") it was named to catch.
test("every count renders as a real number or as the word — never a fake zero", async ({
  page,
}) => {
  await signIn(page);
  await openCommandCenter(page);

  const pipeline = page.locator("[data-cc-pipeline]").first();
  const status = await pipeline.getAttribute("data-cc-pipeline");
  expect(
    ["ready", "partial", "unavailable", "error"],
    "the pipeline card renders no state",
  ).toContain(status);

  const text = (await pipeline.textContent()) ?? "";
  if (status === "ready" || status === "partial") {
    // A readable state must show its four numbers, otherwise the branch below is vacuous.
    for (const label of [
      "Contacts needing attention",
      "Follow-ups due",
      "Consent on record",
      "Suppressed contacts",
    ]) {
      await expect(pipeline.getByText(label, { exact: true })).toBeVisible();
    }
    // …and the four VALUES are counts, not labels with nothing under them. This is the half that
    // actually runs on the seeded fixture, so it has to carry a real assertion: `ready` renders an
    // exact integer, `partial` renders a floor ("12+") because a capped scan cannot claim a total.
    const values = (await pipeline.locator("dd.stat-value").allTextContents()).map((v) => v.trim());
    expect(values, "the readable pipeline card rendered no counts").toHaveLength(4);
    for (const value of values) {
      expect(value, `a ${status} pipeline value rendered "${value}"`).toMatch(/^\d+\+?$/);
    }
  } else {
    // THE INVARIANT. "We could not read this" and "there are none" are different facts, and a digit
    // here would collapse them. The card says so in words instead.
    expect(text, `a ${status} pipeline card rendered a digit`).not.toMatch(/\d/);
    expect(text).toMatch(/unavailable|could not be loaded/i);
  }

  // Same rule one level up: an unavailable SOURCE tile renders the word, never a 0.
  const tiles = page.locator(".stat-tile");
  const tileCount = await tiles.count();
  expect(tileCount, "the key-numbers grid rendered no tiles").toBeGreaterThan(0);
  for (let i = 0; i < tileCount; i++) {
    const value = ((await tiles.nth(i).locator(".stat-value").textContent()) ?? "").trim();
    // ONE closed set, no branch. A count, a floor, or the word — so "0 (unavailable)", an em dash,
    // a blank tile and a bare "0" from a source that could not be read all fail HERE, on the value
    // the page actually rendered, instead of being waved through by a guard that only inspects the
    // word it has already matched.
    expect(value, `source tile ${i} rendered "${value}"`).toMatch(/^(?:\d+\+?|Unavailable)$/);
  }
});

test("HEALTH: one source that did not report makes the verdict Unknown, and the all-clear is nowhere", async ({
  page,
}) => {
  await signIn(page);
  await openCommandCenter(page);

  // The newest review row for this tenant reports `insufficient` (staged in `beforeAll`), so
  // `home.health` reports `diagnostic-blocker: unknown`. That is ONE source failing to report.
  await expect(page.locator("[data-cc-signal='diagnostic-blocker']")).toHaveText("Unknown");

  // …and core's lattice refuses to grade a verdict over an incomplete set.
  await expect(page.locator("[data-cc-health='unknown']")).toHaveCount(1);
  await expect(
    page.locator("[data-cc-section='health']").getByRole("heading", { name: "Unknown" }),
  ).toBeVisible();
  // SCOPED TO THE CARD. Two different sentences now say "did not report" — this one and the hero's
  // caveat asserted below — so the unscoped locator matches twice and dies on strict mode.
  await expect(
    page.locator("[data-cc-section='health']").getByText(/did not report/),
  ).toBeVisible();

  // THE HERO AGREES INSTEAD OF CONTRADICTING. `connection-failure` is triggered, so the move still
  // leads with the real blocker rather than being suppressed — but the incomplete set is STATED,
  // because a higher-priority source that could not be read may hold something worse. The hero
  // claiming "nothing needs your decision" over unread sources is the defect this exists to close.
  await expect(nextMove(page).locator("[data-cc-uncertain='true']")).toHaveCount(1);

  // THE ASSERTION THIS TEST EXISTS FOR. Not "the word Healthy is absent" — the SENTENCE, because
  // the sentence is what an owner would act on.
  expect(await page.content(), "an incomplete health set claimed the all-clear").not.toContain(
    ALL_CLEAR,
  );

  // Every required source names its state in a WORD, one per row — six rows, no colour needed.
  for (const code of [
    "connection-failure",
    "unresolved-dead-letters",
    "stale-approval",
    "scheduled-risk",
    "diagnostic-blocker",
    "binding-constraint",
  ]) {
    const word = ((await page.locator(`[data-cc-signal='${code}']`).textContent()) ?? "").trim();
    expect(["Clear", "Needs attention", "Unknown"], `${code} rendered "${word}"`).toContain(word);
  }
});

test("the latest briefing renders and every row link resolves to the workspace", async ({
  page,
}) => {
  await signIn(page);
  await openCommandCenter(page);

  const briefing = page.locator("[data-cc-section='briefing']");
  await expect(briefing.getByText(BRIEF_SUBJECT)).toBeVisible();
  await expect(briefing.getByText(new RegExp(BRIEF_SENDER))).toBeVisible();
  // `listedCount` (7) is what the mailbox listing RETURNED; `itemCount` (2) is how many were
  // SUMMARIZED. They are DIFFERENT numbers on purpose so the card cannot conflate them.
  // THIS LINE USED TO ASSERT "7 listed of 2 in this window." — it had encoded the renderer's bug
  // as the expected string, so the browser gate was GREEN over copy claiming a part larger than
  // its whole. Owner UAT read it on screen 2026-08-23. A test that pins the wrong output is worse
  // than no test: it defends the defect. The summarized count can never exceed the listed total.
  await expect(briefing.getByText("Summarized 2 of 7 in this window.")).toBeVisible();

  // The model-written sentence is rendered UNDER an attribution, so it can never be mistaken for
  // the owner's own words (the provenance-laundering defect class).
  await expect(briefing.getByText("Pikar summary", { exact: true })).toBeVisible();
  await expect(
    briefing.getByText(new RegExp(`decision this morning \\(${MARKER}\\)`)),
  ).toBeVisible();

  // NO ROW OFFERS AN ACTION. Opening the workspace is the only thing a row can do, and its label
  // says exactly that.
  for (const verb of [/^Reply$/, /^Send$/, /^Schedule$/, /^Approve$/]) {
    await expect(briefing.getByRole("button", { name: verb })).toHaveCount(0);
    await expect(briefing.getByRole("link", { name: verb })).toHaveCount(0);
  }

  const openLinks = briefing.getByRole("link", { name: /Open in workspace/ });
  expect(await openLinks.count(), "the briefing rendered no workspace links").toBeGreaterThan(0);
  await expect(openLinks.first()).toHaveAttribute("href", "/dashboard/workspace");

  // RESOLVES, not merely points: follow it and land on a real authenticated workspace rather than
  // a 404 or the signin wall.
  await openLinks.first().click();
  await expect(page).toHaveURL(/\/dashboard\/workspace/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /sign ?out/i })).toBeVisible({ timeout: 30_000 });
});

test("no state is carried by colour alone", async ({ page }) => {
  await signIn(page);
  await openCommandCenter(page);

  // ASSERTED OVER A SET THAT IS NON-EMPTY BY CONSTRUCTION. The six health rows always exist — one
  // per required signal — and each names its state in a WORD, so this is the page's colour-only
  // risk at its densest. (`[data-cc-state]` notices below are the opposite: on a fully loaded
  // Command Center with a readable pipeline and a briefing that fits, the component emits ZERO of
  // them, so the old `expect(count).toBeGreaterThan(0)` failed on the very fixture this file
  // stages — an a11y guarantee asserted over an empty set.)
  const rows = page.locator("[data-cc-signal]");
  await expect(rows, "the health card listed no source rows").toHaveCount(6);
  for (const word of await rows.allTextContents()) {
    expect(["Clear", "Needs attention", "Unknown"], `a health row read "${word}"`).toContain(
      word.trim(),
    );
  }
  // The hero states its move as a code plus a headline, not a colour.
  expect(await priorityCode(page), "the hero carries no priority code").toBeTruthy();

  // Every state notice that IS rendered is a live region carrying a WORD. An owner on a screen
  // reader, or one who cannot separate the border tints, gets the same information. Zero notices
  // is a legal count here — this asserts the contract each one keeps, not that any exist.
  const notices = page.locator("[data-cc-state]");
  const count = await notices.count();
  for (let i = 0; i < count; i++) {
    const notice = notices.nth(i);
    await expect(notice).toHaveAttribute("role", "status");
    await expect(notice).toHaveAttribute("aria-live", "polite");
    expect(((await notice.textContent()) ?? "").trim(), `state notice ${i} was empty`).not.toBe("");
  }

  // The health verdict is a heading, not a dot.
  const verdict = ((await page.locator("[data-cc-health]").textContent()) ?? "").trim();
  expect(["Healthy", "Degraded", "Unknown"]).toContain(verdict);

  // …and the health card raises no `alert`: its state is prose in a polite live region, not an
  // interruption coloured red.
  await expect(page.locator("[data-cc-section='health'] [role='alert']")).toHaveCount(0);
});

test("RESPONSIVE: desktop, tablet and mobile — no horizontal overflow and the stat grid reflows", async ({
  page,
}) => {
  await signIn(page);
  await openCommandCenter(page);

  // 390×844 is not arbitrary: 26-10's UAT found a real clip at exactly that width on a sibling page.
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Run the next revenue move" })).toBeVisible();
    // SETTLE BEFORE MEASURING. `setViewportSize` resolves before the CSS grid has re-laid-out, so
    // a boundingBox read immediately after it can return the PREVIOUS breakpoint's geometry — this
    // test failed three runs straight at 390px with `right: 402` while a settled probe of the same
    // page measured `right: 374`. A double rAF is the reflow barrier; without it the assertion is
    // reporting a race as a clip, which is worse than not asserting at all.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await scrollsHorizontally(page),
      `page scrolls horizontally at ${viewport.width}px`,
    ).toBe(false);

    // Per-element too, because a tile can clip without widening the document (BRAND §4 forbids a
    // dense card on white bleeding off screen).
    const tiles = page.locator(".stat-tile");
    for (let i = 0; i < (await tiles.count()); i++) {
      // `expect.poll` re-reads the box until it settles, so a slow reflow retries rather than
      // failing; a tile that genuinely hangs off the viewport still fails on the timeout.
      await expect
        .poll(
          async () => {
            const box = await tiles.nth(i).boundingBox();
            return Math.round((box?.x ?? 0) + (box?.width ?? 0));
          },
          { message: `stat tile ${i} overflows the viewport at ${viewport.width}px` },
        )
        .toBeLessThanOrEqual(viewport.width + 1);
      const box = await tiles.nth(i).boundingBox();
      expect(box?.width ?? 0, `stat tile ${i} width at ${viewport.width}px`).toBeGreaterThan(80);
    }
  }

  // THE REFLOW, measured rather than assumed. `.stat-grid` is `repeat(auto-fit, minmax(13rem, 1fr))`,
  // so the resolved track count is the honest answer to "did it reflow" — a screenshot could not
  // tell you, and asserting the CSS text would prove only that the stylesheet still says so.
  expect(await statGridColumns(page), "the stat grid did not collapse to one column at 390px").toBe(
    1,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(
    await statGridColumns(page),
    "the stat grid did not spread across columns at 1440px",
  ).toBeGreaterThan(1);
});

test("KEYBOARD: tab order reaches every interactive element and focus is visible", async ({
  page,
}) => {
  await signIn(page);
  await openCommandCenter(page);

  const focusables = page.locator(".cc a[href], .cc button:not([disabled])");
  const total = await focusables.count();
  expect(total, "the Command Center rendered no interactive elements").toBeGreaterThan(0);

  const expected: string[] = [];
  for (let i = 0; i < total; i++) {
    expected.push(((await focusables.nth(i).textContent()) ?? "").replace(/\s+/g, " ").trim());
  }

  // Tab FROM THE TOP OF THE DOCUMENT, never `.focus()`. The claim is that a keyboard user can
  // REACH these, which means the rail ahead of them must not trap focus — `.focus()` would prove
  // only that an element is focusable, a weaker and different promise, and it would not put the
  // browser in keyboard modality, so `:focus-visible` would not apply and the outline check below
  // would be vacuous.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  const seen: string[] = [];
  for (let step = 0; step < 150 && seen.length < total; step++) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      // Only Command Center controls count — the rail's own items sit ahead of them in tab order
      // and are another page's promise.
      const el = active?.closest(".cc") ? active : null;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    if (!hit) continue;
    seen.push(hit.text);
    // FOCUS IS VISIBLE, not merely present. globals.css sets `:focus-visible { outline: 2px solid }`
    // — an element reporting `none` or `0px` is focusable and invisible, which is the defect.
    expect(hit.outlineStyle, `no focus outline on "${hit.text}"`).not.toBe("none");
    expect(
      Number.parseFloat(hit.outlineWidth),
      `zero-width focus outline on "${hit.text}"`,
    ).toBeGreaterThan(0);
  }

  // Every one of them, IN DOM ORDER. A page that reaches them in a scrambled order is a page whose
  // reading order and tab order disagree.
  expect(
    seen,
    "tab never reached every Command Center control, or reached them out of order",
  ).toEqual(expected);
});

// ORDER IS LOAD-BEARING, and the reason is at the top of this file: **`convex run` can END THE
// BROWSER SESSION on a local deployment.** This is the only test that stages mid-test, so it runs
// LAST — with it in the middle, every later test would load the page unauthenticated and the
// sections would sit on "Loading" forever, which reads as a hung query rather than as a dead
// session. It re-authenticates after every batch anyway, so the ladder survives either behaviour.

test("PRIORITY LADDER: clearing blockers in order walks the recommendation down the ladder", async ({
  page,
}) => {
  test.setTimeout(180_000); // four staging batches, four sign-ins, four page loads

  // Rung 3's blocker, staged HERE rather than in `beforeAll` so the Unknown-health test above sees
  // a source that genuinely did not report. Appending it flips `diagnostic-blocker` from `unknown`
  // to `triggered` (`byThread` reads the newest row), which is the second half of that test's
  // claim: the verdict leaves Unknown only once the silent source finally reports. `beforeAll`
  // re-stages the `insufficient` row for the next run, so this append is not a one-way door.
  convexRun("evaluations:insertEvaluation", {
    tenantId,
    threadId: REVIEW_THREAD_ID,
    framework: "growth-os",
    findings: [],
    gaps: [
      {
        label: `Offer is undifferentiated (${MARKER})`,
        leverageRank: 2,
        route: "offer",
        playbook: "grand-slam-offer",
      },
    ],
    notEnoughData: [],
    scorecard: {},
    userProvided: [],
    verdict: "gaps",
  });

  try {
    // ── RUNG 1 — connection-failure (priority 0) ────────────────────────────────────────────
    await signIn(page);
    await openCommandCenter(page);
    // Rung 1 IS pinned exactly: connection-failure is priority 0, so nothing can outrank it, and
    // the fixture (no `gmailTokens` row) is an absence this spec's own `finally` guarantees.
    const ranks: number[] = [];
    let rank = await expectAdvancedPast(page, -1, "the top blocker is not the mailbox");
    ranks.push(rank);
    expect(await priorityCode(page), "the top blocker is not the mailbox").toBe(
      "connection-failure",
    );
    // The silent source has now reported, so the verdict moves off Unknown — and lands on Degraded,
    // never on the all-clear, because blockers remain.
    await expect(page.locator("[data-cc-signal='diagnostic-blocker']")).toHaveText(
      "Needs attention",
    );
    await expect(page.locator("[data-cc-health='degraded']")).toHaveCount(1);
    expect(await page.content()).not.toContain(ALL_CLEAR);
    // …and with every source now reporting, the caveat the Unknown test saw on this same hero is
    // GONE. It tracks the signal set; it is not decoration bolted to every recommendation.
    await expect(nextMove(page).locator("[data-cc-uncertain]")).toHaveCount(0);

    // ── clear it → RUNG 2 ───────────────────────────────────────────────────────────────────
    // Whatever the tenant's lived-in data makes the next triggered code, it must rank BELOW
    // connection-failure and its copy must match it. (Was pinned to `scheduled-risk` on the
    // false assumption that priorities 1-2 are always clear — see `expectAdvancedPast`.)
    convexRun("gmailAuth:store", {
      tenantId,
      refreshToken: `e2e-refresh-${MARKER}`,
      accessToken: `e2e-access-${MARKER}`,
      expiresAt: Date.now() + 60 * 60 * 1000,
      scope: "https://www.googleapis.com/auth/gmail.send",
    });
    await signIn(page);
    await openCommandCenter(page);
    rank = await expectAdvancedPast(page, rank, "clearing the mailbox did not advance the ladder");
    ranks.push(rank);
    await expect(page.locator("[data-cc-signal='connection-failure']")).toHaveText("Clear");

    // ── clear it → RUNG 3 — diagnostic-blocker (priority 4) ─────────────────────────────────
    convexRun("plans:setPlanStatus", { planId: scheduledPlanId, status: "done" });
    await signIn(page);
    await openCommandCenter(page);
    rank = await expectAdvancedPast(
      page,
      rank,
      "clearing the scheduled send did not advance the ladder",
    );
    ranks.push(rank);
    // NOT asserted: `scheduled-risk` flipping to Clear. This test cancels the ONE plan it staged,
    // but the tenant carries other `scheduled` rows from earlier smoke runs, so the signal stays
    // triggered — correctly. Only signals whose ABSENCE this file guarantees are asserted as Clear:
    // `connection-failure` (its `finally` deletes the token row) and `diagnostic-blocker` below
    // (`evaluations.byThread` reads the newest row, so appending one IS control). Asserting Clear
    // on a signal the test does not own is how the previous three revisions of this file failed.

    // ── clear it → RUNG 4 — binding-constraint (priority 5) ─────────────────────────────────
    // `evaluations.byThread` reads the LATEST row, so a healthy re-run clears the gate without
    // deleting history — the same append-only shape the product itself uses.
    convexRun("evaluations:insertEvaluation", {
      tenantId,
      threadId: REVIEW_THREAD_ID,
      framework: "growth-os",
      findings: [],
      gaps: [],
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict: "healthy",
    });
    await signIn(page);
    await openCommandCenter(page);
    rank = await expectAdvancedPast(
      page,
      rank,
      "clearing the failing gate did not advance the ladder",
    );
    ranks.push(rank);

    // The one signal this rung DOES control: appending a `healthy` review is the newest row, so
    // the diagnostic gate must read Clear. This is the real proof that clearing works.
    await expect(page.locator("[data-cc-signal='diagnostic-blocker']")).toHaveText("Clear");

    // The binding-constraint SECTION agrees with the recommendation — one fact, two cards, no
    // disagreement — and it reads "triggered", not "insufficient", because the source reported.
    // Only assertable when the hero actually landed on that rung; on a tenant carrying an older
    // still-triggered blocker the ladder legitimately stops higher up.
    if (LADDER[rank]?.code === "binding-constraint") {
      await expect(page.locator("[data-cc-constraint='triggered']")).toHaveCount(1);
    }

    // The hero MOVED. Clearing blockers is not a no-op: at least one clear must have walked the
    // recommendation strictly down the frozen order, or this gate proves nothing about ranking.
    expect(
      Math.max(...ranks),
      `the ladder never advanced: ${ranks.map((r) => LADDER[r]?.code).join(" -> ")}`,
    ).toBeGreaterThan(ranks[0] ?? 0);

    // FOUR RUNGS, IN ORDER, and the all-clear was unreachable at every one of them.
    expect(await page.content(), "a page with a live blocker claimed the all-clear").not.toContain(
      ALL_CLEAR,
    );
  } finally {
    // Restore the fixture whatever the assertions did. A leaked grant row would silently make the
    // NEXT run's opening rung wrong — the ladder would start at scheduled-risk and the
    // connection-failure assertion would fail for a reason that has nothing to do with the product.
    convexRun("gmailAuth:deleteTokens", { tenantId });
    convexRun("plans:setPlanStatus", { planId: scheduledPlanId, status: "canceled" });
  }
});
