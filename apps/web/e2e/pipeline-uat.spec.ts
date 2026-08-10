import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "@pikar/backend/api";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { fetchMutation, fetchQuery } from "convex/nextjs";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// PHASE 19 OWNER UAT, AS A RUNNABLE SPEC (19-10 Task 2 — the blocking gate).
//
// The Claude-in-Chrome extension is degraded on this machine (viewport reports 0x0, screenshots
// fail on a CDP binding error, clicks report success and never land), so the manual browser route
// the plan assumed is unavailable. This file is the substitute: every UAT step with a TRUTH VALUE
// is asserted here, and the genuine judgement calls are captured as PNGs under
// `.planning/phases/19-contacts-crm-follow-ups/uat/` for the owner to look at.
//
// EVERY test name carries its UAT step number, so the mapping back to 19-10-PLAN.md is auditable.
//
// ── WHAT THIS FILE DOES **NOT** PROVE ────────────────────────────────────────────────────────────
//   • **No real Gmail delivery, anywhere.** Steps 9/11 need `executePlan` past its
//     `gmail_not_connected` gate, so a SYNTHETIC `gmailTokens` row is seeded via the shipped
//     internal `gmailAuth:store`. Every assertion is at the APPROVE boundary — which addresses were
//     dropped, which refusal fired, what the plan row says afterwards. The fan-out that follows
//     gets a 401 from Google and parks its rows at `awaiting_reauth`. Nothing here is evidence that
//     a byte reached anyone's inbox.
//   • **Step 12 is not browser-reachable at all** — see its test.
//   • **Step 3's free-standing follow-up has no UI affordance** — see the finding there.
//   • **Step 10's "clear your postal address" is not executable** — see the finding there.
//
// ── HOW TO RUN ───────────────────────────────────────────────────────────────────────────────────
// From `apps/web`, against an ALREADY-RUNNING stack (`convex dev` on :3210 — NOT `--once` — and a
// PRODUCTION build on :3111; `next dev` OOMs on the workspace page):
//
//   npx playwright test e2e/pipeline-uat.spec.ts --no-deps --workers=1
//
// `--no-deps` skips the `setup` project: this file provisions its OWN throwaway tenants through the
// real `/signup` form (the file-level `test.use` overrides the project storageState), so it needs
// no `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` and never touches the owner's session.
//
// **`pnpm --filter @pikar/web test:e2e -- <file>` DOES NOT FILTER.** pnpm forwards the literal
// `--`, Playwright matches nothing, and all 25 specs run for ~8 minutes. 19-10 hit this. Use the
// `npx` line above.
//
// ── COST ─────────────────────────────────────────────────────────────────────────────────────────
// Steps 5, 7 and 8 make REAL model calls through the cockpit. Everything else is $0: plan rows are
// seeded with `smoke:seedCockpitPlan` + `plans:patchPlan` (the approvals.spec.ts idiom). `afterAll`
// sums every `actual` movement both UAT tenants booked during the run and writes `uat/spend.json`,
// so the number reported is MEASURED, not estimated.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = process.env.PIKAR_E2E_BACKEND_DIR ?? resolve(here, "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";

const UAT_DIR = resolve(here, "../../../.planning/phases/19-contacts-crm-follow-ups/uat");
const UAT_STATE_ABS = resolve(here, ".auth/uat19.json");

const PIPELINE = "/dashboard/pipeline";
const PROFILE = "/dashboard/profile";
const APPROVALS = "/dashboard/approvals";
const WORKSPACE = "/dashboard/workspace";

type Auth = { token: string; url: string };

