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
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). Cockpit access does not depend
// on a Gmail token. The offline fixture serves this email-dependent briefing capability before the
// provider-token boundary, so the test remains zero-network and does not need a real mailbox.
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
// needsReply + a deadline (category "action"), so a "Needs you" row always renders. The offline
// digest also flags exactly ONE non-needs-you item (index 1) `newsletter`, so collapseNoise folds
// one row into the "1 automated notification" line — Gap 1.3 is an OFFLINE regression lock now.
const NEEDS_YOU_SENDER = "Sarah Chen";
// The offline digest's deterministic synopsis (llm.ts smoke branch). composeLede welds it onto the
// CODE-OWNED counts → a "5 messages, 1 need you — Offline briefing synopsis." lede.
const LEDE_SYNOPSIS = "Offline briefing synopsis.";
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
  if (!jwt)
    throw new Error(
      "No Convex Auth JWT in localStorage — is the storageState session still valid?",
    );
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT (no payload segment).");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!claims.sub)
    throw new Error("Convex Auth JWT carries no `sub` claim — cannot resolve the tenant.");
  // The tenant id is the subject BEFORE the '|' (requireTenant, 2026-07-21): the full `sub` carries a
  // per-session suffix, and a fixture seeded under it is a row no backend read ever finds.
  return claims.sub.split("|")[0] ?? claims.sub;
}

test("seeded inbox → SMOKE brief=today → grouped BRIEFING card (Needs-you is suggestions only)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Seed the fixture mailbox for THIS session's tenant. Idempotent: seedInboxFixture deletes any
  // existing rows first, so re-runs never double the mailbox.
  const tenantId = await resolveTenantId(page);
  convexRun("smoke:seedInboxFixture", { tenantId, offlineDigest: true, baseMs: SMOKE_NOW_MS });

  // One message drives one governed tool call offline (the cockpit-attachment convention).
  await composer.fill("SMOKE::agent::brief=today");
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 20_000 });
  // The composer clears the moment a turn is SENT (03.9-04), not when it settles, and a second
  // Enter while the turn is still busy is dropped by onSend — so wait for the "Working…" state to end.
  await expect(page.getByRole("button", { name: "Working…" })).toHaveCount(0, { timeout: 90_000 });

  const workspace = page.getByTestId("workspace-pane");
  const card = workspace.getByTestId("briefing-card");
  await expect(card).toBeVisible({ timeout: 20_000 });

  // Gap 1.1 — LEDE FIRST: the story of the inbox leads. composeLede welds the CODE-OWNED counts
  // ("N messages, M need you") onto the model's synopsis clause. Assert it is present, non-empty,
  // and precedes the first briefing row in DOM order (lede-first, not a receipt).
  const lede = card.getByTestId("briefing-lede");
  await expect(lede).toBeVisible();
  await expect(lede).toContainText("need you"); // the code-owned count clause
  await expect(lede).toContainText(LEDE_SYNOPSIS); // the model's qualitative clause, folded in
  await expect(
    card.locator('[data-testid="briefing-lede"], [data-testid="briefing-item"]').first(),
  ).toHaveAttribute("data-testid", "briefing-lede");

  // SC-1: the triage section first, then the pure-code time groups. The fixture's 5 messages bucket
  // 3/1/1 against the pinned clock; index 1 collapses as newsletter, so all three sections still render.
  const needsYou = card.getByTestId("briefing-needs-you");
  await expect(needsYou).toBeVisible();
  await expect(needsYou.getByTestId("briefing-item")).not.toHaveCount(0);
  await expect(needsYou).toContainText(NEEDS_YOU_SENDER);
  await expect(card.getByTestId("briefing-section-today")).toBeVisible();
  await expect(card.getByTestId("briefing-section-yesterday")).toBeVisible();
  await expect(card.getByTestId("briefing-section-thisweek")).toBeVisible();
  await expect(card.getByTestId("briefing-item")).not.toHaveCount(0);

  // Gap 1.2 — ACTION-FIRST: the needs-you row (Sarah Chen) sits ABOVE the time-grouped fyi rows,
  // never interleaved chronologically. The FIRST briefing row in the whole card is the needs-you row.
  await expect(card.getByTestId("briefing-item").first()).toContainText(NEEDS_YOU_SENDER);

  // Gap 1.4 — CATEGORY VISIBLE: the axis the model computes is finally shown as a per-row text tag.
  // The needs-you (index 0) row is category "action" (CSS uppercases it; textContent stays lower).
  await expect(card.getByTestId("briefing-category")).not.toHaveCount(0);
  await expect(needsYou.getByTestId("briefing-category").first()).toHaveText(/action/i);

  // Gap 2 (Direction A × C) — RECOMMENDED MOVE: every needs-you row carries its code-derived next
  // move, the bridge back to chat → PLAN → Approve. Present, non-empty, and (fixture index 0 has a
  // deadline) the time-sensitive variant. It is TEXT — the SC-4 zero-button/link assertions below
  // already prove it is not a control.
  const move = needsYou.getByTestId("briefing-move").first();
  await expect(move).toBeVisible();
  await expect(move).toContainText("Recommended");
  await expect(move).toContainText(/ask me to draft a reply/i);

  // Gap 1.3 — NOISE COLLAPSED: the one newsletter item renders as ONE count line, not a row. The
  // offline digest guarantees ≥1 newsletter, so the collapsed line is present WITH its count (no
  // absent-branch escape hatch — this is an offline regression lock, not a human-only check).
  const collapsed = card.getByTestId("briefing-collapsed");
  await expect(collapsed).toBeVisible();
  await expect(collapsed).toContainText("1");
  await expect(collapsed).toContainText(/automated notification/i);

  // SC-4: "Needs you" is INFORMATIONAL. Nothing in the card can act — no button, no link — so a
  // briefing-seeded action can only re-enter the conversation → PLAN → Approve gate.
  await expect(needsYou.locator("button")).toHaveCount(0);
  await expect(needsYou.locator("a")).toHaveCount(0);
  // SC-4 holds on the CONTENT region: the masthead carries a collapse toggle (view chrome, the
  // 03.10-04 exception) — the same rescope `cockpit-resolve.spec.ts` already made.
  const body = card.getByTestId("briefing-body");
  await expect(body.locator("button")).toHaveCount(0);
  await expect(body.locator("a")).toHaveCount(0);

  // SC-2, loop-visible half: the reply is the counts-only template. Neither a body needle nor a
  // gist reaches the model's context — the card is the only place the contents exist.
  const reply = page.getByTestId("chat-message").last();
  await expect(reply).toContainText("Briefing ready:");
  await expect(reply).not.toContainText(BODY_NEEDLE);
  await expect(reply).not.toContainText(GIST_NEEDLE);
});
