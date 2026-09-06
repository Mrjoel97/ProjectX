import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// VOIC-03/04 offline e2e — the DETERMINISTIC, VOICE-OWNED half of the post-call surface, driven from
// a SEEDED stored brief (never a live mic/API — the phase-wide E2E convention). A voice session that
// dropped on a closed tab is auto-stored by the server watchdog with no review; on the next app open
// AbnormalBriefBanner surfaces it, and "Turn into a plan" routes it through the SAME cockpit
// sendCockpitMessage → PLAN/Approve pipeline every other plan crosses (no new pipeline, no new gate).
//
// Seeded via `smoke:seedVoiceBrief` (a stored vaultDocuments brief, source:voice) — the constraint's
// "seed the stored brief and drive from there". The offline half proves: the dropped brief surfaces,
// the handoff seeds a cockpit thread and NAVIGATES to it, and NOTHING sends (no REPORT). The full PLAN
// card + the real Approve→governed-send is the plan-08 human-verify (VALIDATION manual-only rows): the
// offline agent grammar fills a plan across multiple SMOKE:: composer turns, not one handoff message.
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack (`convex
// dev` NOT --once + `next dev` :3111 — see e2e/README.md). Like every cockpit spec it assumes the
// harness user has a Gmail token row (the workspace pane is gated behind gmailAuth.status.connected).
// Where the harness lacks E2E_USER_ credentials / a Gmail-connected user, this is authored-and-
// documented per prior phases, not a red run.

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// Mirrors cockpit-briefing.spec: invoke the convex CLI through node (no shell) so Windows quoting can
// never mangle the JSON arg (the tenantId contains a `|`, a cmd.exe pipe). Success is decided by the
// CLI's OUTPUT, not its exit code (on Windows + Node 24 the CLI can crash during exit teardown).
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
 * The signed-in session's tenantId, read from the Convex Auth JWT in localStorage (tenantId ===
 * identity.subject === the JWT `sub` claim). Minted at sign-in, so it can't be known ahead of the run
 * — the only way to name the tenant `smoke:seedVoiceBrief` must seed. (cockpit-briefing.spec precedent.)
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

test("dropped-session brief surfaces on next open → 'Turn into a plan' reaches the cockpit gate, nothing sent", async ({
  page,
}) => {
  // A fresh context has an empty seen-set (localStorage), so the seeded brief is treated as unreviewed.
  await page.goto("/dashboard");

  // Seed the stored voice brief for THIS session's tenant (idempotent — drops any prior voice brief).
  const tenantId = await resolveTenantId(page);
  convexRun("smoke:seedVoiceBrief", { tenantId });

  // Reload so the banner's listVaultDocs query picks up the seeded brief.
  await page.reload();

  // The dropped-session banner surfaces the auto-stored brief (VOIC-03 dropped-session half).
  const banner = page.getByRole("region", { name: /voice brief ready to review/i });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText(/interrupted voice session/i);
  await expect(banner.getByRole("link", { name: /review in vault/i })).toBeVisible();
  const turnIntoPlan = banner.getByRole("button", { name: /turn into a plan/i });
  await expect(turnIntoPlan).toBeVisible();

  // VOIC-04: the handoff seeds a cockpit thread (the brief's Decisions + Action items) and lands the
  // user at the existing workspace — the SAME sendCockpitMessage → PLAN/Approve pipeline, no new gate.
  await turnIntoPlan.click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\?thread=/, { timeout: 20_000 });

  // The workspace opened on the handoff's thread (Live work canvas — a threadId is active).
  const workspace = page.getByTestId("workspace-pane");
  await expect(workspace).toBeVisible({ timeout: 15_000 });

  // Zero-sends-before-Approve: the handoff proposes at most a plan — it NEVER sends. No REPORT card
  // exists on the freshly-opened thread (a REPORT only renders after the single Approve fan-out).
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);
});
