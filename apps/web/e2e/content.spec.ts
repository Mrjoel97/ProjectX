import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Connected CONT-01 browser evidence — the Content library (plan 26-13).
//
// **EVERY ROW BELOW IS SEEDED, AND SEEDED ROWS PROVE UI STATES ONLY.** No provider ran: the
// "reel" is a handful of bytes with a video mime, and its sidecar is a marker. A green run here
// says the page reads the shelf, the guards and the states correctly. It says NOTHING about fal,
// ffmpeg, an embedding, or a real render ever having happened — any such claim needs separately
// executed live evidence recorded in the plan summary.
//
// STAGE FIRST, AUTHENTICATE AFTER. Every `npx convex run` against the local backend ends the
// browser session (e2e/README.md), so all seeding happens in `beforeAll` off the storageState JWT,
// before any page exists. The finance spec's structure, verbatim.

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const ROUTE = "/dashboard/content";

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

// The whole file shares one identity and one seeded shelf, so the tests run in order.
test.describe.configure({ mode: "serial" });

const MARKER = `e2e${Date.now().toString(36)}`;
const PROMOTABLE = `Northfield scope and pricing (${MARKER})`;
const LEGACY = `Legacy one-pager (${MARKER})`;
let tenantId = "";
let memoTitle = "";
let provedReelTitle = "";
let unprovedReelTitle = "";

test.beforeAll(() => {
  const state = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json"), "utf8"),
  ) as {
    origins?: { localStorage?: { name: string; value: string }[] }[];
  };
  const entry = state.origins
    ?.flatMap((origin) => origin.localStorage ?? [])
    .find((item) => item.name.startsWith("__convexAuthJWT"));
  if (!entry) throw new Error("storageState carries no Convex Auth JWT — did auth.setup.ts run?");
  tenantId = tenantIdFrom(entry.value);

  // An un-onboarded tenant is force-redirected to /dashboard/onboarding and can reach no route.
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });

  // A promotable, agent-authored document WITH provenance — the promotion and reuse subject.
  convexRun("vault:insertCreatedDoc", {
    tenantId,
    title: PROMOTABLE,
    form: "long",
    markdown: `Scope, pricing and the Q3 milestones. Marker ${MARKER}.`,
    contentHash: `${MARKER}-promotable`,
    sourceThreadId: `smoke-content-doc-${MARKER}`,
  });

  // A LEGACY document: written before 26-11 recorded which conversation produced an artifact, so
  // it carries no provenance pair at all and must be offered no reuse link.
  convexRun("vault:insertCreatedDoc", {
    tenantId,
    title: LEGACY,
    form: "short",
    markdown: `An older note with no recorded conversation. Marker ${MARKER}.`,
    contentHash: `${MARKER}-legacy`,
  });

  // The memo and both reels — see `smoke.seedContentShelf` for why these cannot come from a
  // shipped function, and for the terminal-rows-prove-UI-only caveat.
  const seeded = convexRun("smoke:seedContentShelf", { tenant: tenantId, marker: MARKER });
  const parsed = JSON.parse(seeded) as {
    memoTitle: string;
    provedReelTitle: string;
    unprovedReelTitle: string;
  };
  memoTitle = parsed.memoTitle;
  provedReelTitle = parsed.provedReelTitle;
  unprovedReelTitle = parsed.unprovedReelTitle;
});

test("the Content route is live in the nav and lights up when you are on it", async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.getByRole("heading", { name: "Your content library" })).toBeVisible();

  // BEFORE Task 3 this test asserted the opposite — a `Soon` item with `aria-disabled="true"` and
  // no href anywhere in the DOM — and that is what the browser gate proved on 2026-08-22 before the
  // UAT. Task 3 flipped it on owner approval, so the assertion flips with it: the record of "the
  // nav was still dark when the gate ran" lives in 26-13-SUMMARY.md and the playbook, not in a test
  // that would now be asserting a state the product deliberately left behind.
  const rail = page.locator('a[href="/dashboard/content"]');
  await expect(rail).toHaveCount(1);
  await expect(rail).toHaveClass(/is-active/);
  await expect(page.locator(".rail-item.is-soon", { hasText: "Content" })).toHaveCount(0);
});

test("all three shelf kinds render, and the moved surfaces are named rather than dropped", async ({
  page,
}) => {
  await page.goto(ROUTE);
  await expect(page.getByRole("heading", { name: "Your content library" })).toBeVisible();

  // One shelf, three lanes.
  await expect(page.getByText(PROMOTABLE, { exact: false })).toBeVisible();
  await expect(page.getByText(memoTitle, { exact: false })).toBeVisible();
  await expect(page.getByText(provedReelTitle, { exact: false })).toBeVisible();

  // The chips exist and carry counts.
  for (const lane of ["all", "document", "memo", "reel"]) {
    await expect(page.locator(`button[data-lane="${lane}"]`)).toHaveCount(1);
  }

  // CONT-01 as amended: sent mail moved to Reports, research briefs to the Knowledge Vault. The
  // page NAMES the new owners; it does not silently stop showing the categories.
  const moved = page.getByTestId("moved-surfaces");
  await expect(moved).toContainText("Reports");
  await expect(moved).toContainText("Knowledge Vault");
  await expect(moved.locator('a[href="/dashboard/vault"]')).toHaveCount(1);

  // …and offers neither lane, nor a Refresh Research action.
  const html = await page.content();
  expect(html).not.toMatch(/Refresh Research/i);
  expect(html).not.toMatch(/recipients?/i);
});

