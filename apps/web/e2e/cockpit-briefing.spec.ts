import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// CKPT-04 inbox briefing (SC-1 + SC-4) — the whole loop, OFFLINE: seeded fixture inbox →
// `SMOKE::agent::brief=today` → the governed briefInbox tool → the deterministic offline digest →
// a `briefings` row → the grouped, triaged BRIEFING card. ZERO model calls, ZERO Gmail traffic:
// the `inboxFixtures` seam (03.7-02) is checked BEFORE freshAccessToken, and its `offlineDigest`
// flag short-circuits the toolless digest (03.7-03), so nothing here touches the network or a key.
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). Like every cockpit spec it
// assumes the harness user has a Gmail token row (even a stale one): the workspace hides the
// composer behind `gmailAuth.status.connected`. The briefing itself needs no token — the fixture
// serves the mailbox — but the UI gate is upstream of the chat.
//
// Assertions ride the row-derived CARD (stable), never the agent's prose, except for the one
// counts-only reply assertion that is the loop-visible half of SC-2.

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// llm.ts SMOKE_NOW_MS (2020-01-01T12:00:00Z). The SMOKE path pins the agent's clock to it, so
// seeding the fixture at the same instant makes every today/yesterday/this-week bucket deterministic.
const SMOKE_NOW_MS = 1577880000000;

// Fixture facts (smoke.ts seedInboxFixture) — 3 today, 1 yesterday, 1 three days ago; the newest
// (Sarah Chen) is index 0 after the recency-first selection, and the offline digest pins index 0 to
// needsReply + a deadline, so a "Needs you" row always renders.
const NEEDS_YOU_SENDER = "Sarah Chen";
// Body-only needle from the injection fixture + the offline digest's gist prefix. Neither may ever
// appear in the chat reply: briefInbox returns COUNTS ONLY, so not even a gist reaches the loop.
const BODY_NEEDLE = "attacker@evil.example";
const GIST_NEEDLE = "Offline digest";

// Mirrors scripts/smokeRun.mjs: invoke the convex CLI through node (no shell) so Windows quoting
// can never mangle the JSON arg — the tenantId contains a `|`, which a cmd.exe shell would treat as
// a pipe. Success is decided by the CLI's OUTPUT, not its exit code (on Windows + Node 24 the CLI
// can crash during exit teardown and return a bogus non-zero code even when the function ran).
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
function convexRun(fn: string, args: Record<string, unknown>): string {
  const res = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (res.error) throw new Error(`spawn failed for ${fn}: ${res.error.message}`);
  const err = res.stderr ?? "";
  if (CLI_FAILURE.test(err)) throw new Error(`${fn} failed:\n${err.trim()}`);
  return res.stdout ?? "";
}

/**
 * The signed-in session's tenantId, read from the live page.
 *
 * `tenantId === identity.subject` (convex/lib/functions.ts requireTenant), and the subject is the
 * `sub` claim of the Convex Auth JWT that the client keeps in localStorage. Decoding it is the only
 * way to name the tenant `smoke:seedInboxFixture` must seed: the value is minted at sign-in, so it
 * cannot be known ahead of the run, and no product code should expose it just for a test.
 */
async function resolveTenantId(page: Page): Promise<string> {
  const jwt = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!jwt) throw new Error("No Convex Auth JWT in localStorage — is the storageState session still valid?");
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT (no payload segment).");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!claims.sub) throw new Error("Convex Auth JWT carries no `sub` claim — cannot resolve the tenant.");
  return claims.sub;
}

test("seeded inbox → SMOKE brief=today → grouped BRIEFING card (Needs-you is suggestions only)", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Seed the fixture mailbox for THIS session's tenant. Idempotent: seedInboxFixture deletes any
  // existing rows first, so re-runs never double the mailbox.
  const tenantId = await resolveTenantId(page);
  convexRun("smoke:seedInboxFixture", { tenantId, offlineDigest: true, baseMs: SMOKE_NOW_MS });

  // One message drives one governed tool call offline (the cockpit-attachment convention).
  await composer.fill("SMOKE::agent::brief=today");
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 20_000 });

  const workspace = page.getByTestId("workspace-pane");
  const card = workspace.getByTestId("briefing-card");
  await expect(card).toBeVisible({ timeout: 20_000 });

  // SC-1: the triage section first, then the pure-code time groups. The fixture's 5 messages bucket
  // 3/1/1 against the pinned clock, so all three sections render.
  const needsYou = card.getByTestId("briefing-needs-you");
  await expect(needsYou).toBeVisible();
  await expect(needsYou.getByTestId("briefing-item")).not.toHaveCount(0);
  await expect(needsYou).toContainText(NEEDS_YOU_SENDER);
  await expect(card.getByTestId("briefing-section-today")).toBeVisible();
  await expect(card.getByTestId("briefing-section-yesterday")).toBeVisible();
  await expect(card.getByTestId("briefing-section-thisweek")).toBeVisible();
  await expect(card.getByTestId("briefing-item")).not.toHaveCount(0);

  // SC-4: "Needs you" is INFORMATIONAL. Nothing in the card can act — no button, no link — so a
  // briefing-seeded action can only re-enter the conversation → PLAN → Approve gate.
  await expect(needsYou.locator("button")).toHaveCount(0);
  await expect(needsYou.locator("a")).toHaveCount(0);
  await expect(card.locator("button")).toHaveCount(0);
  await expect(card.locator("a")).toHaveCount(0);

  // SC-2, loop-visible half: the reply is the counts-only template. Neither a body needle nor a
  // gist reaches the model's context — the card is the only place the contents exist.
  const reply = page.getByTestId("chat-message").last();
  await expect(reply).toContainText("Briefing ready:");
  await expect(reply).not.toContainText(BODY_NEEDLE);
  await expect(reply).not.toContainText(GIST_NEEDLE);
});
