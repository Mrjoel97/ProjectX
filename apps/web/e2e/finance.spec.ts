import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Connected FIN-01 browser evidence.
//
// EVERY MOVEMENT BELOW IS SEEDED THROUGH THE REAL LEDGER WRITER (`spendLedger:record`), so this
// proves the projection, the coverage semantics and the role boundary. **It proves nothing about a
// provider.** No model call, fal job or invoice is involved: a seeded `actual` row is an accounting
// state, not evidence that money reached OpenAI or fal. Any claim about a real external charge
// requires separately executed live evidence, recorded in the plan summary — never inferred from a
// green run here.
//
// The owner half is deliberately ordered: the NON-owner assertions run FIRST, then the promotion.
// That ordering is now a convenience rather than a one-way door — `owner:revokeOwner` (added
// alongside `bootstrapOwner`) makes the grant reversible, so `seedOnboarded` can put this shared
// identity back to non-owner on every run and `afterAll` leaves it that way. Before that inverse
// existed this spec was SINGLE-USE: one run promoted the only E2E identity for ever, and the
// non-owner boundary — the thing these assertions exist to prove — became unobservable.

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const defaultAppOrigin = "http://127.0.0.1:3111";
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? defaultAppOrigin;
const ROUTE = "/dashboard/finance";

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
    // Convex CLI 1.42.1 on Windows can print a valid committed result and then exit non-zero on a
    // libuv closing-handle assertion (approvals.spec.ts, verbatim). A missing/invalid result still
    // fails below, so this never turns a real Convex error green.
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    if (!result.stdout.trim() && /UV_HANDLE_CLOSING/.test(stderr)) return undefined as T;
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

async function tokenFor(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!token) throw new Error("Finance E2E has no Convex Auth JWT in storageState.");
  return token;
}

type Movement = {
  rail: "reasoning" | "media" | "ingest";
  phase: "estimated" | "reserved" | "actual" | "refunded" | "adjustment";
  amountCents: number;
  correlationId: string;
  createdAt: number;
  kind?: string;
  model?: string;
};

const record = (tenantId: string, movement: Movement) =>
  convexRun<string>("spendLedger:record", { tenantId, ...movement });

/**
 * The unlanded cents this rail ALREADY shows, read from the rendered page.
 *
 * The unlanded figures are WINDOW TOTALS over 30 days, not per-run numbers. Section 5 used to
 * assert the literal "$5.00"/"$1.90" this run's seeds produce, which is only true on a tenant that
 * has never been used: a second run inside the window reads $10.00/$3.80, a third $15.00/$5.70.
 * Measured — this tenant reached 10 `spendEvents` rows and the literal assertion failed there.
 * Asserting the DELTA makes the spec re-runnable on any tenant, dirty or fresh, which is what a
 * gate has to be.
 *
 * Read from the DOM rather than from `finance:summary`: that query takes `windowArgs`, and calling
 * it with `{}` returns an error whose shape is easy to mistake for "nothing unlanded" — which is
 * exactly the silent 0 that made the first version of this helper assert `$1.90` against a page
 * showing `$5.70`. The page is the thing under test, so read the page.
 *
 * ABSENT means zero and is fine: the rail renders no `[data-unlanded]` item when nothing is
 * outstanding. PRESENT-but-unparseable throws, because that is a changed contract, not a zero.
 */
async function unlandedShown(page: Page, rail: "ingest" | "media"): Promise<number> {
  const item = page.locator(`[data-unlanded="${rail}"]`);
  if ((await item.count()) === 0) return 0;
  const text = await item.first().innerText();
  const match = text.match(/\$([\d,]+\.\d{2}) unlanded/);
  if (!match) {
    throw new Error(`[data-unlanded="${rail}"] carries no "$X.YZ unlanded" figure: ${text}`);
  }
  return Math.round(Number(match[1]!.replace(/,/g, "")) * 100);
}

const usd = (cents: number) => "$" + (cents / 100).toFixed(2);

// `playwright.config.ts` sets `fullyParallel: true`, which otherwise gives NO guarantee that tests
// in this file run in declaration order or in the same worker. Every test below shares one signed-in
// identity (the same `storageState` file), and the owner grant is deployment-wide state — so
// without forcing serial order, a non-owner assertion could race an owner-promoting test and
// observe a boundary that has already been crossed. This is what actually enforces "non-owner
// first, owner last," not the file order alone. The revoke below repairs state BETWEEN runs; it
// cannot repair a race WITHIN one, so this stays serial.
test.describe.configure({ mode: "serial" });