test("a document opens in place, and a legacy one is offered no conversation to reopen", async ({
  page,
}) => {
  await page.goto(ROUTE);
  const promotable = page.locator('[data-testid="artifact-card"]', { hasText: PROMOTABLE });
  await expect(promotable).toBeVisible();

  // Reuse is a LINK into the cockpit — not a copy, not a send.
  const reuse = promotable.getByTestId("reuse-artifact");
  await expect(reuse).toHaveAttribute("href", /\/dashboard\/workspace\?thread=/);

  const legacy = page.locator('[data-testid="artifact-card"]', { hasText: LEGACY });
  await expect(legacy.getByTestId("reuse-unavailable")).toBeVisible();
  await expect(legacy.getByTestId("reuse-artifact")).toHaveCount(0);

  // Open resolves the row on demand and renders it. No URL was minted for any card until this click.
  await promotable.getByTestId("open-artifact").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a proved reel plays and an unproved one says why it cannot", async ({ page }) => {
  await page.goto(ROUTE);
  await page.locator('button[data-lane="reel"]').click();

  const proved = page.locator('[data-testid="artifact-card"]', { hasText: provedReelTitle });
  await expect(proved.getByTestId("play-reel")).toBeVisible();
  await proved.getByTestId("play-reel").click();
  // The src comes from `api.media.reel`, whose non-null url IS the validated-sidecar guarantee.
  await expect(proved.getByTestId("reel-player")).toHaveAttribute("src", /.+/);

  const unproved = page.locator('[data-testid="artifact-card"]', { hasText: unprovedReelTitle });
  await expect(unproved.getByTestId("play-reel")).toHaveCount(0);
  await expect(unproved).toContainText("being made again");
  // Unplayable is not unreachable — the canvas link still opens the conversation.
  await expect(unproved.getByTestId("open-canvas")).toHaveAttribute("href", /view=canvas/);
});

test("promotion explains that it is one-way, then moves the artifact into reference material", async ({
  page,
}) => {
  await page.goto(ROUTE);
  const card = page.locator('[data-testid="artifact-card"]', { hasText: PROMOTABLE });
  await expect(card.getByTestId("promote-artifact")).toBeVisible();

  await card.getByTestId("promote-artifact").click();
  const confirm = card.getByTestId("promote-confirm");
  await expect(confirm).toContainText("can no longer be rewritten in this conversation");
  await expect(confirm).toContainText("cannot be undone");

  await card.getByTestId("promote-confirm-button").click();

  // The transition is read from the ROW's own fields, never from the click: origin flips to
  // agent_promoted and the ingest workflow puts the row through `processing`.
  await expect(card).toContainText("Reference material", { timeout: 15_000 });
  await expect(card.getByTestId("promote-artifact")).toHaveCount(0);

  // AND WAIT FOR THE CONFIRM BLOCK TO GO, which is the only observable proof the whole chain ran.
  // `Reference material` appears the moment the reactive query sees the patched row — while the
  // caller-side audit call is still in flight. The first run of this spec asserted only that, the
  // test ended, Playwright tore the context down mid-mutation, and the audit row was never written:
  // the NEXT test then failed on an empty audit table for a promotion that had genuinely happened.
  // `setConfirmingId(null)` runs after `recordPromotion` resolves, so this is the sequencing point.
  await expect(confirm).toHaveCount(0, { timeout: 15_000 });
});

test("the promotion left a refs-only audit row and no second promotion surface", async () => {
  // `vault.promoteToReference` writes NO audit row by construction (ADR-025); the caller does, and
  // this proves the caller actually ran — the browser called `contentAudit.recordPromotion`.
  // `recentByType` drops `eventType` from its projection (the caller already knows it) and returns
  // `{ts, tenantId, correlationId, payload}` — so the evidence is the payload, not the label.
  const rows = convexRun("audit:recentByType", { eventType: "vault.promoted", limit: 5 });
  expect(rows, "no vault.promoted audit row was written").toContain(tenantId);
  expect(rows).toContain('"result": "processing"');
  expect(rows).toContain("vault:promote:");
  // §4: refs, ids and a closed enum only. The document's title must not be anywhere in the row.
  expect(rows).not.toContain(PROMOTABLE);
});
