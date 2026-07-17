import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// CKPT-05 activity trace — the UI-visible half, OFFLINE: `SMOKE::agent::brief=today` → the
// driver's `thinking` row + the SMOKE call site's `briefInbox` row → `agentSteps.latestTurn` →
// the workspace LATEST TRACE card + the chat's Thought-Process bubble. ZERO model calls, ZERO
// Gmail traffic (the `inboxFixtures` seam, 03.7-02, is checked BEFORE freshAccessToken).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS SPEC PROVES — AND, MORE IMPORTANTLY, WHAT IT DOES NOT.
//
// PROVES: step rows reach the browser and render as words, on both surfaces, from one query;
// the card carries no mail content; the bubble collapses once a turn settles and the brain
// button expands it. It is ALSO the regression test for research Pitfall 4 — `runCockpitAgent`
// short-circuits `SMOKE::` sentinels straight into `invokeTool`, so `generateText` is never
// called and no SDK callback can fire. Every offline E2E in this repo drives that path. If the
// smoke-site emission (03.9-02) is ever removed, THIS spec goes red and nothing else does.
//
// DOES NOT PROVE — and this is the entire point of Phase 3.9: that steps appear PROGRESSIVELY,
// one by one, DURING a 10–30s wait. A SMOKE turn is instant and toolless-of-the-model: by the
// time the composer clears, the turn is already terminal, so this spec only ever sees a settled
// trace. "The wait stopped feeling broken" is a perceived-latency claim that no automated test
// in this repo can make. It belongs to 03.9-04 Task 2's human-verify (specifically the FIRST
// turn of a NEW thread, which no E2E can reach — `sendCockpitMessage` returns the threadId only
// after the loop finishes).
//
// The LOAD-BEARING automated proof that the emitter fires at all is
// `packages/backend/convex/runCockpitAgent.test.ts` (03.9-02): it drives a real `generateText`
// with a scripted mock model and asserts the rows exist. That matters because `ai@7`'s `notify`
// SWALLOWS callback exceptions (dist/index.js:2636-2639) — a broken emitter produces no error,
// no log, and no red test anywhere else. A green run of THIS spec is not the phase verified.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). Like every cockpit spec it
// assumes the harness user has a Gmail token row: the workspace hides the composer behind
// `gmailAuth.status.connected`. That gate — plus the absent E2E_USER_EMAIL/E2E_USER_PASSWORD —
// is why `cockpit-briefing.spec.ts` has never run (03.7-04 / 03.7-UAT "Still blocked"). Do not
// weaken the gate to make this pass; run it in a live human-verify session, which has a
// connected user by construction.

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// llm.ts SMOKE_NOW_MS (2020-01-01T12:00:00Z) — the SMOKE path pins the agent's clock to it, so
// seeding at the same instant makes the today/yesterday/this-week bucketing deterministic.
const SMOKE_NOW_MS = 1577880000000;

// The two rows a `brief=today` SMOKE turn leaves: cockpit.ts's driver-owned `thinking` row (so a
// turn that calls no tools still shows life) and the smoke call site's `briefInbox` row. Both are
// terminal by the time the composer clears, so both read as their DONE verb (cards.tsx VERB).
const THINKING_DONE = "Thought it through";
const BRIEF_DONE = "Briefed your inbox";
const STEP_COUNT = 2;

// §4, the UI-visible half. The step row has no field that can hold text (03.9-01's schema
// absence) and the verbs are a code-owned map — so none of these CAN reach the card. Asserting it
// anyway is what turns that argument into a regression test: `attacker@evil.example` is the
// injection fixture's body-only needle, "Sarah Chen" a sender, "Offline digest" a gist prefix.
// All three legitimately render in the BRIEFING card, so every needle assertion is scoped to the
// trace card alone — never to the pane.
const BODY_NEEDLE = "attacker@evil.example";
const SENDER_NEEDLE = "Sarah Chen";
const GIST_NEEDLE = "Offline digest";

// Mirrors scripts/smokeRun.mjs: invoke the convex CLI through node (no shell) so Windows quoting
// can never mangle the JSON arg — the tenantId contains a `|`, which a cmd.exe shell would treat
// as a pipe. Success is decided by the CLI's OUTPUT, not its exit code (on Windows + Node 24 the
// CLI can crash during exit teardown and return a bogus non-zero code even when the function ran).
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
 * The signed-in session's tenantId, read from the live page (the cockpit-briefing.spec.ts seam).
 *
 * `tenantId === identity.subject` (convex/lib/functions.ts requireTenant), and the subject is the
 * `sub` claim of the Convex Auth JWT the client keeps in localStorage. Decoding it is the only way
 * to name the tenant `smoke:seedInboxFixture` must seed: the value is minted at sign-in, so it
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

test("SMOKE brief=today → LATEST TRACE renders step rows on both surfaces, carrying no mail content", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("Describe your goal…");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Seed the fixture mailbox for THIS session's tenant so briefInbox completes offline and its
  // step row reaches `done` rather than `error`. Idempotent (seedInboxFixture deletes first).
  const tenantId = await resolveTenantId(page);
  convexRun("smoke:seedInboxFixture", { tenantId, offlineDigest: true, baseMs: SMOKE_NOW_MS });

  await composer.fill("SMOKE::agent::brief=today");
  await composer.press("Enter");
  await expect(composer).toHaveValue("", { timeout: 20_000 });

  // ── Surface 1: the workspace card (BRAND §3 tracked-caps label; §4 "content is cards") ──
  const workspace = page.getByTestId("workspace-pane");
  const card = workspace.getByTestId("activity-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Latest trace");

  // The rows reuse `.trace-line` (globals.css:1119) — already exactly the step-row look, no new CSS.
  const rows = card.locator(".trace-line");
  await expect(rows).toHaveCount(STEP_COUNT);
  // Real verbs from the code-owned map, in emission order: the driver's row, then the tool's.
  await expect(rows.nth(0)).toContainText(THINKING_DONE);
  await expect(rows.nth(1)).toContainText(BRIEF_DONE);
  // A11y: the trace is announced, not silent — a silent progress surface reproduces the original
  // "is it stuck?" complaint for non-sighted users (BRAND §6).
  await expect(card.locator("[aria-live='polite']")).toHaveCount(1);

  // ── §4: not one needle in the trace, though all three are on this very page in the briefing ──
  await expect(card).not.toContainText(BODY_NEEDLE);
  await expect(card).not.toContainText(SENDER_NEEDLE);
  await expect(card).not.toContainText(GIST_NEEDLE);

  // ── Surface 2: the chat bubble — the SAME query, so it cannot disagree with the card ──
  const bubble = page.getByTestId("agent-activity");
  await expect(bubble).toBeVisible();
  // The turn has SETTLED (no running step), so the bubble is collapsed to its summary — research
  // Open Question 2's recommended behavior, which 03.9-04's human-verify rules on. If a human
  // rejects the persist-collapsed taste call, this assertion is the one to change.
  await expect(bubble).toContainText(`Thought process · ${STEP_COUNT} steps`);
  await expect(bubble).not.toContainText(BODY_NEEDLE);

  // The brain button IS this feature (it used to say "coming soon"): it expands the collapsible
  // "Thought Process" trace — BRAND §5's specified affordance, verbatim.
  const brain = page.getByRole("button", { name: "Show the agent's thought process" });
  await expect(brain).toBeEnabled();
  await brain.click();
  await expect(bubble.locator(".trace-line")).toHaveCount(STEP_COUNT);
  await expect(bubble).toContainText(BRIEF_DONE);
});