/**
 * Fresh local users sit behind the onboarding gate — the SAME seam the connected test below (the
 * one that calls `owner:bootstrapOwner`) already clears before its own assertions, via the same
 * `convexRun("onboarding:__seedOnboardedTenant", ...)` call. Every test that runs BEFORE that one
 * needs this too: an un-onboarded user redirected off `/dashboard/finance` would make a
 * `toHaveCount(0)`/`not.toBeVisible()` assertion pass VACUOUSLY — absent because the page never
 * rendered at all, not because the boundary the test means to check actually holds.
 */
// The shared identity this file promotes, remembered so `afterAll` can hand it back a non-owner.
let promotedUserId: string | null = null;

async function seedOnboarded(page: Page): Promise<void> {
  await page.goto(`${appOrigin}${ROUTE}`);
  const token = await tokenFor(page);
  const tenantId = tenantIdFrom(token);
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });
  await page.reload();
}

// Leave the deployment as we found it. Non-owner is not merely this spec's precondition — it is the
// state a human must be able to SEE to review the boundary during a UAT, and there is exactly one
// other loggable account here. A run that exits leaving this identity an owner spends that for
// everyone, which is precisely the cost that made this file single-use before the inverse existed.
// ONCE PER FILE, BEFORE ANY TEST, AND NOT INSIDE `seedOnboarded`.
//
// The non-owner assertions live in the connected test at the bottom, and that test does NOT call
// `seedOnboarded` — only the three short tests above it do. A revoke hidden inside that helper
// therefore never ran for the very test whose boundary it exists to protect: running with
// `-g "connected cost console"` after a previous run left the account promoted made section 2 fail
// with "Operator tab: expected 0, received 1". Measured, and it is why this is a `beforeAll`.
//
// The identity comes from the storageState `auth.setup.ts` just wrote, so this needs no page and
// no browser — which is what lets it run before the first test rather than inside one.
test.beforeAll(() => {
  const stateFile = resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
    origins?: { localStorage?: { name: string; value: string }[] }[];
  };
  const entry = (state.origins ?? [])
    .flatMap((origin) => origin.localStorage ?? [])
    .find((item) => item.name.startsWith("__convexAuthJWT"));
  if (!entry) throw new Error("storageState carries no Convex Auth JWT — did auth.setup.ts run?");
  promotedUserId = tenantIdFrom(entry.value);
  // Idempotent: `changed:false` on an account that never held owner, so this is a no-op on a clean
  // deployment and a rescue on one a previous run left promoted.
  convexRun("owner:revokeOwner", { userId: promotedUserId });
});

test.afterAll(() => {
  if (promotedUserId === null) return;
  convexRun("owner:revokeOwner", { userId: promotedUserId });
});