/** approvals.spec.ts / finance.spec.ts, verbatim — including the Windows libuv exit quirk. */
function convexRun<T>(fn: string, args: Record<string, unknown>): T {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`${fn} failed:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
  try {
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    // Widened vs. approvals.spec.ts's copy: `gmailAuth:store` returns VOID, so the CLI prints
    // nothing at all and the UV_HANDLE_CLOSING clause only masked it on the runs where Windows
    // happened to emit the libuv noise. Empty stdout is not an error — `CLI_FAILURE` above is what
    // catches a real one, so this cannot turn a Convex failure green.
    if (!result.stdout.trim()) return undefined as T;
    throw new Error(`${fn} returned no valid result:\n${stderr.trim()}\n${result.stdout.trim()}`);
  }
}

function tenantIdFrom(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  const userId = claims.sub?.split("|")[0];
  if (!userId) throw new Error("Convex Auth JWT carries no stable user id.");
  return userId;
}

async function authFor(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((c) => c.startsWith("__convexAuthJWT"));
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!token) throw new Error("This UAT tenant has no Convex Auth JWT in localStorage.");
  return { token, url: CONVEX_URL };
}

/** Sign up a BRAND-NEW throwaway user through the real `/signup` form. A new signup is also the
 *  empty-tenant reset seam (19-10's finding), which is what makes step 1 non-vacuous without
 *  building one. */
async function signUp(page: Page, email: string): Promise<Auth> {
  await page.goto("/signup");
  await page.getByLabel("Full Name").fill("Phase 19 UAT");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(UAT_PASSWORD);
  await page.getByLabel("Confirm Password").fill(UAT_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 45_000 });
  return await authFor(page);
}

/** One tile's value as an INTEGER. A `—` or an "Unknown" makes the parse throw, which is
 *  invariant 3 stated as a parse (pipeline.spec.ts's idiom, reused). */
async function tileValue(page: Page, id: string): Promise<number> {
  const text = await page
    .getByTestId(`pipeline-tile-${id}`)
    .locator(".stat-value")
    .innerText({ timeout: 30_000 });
  const value = Number.parseInt(text.trim(), 10);
  expect(Number.isInteger(value), `tile ${id} rendered "${text}" rather than a number`).toBe(true);
  return value;
}

/** The `suppressions` ROW COUNT for this tenant, read off the tile the page derives from that
 *  table. 19-04 proved the inert GET by row count because a 200-vs-404 check passes the mutant
 *  where the GET writes — step 13 asserts a DELTA on this, never on a status code. */
async function suppressionRowCount(page: Page): Promise<number> {
  await page.goto(PIPELINE);
  return await tileValue(page, "suppressed");
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: resolve(UAT_DIR, `${name}.png`), fullPage: true });

/** Drive one cockpit turn. Waits for the composer to clear (ChatPane empties it once the action
 *  resolves), never asserts on model prose — assertions ride the plan-derived cards. */
async function say(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 180_000 });
}

/** Seed a proposed EMAIL plan for a tenant — $0, the approvals.spec.ts idiom. */
function seedEmailPlan(
  tenant: string,
  patch: Record<string, unknown>,
): { planId: string; threadId: string } {
  const seeded = convexRun<{ planId: string; threadId: string }>("smoke:seedCockpitPlan", {
    tenant,
  });
  convexRun("plans:patchPlan", { planId: seeded.planId, status: "proposed", ...patch });
  return seeded;
}

/** The synthetic grant that gets `executePlan` past `gmail_not_connected`. No mailbox is involved
 *  and NO DELIVERY IS CLAIMED — see the header. */
function seedSyntheticGmail(tenant: string): void {
  convexRun("gmailAuth:store", {
    tenantId: tenant,
    refreshToken: `uat19-synthetic-${stamp}`,
    accessToken: `uat19-synthetic-${stamp}`,
    expiresAt: Date.now() + 3_600_000,
    scope: "https://www.googleapis.com/auth/gmail.send",
  });
}

// ── the throwaway tenants ─────────────────────────────────────────────────────────────────────────

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const UAT_EMAIL = `uat19-${stamp}@example.com`;
const UAT_PASSWORD = "uat19-pikar-password";
const JANE = "jane@example.com";
const NAMELESS = `nameless-${stamp}@example.com`;
const FREESTANDING_NOTE = `Chase the supplier quote ${stamp}`;

let auth: Auth;
let tenantId = "";
const spentTenants: string[] = [];
const startedAt = Date.now();

test.describe.configure({ mode: "serial" });
test.use({ storageState: "e2e/.auth/uat19.json" });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  mkdirSync(UAT_DIR, { recursive: true });
  // `browser.newContext()` on the FIXTURE inherits the file-level `test.use` above, which points at
  // a state file this hook has not written yet — so the signup context must opt out explicitly.
  mkdirSync(dirname(UAT_STATE_ABS), { recursive: true });
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  auth = await signUp(page, UAT_EMAIL);
  tenantId = tenantIdFrom(auth.token);
  spentTenants.push(tenantId);
  // Fresh users sit behind the onboarding gate. This shipped seam clears it with no model spend and
  // seeds a profile + a postal address and ZERO contacts/followUps/suppressions — so the tenant is
  // still empty in every sense step 1 asserts.
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });
  // THE COCKPIT COMPOSER IS GATED ON A GMAIL CONNECTION (`workspace/page.tsx`: an unconnected
  // tenant gets a "Connect Gmail to start planning" CTA and no composer at all), so steps 5/7/8
  // need the synthetic grant too — not just the send steps. The deterministic offline inbox fixture
  // rides with it so any `gmail.search` the agent attempts is served locally instead of 401-ing
  // against Google: same seam `cockpit-resolve.spec.ts` uses, no network, no spend.
  seedSyntheticGmail(tenantId);
  convexRun("smoke:seedInboxFixture", { tenantId, offlineDigest: true });
  await context.storageState({ path: UAT_STATE_ABS });
  writeFileSync(resolve(UAT_DIR, "tenant.txt"), `${UAT_EMAIL}\n${tenantId}\n`, "utf8");
  await context.close();
});

/**
 * Convex Auth ROTATES its refresh token every time the client refreshes. Restoring ONE snapshot
 * into context after context eventually replays a spent token, reuse detection fires, and the
 * tenant is signed out mid-run — observed at step 5, which landed on `/signin`. Re-saving after
 * each test keeps the file (and `auth.token`, which the `fetchQuery` reads use) current.
 */
test.afterEach(async ({ page }) => {
  const state = await page.context().storageState();
  const jwt = state.origins
    .flatMap((o) => o.localStorage)
    .find((e) => e.name.startsWith("__convexAuthJWT"))?.value;
  if (!jwt) return; // a test that never signed this context in must not clobber a good file
  writeFileSync(UAT_STATE_ABS, JSON.stringify(state), "utf8");
  auth = { token: jwt, url: CONVEX_URL };
});

test.afterAll(async () => {
  let cents = 0;
  let events = 0;
  for (const tenant of spentTenants) {
    const rows = convexRun<Array<{ phase: string; amountCents: number }>>(
      "spendLedger:listEvents",
      { tenantId: tenant, sinceMs: startedAt - 60_000, untilMs: Date.now() + 60_000, limit: 500 },
    );
    events += rows?.length ?? 0;
    cents += (rows ?? [])
      .filter((r) => r.phase === "actual")
      .reduce((s, r) => s + r.amountCents, 0);
  }
  const summary = { tenants: spentTenants, events, usd: cents / 100 };
  writeFileSync(resolve(UAT_DIR, "spend.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`[uat19] MEASURED model spend: $${(cents / 100).toFixed(4)} across ${events} events`);
});

// ── STEPS 1 + 2 ───────────────────────────────────────────────────────────────────────────────────

test("step 1 + step 2: an empty tenant reads four real zeroes, and Sales Pipeline is still `soon`", async ({
  page,
}) => {
  await page.goto(PIPELINE);
  await expect(page.getByTestId("pipeline-tiles")).toBeVisible({ timeout: 45_000 });

  // STEP 1. A hedge where a counted zero belongs is the 26-10 defect and a BLOCKER, so the parse
  // throwing IS the assertion.
  for (const id of ["needing-attention", "followups-due", "consent", "suppressed"]) {
    expect(await tileValue(page, id), `tile ${id} on an empty tenant`).toBe(0);
  }
  await expect(page.getByTestId("pipeline-tiles")).not.toContainText("Unknown");
  await expect(page.getByTestId("pipeline-tiles")).not.toContainText("—");
  await expect(page.getByTestId("pipeline-empty")).toBeVisible();
  await expect(page.getByTestId("pipeline-contact-row")).toHaveCount(0);

  // STEP 2. 26-18 owns the flip, and adding the `href` IS the activation — so the absence of the
  // href is the thing to pin, not the greyness.
  await expect(page.locator('nav a[href="/dashboard/pipeline"]')).toHaveCount(0);
  const rail = page.locator("nav .rail-item.is-soon").filter({ hasText: "Sales Pipeline" });
  await expect(rail).toHaveCount(1);
  await expect(rail).toHaveAttribute("aria-disabled", "true");
  await expect(rail).toContainText("Soon");
  expect(await rail.evaluate((el) => el.tagName)).not.toBe("A");
});

// ── STEP 3 ────────────────────────────────────────────────────────────────────────────────────────

test("step 3: one row per person, a nameless contact shows its ADDRESS, and a free-standing follow-up sits in its OWN section BENEATH the table", async ({
  page,
}) => {
  await page.goto(PIPELINE);

  // `locator.or()`: a non-auto-waiting `count()` ternary picks the wrong opener straight after a
  // goto (19-10's fix in pipeline.spec.ts — same hazard here).
  const opener = page.getByTestId("add-first-contact").or(page.getByTestId("add-contact"));
  const addContact = async (email: string, name: string) => {
    await opener.first().click();
    const form = page.getByTestId("add-contact-form");
    await form.getByLabel("Email address").fill(email);
    if (name) await form.getByLabel("Name (optional)").fill(name);
    await page.getByTestId("add-contact-save").click();
    await expect(page.getByTestId("add-contact-form")).toHaveCount(0, { timeout: 30_000 });
  };

  await addContact(JANE, "Jane Doe");
  await addContact(NAMELESS, ""); // no name at all — the address must become the identity

  const rows = page.getByTestId("pipeline-contact-row");
  await expect(rows).toHaveCount(2); // ONE row per PERSON, never one per follow-up
  await expect(rows.filter({ hasText: NAMELESS }).getByTestId("contact-name")).toHaveText(NAMELESS);

  // A follow-up bound to Jane moves her OFF "needing attention" (= unowned).
  expect(await tileValue(page, "needing-attention")).toBe(2);
  const jane = rows.filter({ hasText: JANE });
  await jane.getByTestId("contact-add-followup").click();
  const followUpForm = jane.getByTestId("contact-followup-form");
  await followUpForm.getByLabel("Follow-up note").fill("Send the renewal quote");
  await followUpForm.getByLabel("Due date").fill("2026-12-01");
  await jane.getByRole("button", { name: "Save follow-up" }).click();
  await expect(jane).toContainText("Send the renewal quote");
  await expect.poll(() => tileValue(page, "needing-attention")).toBe(1);

  // ── FINDING, recorded rather than worked around ────────────────────────────────────────────────
  // THE PRODUCT SHIPS NO AFFORDANCE FOR A FREE-STANDING FOLLOW-UP. `contacts.createFollowUp` makes
  // `contactId` OPTIONAL, and `/dashboard/pipeline` renders a whole "Follow-ups with nobody
  // attached" section for them — but the only creation path in the UI is the per-ROW
  // `contact-add-followup` form above, and the agent may not file one either (`parseCrmOperations`
  // throws `CRM_FOLLOWUP_CONTACT_REQUIRED`). Seeded here through the REAL public mutation as the
  // REAL signed-in user, so the placement invariant below is observed rather than assumed. That is
  // a seam, not a UI path; the gap is reported to the owner.
  await fetchMutation(
    api.contacts.createFollowUp,
    { note: FREESTANDING_NOTE, dueAt: Date.parse("2026-12-05T09:00:00Z") },
    auth,
  );
  await page.reload();

  const unassigned = page.getByTestId("pipeline-unassigned");
  await expect(unassigned).toContainText(FREESTANDING_NOTE, { timeout: 30_000 });
  // NEVER an em-dash row inside the person table, in either direction.
  await expect(page.getByTestId("pipeline-contacts")).not.toContainText(FREESTANDING_NOTE);
  await expect(page.getByTestId("pipeline-contact-row")).toHaveCount(2);
  await expect(unassigned).not.toContainText("Send the renewal quote");
  // BENEATH: the unassigned section follows the contacts card in DOCUMENT ORDER.
  expect(
    await page.evaluate(() => {
      const contacts = document.querySelector('[data-testid="pipeline-contacts"]');
      const un = document.querySelector('[data-testid="pipeline-unassigned"]');
      if (!contacts || !un) throw new Error("both sections must render");
      return (contacts.compareDocumentPosition(un) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }),
  ).toBe(true);

  // The dashboard shell scrolls an INNER container, so Playwright's `fullPage` still captures only
  // the viewport. A taller viewport is what actually gets the contactless section into the frame —
  // which is the whole point of this screenshot.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await shot(page, "step-03-populated-pipeline");
});

// ── STEP 4 ────────────────────────────────────────────────────────────────────────────────────────

test("step 4: the postal address saves, survives a reload VERBATIM, and blanking it is refused INLINE", async ({
  page,
}) => {
  // A `window.alert`/`confirm` would block the page; count them so "inline" is proven, not assumed.
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs += 1;
    void d.dismiss();
  });

  const ADDRESS = `Pikar UAT Ltd\n19 Verification Way\nDar es Salaam, Tanzania ${stamp}`;
  const openShape = async () => {
    await page.goto(PROFILE);
    const tab = page.getByRole("button", { name: "Business shape" });
    if (await tab.count()) await tab.first().click();
    // WAIT FOR HYDRATION BEFORE TYPING. `ShapePanel` re-syncs the textarea from `tierRow` in an
    // effect, so text typed before that query resolves is silently clobbered — the field always
    // holds SOMETHING here because this tenant is seeded with an address.
    await expect(page.getByLabel("Postal address")).not.toHaveValue("", { timeout: 45_000 });
  };
  const save = async () => {
    const button = page.getByRole("button", { name: /save business shape/i });
    await button.click();
    await expect(button).toBeEnabled({ timeout: 45_000 });
  };
  const storedAddress = async () =>
    ((await fetchQuery(api.tenantProfile.get, {}, auth)) as { postalAddress?: string } | null)
      ?.postalAddress;

  await openShape();
  await page.getByLabel("Postal address").fill(ADDRESS);
  await save();
  // OBSERVABLE STATE first: the row itself, not the box the value was typed into.
  await expect.poll(storedAddress, { timeout: 45_000 }).toBe(ADDRESS);

  await openShape();
  // VERBATIM, newlines and all — a normalising write boundary would show up right here.
  await expect(page.getByLabel("Postal address")).toHaveValue(ADDRESS);

  // Clearing a STORED address is a real write, and the write boundary REFUSES it.
  await page.getByLabel("Postal address").fill("");
  await save();
  // Scoped by TEXT as well as role: Next's `__next-route-announcer__` is also a `role="alert"`.
  await expect(
    page.getByRole("alert").filter({ hasText: /postal address can't be blank/i }),
  ).toBeVisible({ timeout: 45_000 });
  expect(dialogs, "the refusal must be inline, never a browser dialog").toBe(0);

  // FAIL BEFORE MUTATE: still stored server-side, so the refusal ran before the write.
  expect(await storedAddress()).toBe(ADDRESS);
  await openShape();
  await expect(page.getByLabel("Postal address")).toHaveValue(ADDRESS);
});

// ── STEP 5 (REAL MODEL CALL) ──────────────────────────────────────────────────────────────────────

test("step 5: the cockpit stages a crm_write card with NO email chrome, Approvals badges it `CRM update`, and Approve reaches done", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto(WORKSPACE);
  await say(page, `Save Jane Doe ${JANE} as a contact.`);

  const card = page.getByTestId("crm-plan-card");
  await expect(card).toBeVisible({ timeout: 180_000 });
  await expect(card).toContainText("CRM UPDATE");
  await expect(card).toContainText(JANE);
  await expect(card).toContainText(/Nothing is sent to anyone/i);

  // NO recipients, NO mode, NO send-time picker — the whole reason `crm_write` gets its own branch
  // ahead of the email chrome.
  await expect(card).not.toContainText("RECIPIENTS");
  await expect(card).not.toContainText("SEND TIME");
  await expect(card).not.toContainText(/Mode:/);
  await expect(card).not.toContainText(/Send to \d+ recipient/);
  await expect(card.locator('input[type="datetime-local"]')).toHaveCount(0);

  // Nothing may CLAIM the save before the human approves it (19-06 ships no chat receipt on
  // purpose — step 6's page is the receipt).
  const chat = await page.getByTestId("chat-message").allInnerTexts();
  expect(
    chat.some((m) => /\b(i have|i've|已)?\s*(saved|added)\b/i.test(m) && !/approv/i.test(m)),
    `a reply claimed the save before Approve:\n${chat.join("\n---\n")}`,
  ).toBe(false);

  await shot(page, "step-05-crm-plan-card");

  // The Approvals row carries the kind badge.
  const approvals = await page.context().newPage();
  await approvals.goto(APPROVALS);
  await expect(approvals.getByText("CRM update", { exact: true }).first()).toBeVisible({
    timeout: 45_000,
  });
  await approvals.close();

  await card.getByRole("button", { name: /approve & save to records/i }).click();
  // The card leaves the proposed state; `done` is confirmed off the PLAN ROW, not the DOM.
  await expect(card).toHaveCount(0, { timeout: 90_000 });
});

// ── STEP 6 ────────────────────────────────────────────────────────────────────────────────────────

test("step 6: /dashboard/pipeline IS the receipt — the approved contact is there", async ({
  page,
}) => {
  await page.goto(PIPELINE);
  await expect(page.getByTestId("pipeline-contact-row").filter({ hasText: JANE })).toHaveCount(1, {
    timeout: 45_000,
  });
});

// ── STEP 7 (REAL MODEL CALL) — the ACTN-05 regression ─────────────────────────────────────────────

test("step 7: ACTN-05 — a dated reminder stages an addFollowUp WITH a dueAt, not a bare contact", async ({
  page,
}) => {
  test.setTimeout(300_000);
  // ── MEASURED RED, 2026-08-10. NOT a spec bug and NOT a model failure. ──────────────────────────
  // `sendCockpitMessage` has taken an optional `clientContext: { tz, nowMs }` since the calendar
  // tools landed, and 19-11 (`6c9e442`) threaded that trusted clock into the agent loop's own tool
  // set. **NO WEB CALLER HAS EVER SENT IT** — `grep -rn clientContext apps/web` returns nothing,
  // and `ChatPane.tsx`'s composer posts `send({ threadId, text })` flat. So `stageCrmWrite` takes
  // `if (!clientContext) return refuse("no_clock", …)` on EVERY turn a human types, and the
  // capability ACTN-05 names is unreachable from the product.
  //
  // The live reply on this exact turn, verbatim: "I've added Jane to your contacts, but I couldn't
  // stage the follow-up reminder for Thursday since the date wasn't clear." Meanwhile
  // `parseSendTime("Thursday", Date.now(), tz, CALENDAR_HORIZON_MS)` resolves offline at $0 — the
  // date was never the problem. Note the SECOND half of that sentence: a bare contact was written
  // anyway, which is the same two-wrongs shape 19-10 measured, reached by a different route.
  //
  // THE FIX IS ONE LINE, at `apps/web/app/(app)/dashboard/workspace/ChatPane.tsx`'s `onSend`:
  //   send({ threadId, text: t,
  //          clientContext: { nowMs: Date.now(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
  // It is NOT applied here: `:3111` serves a PRODUCTION build and the UAT's operating constraint
  // forbids rebuilding it, so the fix could not be VERIFIED in this run — and an unverified product
  // change is exactly what this phase has been burned by. The four other web callers of
  // `sendCockpitMessage` (SegmentAnatomy, AbnormalBriefBanner, PostCall, cards.tsx's regenerate)
  // are equally clockless and must be checked in the same edit.
  //
  // `test.fail()` — not a weakened assertion. Every expect below still demands the CORRECT
  // behaviour; this marker records the red, keeps the remaining UAT steps runnable, and turns
  // GREEN into a loud failure the day the line above lands, which is when it must be deleted.
  test.fail(
    true,
    "ACTN-05 is NOT met from the browser: ChatPane never sends clientContext, so stageCrmWrite refuses with no_clock.",
  );
  await page.goto(WORKSPACE);
  await say(page, `Remind me Thursday to chase Jane (${JANE}) about the renewal.`);

  // 60s, not 180s: `say()` has already waited for the whole turn to resolve, so the card is either
  // there or it is never coming — and a 3-minute wait on a known red is 3 minutes off every run.
  const card = page.getByTestId("crm-plan-card");
  await expect(card).toBeVisible({ timeout: 60_000 });

  // THE ASSERTION, and it is structural. `describeCrmOperations` renders
  // "Follow up with <email> by <day> — <note>" ONLY for an `addFollowUp`, and `parseCrmOperations`
  // throws `CRM_FOLLOWUP_DUEAT_REQUIRED` unless `dueAt` is a FINITE number — so this line existing
  // on the card PROVES a dated follow-up was staged. The defect 19-10 measured (an `addContact`
  // with no due) renders "Add contact: …" instead and fails here.
  await expect(card).toContainText(/Follow up with \S+@\S+ by .+ — /i, { timeout: 45_000 });
  await expect(card).not.toContainText(/Add contact:/);
  await expect(card).not.toContainText(/Invalid Date/);

  // And again off the PLAN ROW rather than the DOM: the staged op is an `addFollowUp` carrying a
  // finite `dueAt`. This is the exact shape `datedFollowUpCount` counts in the eval gate.
  const threadId = new URL(page.url()).searchParams.get("thread");
  const plan = (await fetchQuery(
    api.plans.byThread,
    { threadId: threadId ?? (await currentThreadId()) },
    auth,
  )) as { kind?: string; crmOperations?: Array<Record<string, unknown>> } | null;
  const ops = plan?.crmOperations ?? [];
  const dated = ops.filter(
    (o) => o.op === "addFollowUp" && typeof o.dueAt === "number" && Number.isFinite(o.dueAt),
  );
  expect(dated.length, `no dated addFollowUp in the staged ops: ${JSON.stringify(ops)}`).toBe(1);
});

/** The active cockpit thread id, read from the plan card's own "Open in cockpit" contract — the
 *  workspace keeps the thread in component state, so this falls back to the newest plan row. */
async function currentThreadId(): Promise<string> {
  const rows = (await fetchQuery(api.cockpit.listThreads, {}, auth)) as Array<{ threadId: string }>;
  const newest = rows[0];
  if (!newest) throw new Error("no cockpit thread for this tenant");
  return newest.threadId;
}

// ── STEP 8 (REAL MODEL CALL) ──────────────────────────────────────────────────────────────────────

test("step 8: a follow-up naming NOBODY makes the agent ASK — it never invents an owner", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const before = await fetchQuery(api.contacts.listContacts, {}, auth);
  const beforeCount = (before as { contacts: unknown[] }).contacts.length;

  await page.goto(WORKSPACE);
  await say(page, "Add a follow-up to review the pricing page.");

  // OBSERVABLE STATE, not reply text. Whatever the agent said, it must not have staged an operation
  // naming a person the user never mentioned, and no contact may appear behind the user's back.
  // `parseCrmOperations` now REFUSES a non-address (`CRM_FOLLOWUP_CONTACT_INVALID`), so a
  // placeholder like `no-email` cannot get through either.
  const card = page.getByTestId("crm-plan-card");
  await page.waitForTimeout(4_000);
  if (await card.count()) {
    await expect(card).not.toContainText(/no-?email/i);
    await expect(card).not.toContainText(/@/);
  }
  const after = await fetchQuery(api.contacts.listContacts, {}, auth);
  expect((after as { contacts: unknown[] }).contacts.length).toBe(beforeCount);
});

// ── STEPS 9 / 10 / 11 — the send-path trust boundary ($0, seeded plans) ───────────────────────────

/** Step 9's fixture, shared by 9a and 9b: five recipients, the third suppressed, one seeded plan,
 *  approved from the cockpit card. Returns the thread and the address that must be dropped. */
async function approveWithOneSuppressed(
  page: Page,
  tag: string,
): Promise<{ threadId: string; dropped: string }> {
  seedSyntheticGmail(tenantId);
  const five = Array.from({ length: 5 }, (_, i) => `uat19-${tag}${i + 1}-${stamp}@example.com`);
  const dropped = `uat19-${tag}3-${stamp}@example.com`; // the THIRD of `five`, named not indexed
  expect(five).toContain(dropped);
  await fetchMutation(api.contacts.markSuppressed, { address: dropped }, auth);

  const { threadId } = seedEmailPlan(tenantId, {
    recipients: five,
    mode: "individual",
    subject: `UAT19 withheld ${tag} ${stamp}`,
    body: "Seeded body for the phase-19 suppression UAT. No provider success is claimed.",
  });

  // The COCKPIT plan card is the SC#5 deliverable surface (19-05). `?thread=` re-opens a seeded
  // thread at its Approve gate — the shipped voice-brief handoff route.
  await page.goto(`${WORKSPACE}?thread=${threadId}`);
  const pane = page.getByTestId("workspace-pane");
  await expect(pane.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 60_000 });
  await pane.getByRole("button", { name: "Approve", exact: true }).click();
  return { threadId, dropped };
}

test("step 9 (a): five recipients, one suppressed → exactly FOUR are queued and the fifth is nowhere", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { threadId, dropped } = await approveWithOneSuppressed(page, "r");

  // OBSERVABLE STATE, not copy. `recipientTotal` falls out of the ALLOWED set by construction, so
  // the Approvals progress bar cannot promise a fifth delivery that structurally cannot happen.
  // `approved` is TRANSIENT — the fan-out moves the row on to delivering/done within a second, so
  // pinning the literal "approved" is a race the first run lost. What matters is that it LEFT
  // `proposed`, i.e. the CAS ran and the send was accepted.
  await expect
    .poll(
      async () =>
        (
          (await fetchQuery(api.plans.byThread, { threadId }, auth)) as {
            status?: string;
          } | null
        )?.status,
      { timeout: 60_000 },
    )
    .not.toBe("proposed");
  const plan = (await fetchQuery(api.plans.byThread, { threadId }, auth)) as {
    status?: string;
    recipientTotal?: number;
  } | null;
  expect(["approved", "delivering", "done"]).toContain(plan?.status);
  expect(plan?.recipientTotal, "recipientTotal must describe the ALLOWED set").toBe(4);

  // And in the browser: the delivery report lists FOUR rows and the suppressed address appears
  // NOWHERE on the page. A recipient that was dropped must not be shown as queued.
  const pane = page.getByTestId("workspace-pane");
  await expect(pane.getByText("REPORT", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(pane.locator("li").filter({ hasText: `-${stamp}@example.com` })).toHaveCount(4);
  await expect(pane).not.toContainText(dropped);

  // What the user ACTUALLY sees after a partial send — see 9(b) for why this, and not the withheld
  // note, is the screenshot the owner needs to judge.
  await shot(page, "step-09a-after-partial-send");
});

test("step 9 (b): the withheld note — SC#5's user-facing half — must actually reach the user", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // ── MEASURED RED, 2026-08-10. The refusals are fine; the SUCCESS report is not. ────────────────
  // 19-05 shipped `Sent to N. Withheld M who unsubscribed: <addresses>.` on BOTH approve surfaces
  // and unit-pinned the string. **NO HUMAN CAN SEE IT**, and the reason is structural, not timing:
  //
  //   • cockpit: `PlanCards` renders `<PlanCard>` only under `plan.status === "proposed"`
  //     (cards.tsx). The note lives in that component's `useState`.
  //   • approvals: `AwaitingCard` comes from `approvals.listAwaiting`, which paginates
  //     status `"proposed"` ONLY. The note lives in that component's `useState` too.
  //
  // A SUCCESSFUL approve is exactly the transition `proposed → approved`, and the reactive
  // subscription lands it before `execute()` resolves — so the component that would render the
  // note has already been replaced by the report card when `setNote`/`setResult` runs. The two
  // REFUSAL notes survive precisely because a refusal LEAVES the plan proposed (steps 10 and 11
  // pass on that same mechanism). Observed here: not visible at any point in 90 seconds.
  //
  // The fix belongs on the plan ROW, not in component state — the withheld set is a durable fact
  // about what was approved and the report card is where a human looks afterwards. Anything kept
  // in `useState` across a status flip is unreachable by construction.
  test.fail(
    true,
    "SC#5's withheld report is destroyed by the same approve that creates it: both approve cards are gated on status==='proposed'.",
  );
  const { dropped } = await approveWithOneSuppressed(page, "w");
  const pane = page.getByTestId("workspace-pane");

  const note = pane.getByRole("status").filter({ hasText: /Withheld 1 who unsubscribed/i });
  await expect(note).toBeVisible({ timeout: 90_000 });
  await expect(note).toContainText(dropped);
  await expect(note).toContainText("Sent to 4.");

  // INFORMATION, not failure: `role="status"` (polite), never `alert`; `--ink-soft`, never the
  // error red and never amber — BRAND §2 reserves `--held` for the approval gate alone.
  const colour = await note.evaluate((el) => getComputedStyle(el).color);
  expect(colour, "the withheld note must not be the error red").not.toBe("rgb(220, 38, 38)");
  await expect(pane.getByRole("alert")).toHaveCount(0);
  await shot(page, "step-09b-withheld-note");
});

test("step 10: no postal address → approve refuses, NAMES the missing field and LINKS to the profile", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  // ── FINDING, recorded rather than faked ────────────────────────────────────────────────────────
  // THE UAT SCRIPT SAYS "clear your postal address". THAT IS NOT EXECUTABLE, and deliberately so:
  // step 4 proves the write boundary REFUSES a blank, `saveFacts` runs its arg through
  // `definedOnly` (so an omitted field is dropped, never deleted), and no UI, agent or public
  // mutation can remove a stored address — an empty CAN-SPAM footer looks compliant and is not.
  // The `no_postal_address` refusal is therefore reached the way a REAL user reaches it: a tenant
  // that has never set one. Onboarded here through the two SHIPPED public mutations
  // (`tenantProfile.saveFacts` + `onboarding.commitProfile`), which is the real first-run path and
  // writes no postal address — rather than through `__seedOnboardedTenant`, which seeds one.
  const context = await browser.newContext({ storageState: undefined }); // a DIFFERENT tenant
  const page = await context.newPage();
  const authB = await signUp(page, `uat19b-${stamp}@example.com`);
  const tenantB = tenantIdFrom(authB.token);
  spentTenants.push(tenantB);

  await fetchMutation(
    api.tenantProfile.saveFacts,
    {
      headcount: 1,
      paidStaff: 0,
      revenueStage: "early-revenue",
      funding: "bootstrapped",
      yearsOperating: 2,
    },
    authB,
  );
  await fetchMutation(
    api.onboarding.commitProfile,
    {
      profile: {
        name: "UAT19 No-Postal Ltd",
        oneLineDescription: "A tenant that never filled in its postal address.",
        stage: "early-revenue",
        offering: "A UAT offering.",
        targetCustomer: "UAT customers.",
        primaryGoals: ["Grow revenue"],
        knownConstraints: ["Solo operator"],
      },
    },
    authB,
  );
  seedSyntheticGmail(tenantB);

  const { threadId } = seedEmailPlan(tenantB, {
    recipients: [`uat19-nopostal-${stamp}@example.com`],
    mode: "individual",
    subject: `UAT19 no-postal ${stamp}`,
    body: "Seeded body.",
  });

  await page.goto(`${WORKSPACE}?thread=${threadId}`);
  const pane = page.getByTestId("workspace-pane");
  await expect(pane.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 60_000 });
  await pane.getByRole("button", { name: "Approve", exact: true }).click();

  const refusal = pane.getByRole("alert");
  await expect(refusal).toContainText(/Add your postal address before sending/i, {
    timeout: 90_000,
  });
  await expect(refusal).toContainText(/the law requires it/i); // NAMES why, not just what
  // …and POINTS at the page that fixes it.
  await expect(refusal.getByRole("link", { name: /open your profile/i })).toHaveAttribute(
    "href",
    "/dashboard/profile",
  );

  // FAIL BEFORE MUTATE: every governed refusal returns above the CAS patch.
  const plan = (await fetchQuery(api.plans.byThread, { threadId }, authB)) as {
    status?: string;
    recipientTotal?: number;
  } | null;
  expect(plan?.status, "a refusal above the CAS leaves the plan proposed").toBe("proposed");
  expect(plan?.recipientTotal ?? 0, "nothing may be queued").toBe(0);

  await shot(page, "step-10-no-postal-refusal");
  await context.close();
});

test("step 11: every recipient suppressed → approve refuses, the plan stays proposed, nothing is queued", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const two = [`uat19-all1-${stamp}@example.com`, `uat19-all2-${stamp}@example.com`];
  for (const address of two) {
    await fetchMutation(api.contacts.markSuppressed, { address }, auth);
  }

  const { threadId } = seedEmailPlan(tenantId, {
    recipients: two,
    mode: "individual",
    subject: `UAT19 all-suppressed ${stamp}`,
    body: "Seeded body.",
  });

  await page.goto(`${WORKSPACE}?thread=${threadId}`);
  const pane = page.getByTestId("workspace-pane");
  await expect(pane.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 60_000 });
  await pane.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(pane.getByRole("alert")).toContainText(/every recipient has unsubscribed/i, {
    timeout: 90_000,
  });

  const plan = (await fetchQuery(api.plans.byThread, { threadId }, auth)) as {
    status?: string;
    recipientTotal?: number;
  } | null;
  expect(plan?.status, "a refusal above the CAS leaves the plan proposed").toBe("proposed");
  expect(plan?.recipientTotal ?? 0, "nothing may be queued").toBe(0);
});

// ── STEP 12 ───────────────────────────────────────────────────────────────────────────────────────

test("step 12 (NOT BROWSER-AUTOMATABLE): the footer boundary is buildMime, and its coverage is pinned here", async () => {
  // A real Gmail inbox is out of scope for this harness, and no synthetic token can put a byte in
  // one — so this step CANNOT be verified in a browser and is not pretended to be. 19-05 put the
  // footer at the `buildMime` CALL SITE precisely so both halves are unit-observable, and
  // `gmail.test.ts` asserts them. This is a COVERAGE LINK, not a re-implementation: it fails if
  // that coverage is ever deleted, which is the only honest thing a browser spec can contribute.
  const source = readFileSync(resolve(backendDir, "convex/gmail.test.ts"), "utf8");
  expect(source, "the delivered-message half must stay covered").toMatch(/unsubscribe\//);
  expect(source, "the service-notice half must stay covered").toMatch(/notifyExternal|service/i);
  expect(source, "the postal address half must stay covered").toMatch(/postalAddress/);
});

// ── STEP 13 ───────────────────────────────────────────────────────────────────────────────────────

test("step 13: the unsubscribe GET suppresses NOTHING — only the Confirm POST does", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const recipient = `uat19-unsub-${stamp}@example.com`;
  // Mint a REAL signed link the way a real send does: `footerFor` is the only minter, and it needs
  // the postal address step 4 stored plus `UNSUBSCRIBE_SECRET` on the DEPLOYMENT.
  const footer = convexRun<{ text: string } | null>("contacts:footerFor", {
    tenantId,
    recipient,
  });
  expect(
    footer,
    "footerFor returned null — is UNSUBSCRIBE_SECRET set on the DEPLOYMENT?",
  ).toBeTruthy();
  const url = /https?:\/\/\S*\/unsubscribe\/\S+/.exec(footer?.text ?? "")?.[0];
  expect(url, `no unsubscribe URL in the minted footer:\n${footer?.text}`).toBeTruthy();

  const before = await suppressionRowCount(page);

  // THE GET. Corporate mail scanners and link prefetchers fire every URL in a message, so this must
  // write nothing at all.
  await page.goto(url as string);
  await expect(page.getByRole("heading", { name: /stop receiving these emails/i })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText(recipient)).toBeVisible(); // echoes the RIGHT address
  await expect(page.getByText(/Nothing has changed yet/i)).toBeVisible();
  // JUDGEMENT CALL for the owner — the one screen a RECIPIENT (not a user) ever sees, inline-styled
  // from BRAND hex because a Convex httpAction cannot import globals.css.
  await shot(page, "step-13-unsubscribe-landing");

  // INERTNESS BY ROW-COUNT DELTA, never by status code — a 200-vs-404 check passes the mutant where
  // the GET writes (19-04's lesson).
  expect(await suppressionRowCount(page), "the GET must not suppress anyone").toBe(before);

  // THE POST.
  await page.goto(url as string);
  await page.getByRole("button", { name: /^unsubscribe$/i }).click();
  await expect(page.getByRole("heading", { name: /you have been unsubscribed/i })).toBeVisible({
    timeout: 45_000,
  });
  expect(await suppressionRowCount(page), "the Confirm POST must suppress exactly one").toBe(
    before + 1,
  );

  // A replayed link is harmless and does NOT double-count — the idempotency that IS the abuse
  // mitigation for an unauthenticated route with no rate limiter.
  await page.goto(url as string);
  await page.getByRole("button", { name: /^unsubscribe$/i }).click();
  await expect(page.getByRole("heading", { name: /you have been unsubscribed/i })).toBeVisible();
  expect(await suppressionRowCount(page)).toBe(before + 1);
});

// ── STEP 14 ───────────────────────────────────────────────────────────────────────────────────────

test("step 14: at phone width the four tiles and the table stay readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 CSS px
  await page.goto(PIPELINE);
  await expect(page.getByTestId("pipeline-tiles")).toBeVisible({ timeout: 45_000 });

  for (const id of ["needing-attention", "followups-due", "consent", "suppressed"]) {
    const tile = page.getByTestId(`pipeline-tile-${id}`);
    await expect(tile).toBeVisible();
    const box = await tile.boundingBox();
    expect(box?.width ?? 0, `tile ${id} width at 390px`).toBeGreaterThan(80);
    expect(
      (box?.x ?? 0) + (box?.width ?? 0),
      `tile ${id} must not overflow the viewport`,
    ).toBeLessThanOrEqual(391);
  }

  // BRAND §4 forbids a dense table on white bleeding off screen: the table gets its own scroller
  // rather than pushing the PAGE wider than the viewport.
  const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(docWidth, "the page itself must not scroll horizontally").toBeLessThanOrEqual(391);

  await shot(page, "step-14-phone-width");
});