test("the Finance page opens on Business, and a non-owner is offered no Operator tab", async ({
  page,
}) => {
  await seedOnboarded(page);
  const tablist = page.getByRole("tablist", { name: "Finance sections" });
  await expect(tablist.getByRole("tab", { name: "Business" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tablist.getByRole("tab", { name: "Pikar spend" })).toBeVisible();
  await expect(tablist.getByRole("tab", { name: "Operator" })).toHaveCount(0);
});

test("the Cost console is intact behind the Pikar spend tab", async ({ page }) => {
  await seedOnboarded(page);
  await page.getByRole("tab", { name: "Pikar spend" }).click();
  await expect(page.getByRole("heading", { name: /budget rails/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /where it went/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /media job ledger/i })).toBeVisible();
});

test("a number entered in the panel appears as a business figure", async ({ page }) => {
  await seedOnboarded(page);
  // Seeds through the real mutation, so this proves the panel → mutation → derivation → render
  // path end to end. It proves nothing about any external system.
  // `{ exact: true }` is REQUIRED, not tidiness. `getByLabel` substring-matches by default, and
  // `InputRow` gives its Save button `aria-label={`Save ${spec.label}`}` — so the loose form
  // resolves to TWO elements (the input `cash-input-cashOnHand` AND the button "Save Cash on
  // hand") and `fill()` dies on a strict-mode violation. Measured on the live page: loose 2,
  // exact 1. The failure reads as "waiting for getByLabel(…)" until it times out, which points at
  // the page rather than at the locator and is why this looked like a missing field.
  await page.getByLabel("Cash on hand", { exact: true }).fill("60000");
  await page.getByRole("button", { name: /save cash on hand/i }).click();
  await page.getByLabel("Monthly operating cost", { exact: true }).fill("10000");
  await page.getByRole("button", { name: /save monthly operating cost/i }).click();
  await expect(page.getByText(/6 months/i)).toBeVisible();
});

test("connected cost console: coverage, rails, unlanded meaning and the owner boundary", async ({
  page,
}) => {
  test.setTimeout(180_000);

  if (appOrigin !== defaultAppOrigin) {
    const state = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json"), "utf8"),
    ) as {
      origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    };
    const saved = state.origins?.find((entry) => entry.origin === defaultAppOrigin)?.localStorage;
    if (!saved) throw new Error("No saved storage state for the canonical origin.");
    await page.addInitScript((entries: Array<{ name: string; value: string }>) => {
      for (const entry of entries) window.localStorage.setItem(entry.name, entry.value);
    }, saved);
  }

  await page.goto(ROUTE);
  const token = await tokenFor(page);
  const tenantId = tenantIdFrom(token);
  // Fresh local users sit behind the onboarding gate; this seam clears it with no model spend.
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });
  await page.reload();

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();

  // ── 1. The route is reachable directly while its nav item is now LIVE ────────────────
  // Task 1 shipped the shell with the heading "Know what it costs" and navigation disabled;
  // Task 3 (26-10, on owner direction) renamed the heading to "Your money, and what Pikar costs"
  // (FinanceTabs.tsx) and activated the nav link (apps/web/app/(app)/layout.tsx). Both are page-
  // chrome, unaffected by which tab is active.
  await expect(page.getByRole("heading", { name: "Your money, and what Pikar costs" })).toBeVisible(
    { timeout: 20_000 },
  );
  await expect(page.getByRole("link", { name: "Finance" })).toBeVisible();

  // The page opens on Business by default (a separate test above already covers that). Everything
  // below through section 6 is Pikar-spend content, which `FinanceTabs.tsx` mounts but keeps
  // `hidden` while another tab is active — click through to it ONCE; `selectTab` persists the
  // choice as `?tab=spend` via `history.replaceState`, so it survives every `page.reload()` below
  // without re-clicking (whole-branch review B5 — the pre-existing spec never clicked any tab and
  // asserted Pikar-spend visibility while the page opened on the now-default Business tab).
  await page.getByRole("tab", { name: "Pikar spend" }).click();

  // ── 2. NON-OWNER FIRST — the boundary is unobservable once this account is promoted ──
  // The Operator tab — and everything inside it, including `DeploymentSection` — is not merely
  // hidden for a non-owner, it is not MOUNTED at all (`FinanceTabs.tsx`:
  // `{isOwner ? (<div>...<OperatorTab /></div>) : null}`), so "managed by the operator" and a
  // `region`/`section` locator for "Deployment controls" can never resolve here regardless of which
  // tab is active — that markup simply is not on the page. The earlier "no Operator tab" test
  // already covers the tab button; this proves no ceiling number leaks in via the raw HTML either.
  await expect(page.getByRole("tab", { name: "Operator" })).toHaveCount(0);
  // Not a single deployment ceiling may be in the DOM of a caller who is not the owner.
  const nonOwnerHtml = await page.content();
  for (const ceiling of ["$50.00", "$100.00", "$250.00"]) {
    expect(nonOwnerHtml).not.toContain(ceiling);
  }
  // …and the API refuses directly, which is the real boundary. The UI absence above is cosmetic.
  const refusal = await page.evaluate(
    async ([url, jwt]) => {
      const response = await fetch(`${url}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ path: "finance:controls", args: {}, format: "json" }),
      });
      return JSON.stringify(await response.json());
    },
    [process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210", token],
  );
  expect(refusal).toContain("OWNER_REQUIRED");

  // ── 3. Coverage: an untracked period is Unknown, never $0 ───────────────────────────
  // Asserted BEFORE any `record` call, because `recordMovement` opens coverage as a side effect.
  const coverage = convexRun<number | null>("spendLedger:coverage", { tenantId });
  if (coverage === null) {
    await expect(page.getByText(/Unknown/)).toBeVisible();
    await expect(page.getByText(/has not started/)).toBeVisible();
  }

  // ── 4. One controlled movement per rail and phase ───────────────────────────────────
  // BASELINE FIRST — everything section 5 asserts is a delta on top of what this tenant already
  // carried. Read before a single `record` call, or the baseline would include this run.
  const ingestBefore = await unlandedShown(page, "ingest");
  const mediaBefore = await unlandedShown(page, "media");
  const at = now - 60 * 60 * 1000;
  record(tenantId, {
    rail: "reasoning",
    phase: "actual",
    amountCents: 42,
    correlationId: `e2e:${suffix}:reasoning`,
    createdAt: at,
  });
  record(tenantId, {
    rail: "ingest",
    phase: "reserved",
    amountCents: 900,
    correlationId: `e2e:${suffix}:folder`,
    createdAt: at,
  });
  record(tenantId, {
    rail: "ingest",
    phase: "refunded",
    amountCents: 400,
    correlationId: `e2e:${suffix}:folder`,
    createdAt: at,
  });
  record(tenantId, {
    rail: "media",
    phase: "reserved",
    amountCents: 300,
    correlationId: `mediabatch:e2e-${suffix}`,
    createdAt: at,
    kind: "video",
  });
  record(tenantId, {
    rail: "media",
    phase: "actual",
    amountCents: 110,
    correlationId: `mediabatch:e2e-${suffix}:j1`,
    createdAt: at,
    kind: "video",
  });
  // A replayed movement must not double-count: identity is (tenant, correlation, phase).
  record(tenantId, {
    rail: "media",
    phase: "actual",
    amountCents: 110,
    correlationId: `mediabatch:e2e-${suffix}:j1`,
    createdAt: at,
    kind: "video",
  });

  // `?tab=spend` rides the URL from the click in section 1, so this reload lands back on Pikar
  // spend without re-clicking — see that section's comment.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your money, and what Pikar costs" })).toBeVisible(
    { timeout: 20_000 },
  );

  // Each movement appears exactly ONCE in its rail/phase — the replay above added no second row.
  await expect(page.getByRole("row", { name: /Media generation/ })).toHaveCount(1);
  const ledgerRows = page.locator(`tr:has-text("mediabatch:e2e-${suffix}:j1")`);
  await expect(ledgerRows).toHaveCount(1);

  // ── 5. Unlanded says two different things, on one page ──────────────────────────────
  // ingest: reserved 900 − refunded 400 = 500 still out, and it can still resolve.
  // DELTAS, not literals — see `unlandedByRail`. This run adds ingest 900−400 = 500 still out
  // and media 300−110 = 190 that never comes back; the page shows those ON TOP of whatever the
  // tenant already held. The arithmetic under test is identical; only the assumption that the
  // tenant started empty is gone. Scoped to the rail's own `[data-unlanded]` item so the figure
  // cannot be matched from the ledger's copy of the same sentence.
  const expectedIngest = usd(ingestBefore + 500);
  const expectedMedia = usd(mediaBefore + 190);
  await expect(page.locator('[data-unlanded="ingest"]')).toContainText(
    `${expectedIngest} unlanded`,
  );
  await expect(page.getByText(/still expected to land/)).toBeVisible();
  // media: reserved 300 − actual 110 = 190 that is NEVER coming back.
  await expect(page.locator('[data-unlanded="media"]')).toContainText(
    `${expectedMedia} unlanded`,
  );
  // SCOPED to the unlanded list item, not a bare text match. The same sentence is deliberately
  // rendered twice — once on the rail's own `<li data-unlanded="media">` and once in the Media job
  // ledger — so `getByText(/no refund path/)` is a strict-mode violation. The rail explanation is
  // the one this assertion means, and `data-unlanded` already names it.
  await expect(page.locator('[data-unlanded="media"]')).toContainText(/no refund path/);

  // Coverage is open now, so the window states a confident figure rather than Unknown.
  await expect(page.getByRole("row", { name: /All rails/ })).toBeVisible();

  // ── 6. The enforcement clock is labelled UTC and is not the chart's timezone ─────────
  await expect(page.getByText(/resets .*\(UTC\)/).first()).toBeVisible();

  // ── 7. OWNER LAST — promote, then prove the controls return effective state ─────────
  const granted = convexRun<{ changed: boolean }>("owner:bootstrapOwner", { userId: tenantId });
  expect(typeof granted.changed).toBe("boolean");
  // `?tab=spend` still rides the URL (it does not un-set itself), so the reload lands back on
  // Pikar spend even though this account is an owner now — the Operator tab exists in the DOM for
  // the first time this run, but is not the ACTIVE one until clicked.
  await page.reload();
  await page.getByRole("tab", { name: "Operator" }).click();

  await expect(page.getByText("there is no single combined limit")).toBeVisible({
    timeout: 20_000,
  });
  // Three separate ceilings, never one combined number.
  // WAIT FOR THE FIRST CEILING BEFORE SNAPSHOTTING. The static copy asserted above renders
  // immediately; the ceilings arrive one async hop later with `globalRails`. `page.content()` is a
  // single instant with no auto-wait, so capturing it here caught a skeleton still showing
  // "Loading cost…" and none of the three figures — measured, this is exactly how it failed.
  await expect(page.getByText("$50.00").first()).toBeVisible({ timeout: 20_000 });
  const ownerHtml = await page.content();
  for (const ceiling of ["$50.00", "$100.00", "$250.00"]) {
    expect(ownerHtml).toContain(ceiling);
  }

  // A deployment-wide pause takes two deliberate clicks, and the second is explicitly a confirm.
  const mediaToggle = page.locator('[data-control="Media kill switch"]');
  try {
    await mediaToggle.getByRole("button", { name: /^Turn on$/ }).click();
    await mediaToggle.getByRole("button", { name: /^Confirm — Turn on$/ }).click();
    await expect(mediaToggle.getByText("On — paid generation is paused.")).toBeVisible();
    // The master switch is INDEPENDENT: pausing generation must not pause the email cockpit.
    await expect(
      page.locator('[data-control="Master kill switch"]').getByText("Off — model calls permitted"),
    ).toBeVisible();
  } finally {
    // `mediaKillSwitch` is deployment-wide `guardrailConfig`, NOT test state. Without this block a
    // failed assertion above aborts the test with paid generation still paused for EVERY tenant,
    // until a human notices. Reload first: it clears any half-armed confirm, so the revert works
    // from whichever of the two clicks we died on.
    // ponytail: reverted through the UI because `setMediaKillSwitch` is an ownerMutation and
    // `convex run` carries no user identity; an internal revert helper is the upgrade path.
    try {
      await page.reload();
      await page.getByRole("tab", { name: "Operator" }).click();
      // `isVisible()` does not auto-wait — ask only once the control has actually rendered, or a
      // premature `false` skips the revert and re-creates the bug this block exists to prevent.
      await mediaToggle
        .getByText(/^(On|Off) — paid generation/)
        .waitFor({ state: "visible", timeout: 20_000 });
      if (await mediaToggle.getByText("On — paid generation is paused.").isVisible()) {
        await mediaToggle.getByRole("button", { name: /^Turn off$/ }).click();
        await mediaToggle.getByRole("button", { name: /^Confirm — Turn off$/ }).click();
      }
    } catch (revertError) {
      // Swallowing would hide the real failure; rethrowing would REPLACE it. Shout instead.
      console.error(
        "[finance.spec] MEDIA KILL SWITCH MAY STILL BE ON deployment-wide — revert failed:",
        revertError,
      );
    }
  }
  await expect(mediaToggle.getByText("Off — paid generation permitted.")).toBeVisible();

  // ── 8. Responsive + keyboard, at the two breakpoints the UAT also checks ────────────
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("heading", { name: "Your money, and what Pikar costs" }),
    ).toBeVisible();
    // A wide table must scroll inside its own container, never make the page scroll sideways.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, `page scrolls horizontally at ${viewport.width}px`).toBe(false);
  }
});

// Runs AFTER the test above, which is what promotes this browser's user to owner via
// `owner:bootstrapOwner`. An owner-tab assertion placed before it would observe nothing, and one
// placed in an earlier file/worker could poison the non-owner assertions above — hence one file,
// one ordering, owner last; `afterAll` hands the account back after. Deliberately does NOT call
// `seedOnboarded` again: the connected test above already cleared the onboarding gate for this
// same signed-in tenant, and that state does not un-set itself.
test("an owner gets the Operator tab, and the deployment controls live there", async ({ page }) => {
  await page.goto(`${appOrigin}${ROUTE}`);
  await page.getByRole("tab", { name: "Operator" }).click();
  await expect(page.getByRole("heading", { name: /deployment controls/i })).toBeVisible();
  // And they are NOT VISIBLE on the tenant's own tabs any more — the original complaint. NOT
  // `toHaveCount(0)`: `FinanceTabs.tsx` mounts Operator only for an owner but then toggles it with
  // `hidden`, same as Business/Pikar-spend — the panel stays in the DOM while another tab is
  // active (that is what lets a half-typed number survive a tab switch), so a count-based
  // assertion here would find the hidden node and fail. `not.toBeVisible()` is what "not on this
  // tab" actually means for a panel that is designed to stay mounted.
  await page.getByRole("tab", { name: "Business" }).click();
  await expect(page.getByText(/master kill switch/i)).not.toBeVisible();
});
