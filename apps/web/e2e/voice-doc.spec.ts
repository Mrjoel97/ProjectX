import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// DOCV-01 SC3 offline e2e — the DETERMINISTIC half of the voice-doc post-call surface, driven from a
// SEEDED ended session + persisted review (never a live mic/API — the phase-wide E2E convention).
// `smoke:seedVoiceDocSession` seeds a ready `vaultDocuments` report, an `ended_clean` `voiceSessions`
// row carrying `docRef`, and the `evaluations` row on the synthetic `voice-doc:<sessionId>` thread.
// Its two findings are asymmetric ON PURPOSE — the first carries a `citationExcerpt`, the second
// carries none — so the spec covers the quoted AND the quote-less render path (SC2's "shown" half).
//
// The live drill-in, the spoken "no gaps", and the real memo-vs-plan choice stay MANUAL (see
// 14-VALIDATION.md § Manual-Only Verifications) — a Realtime call needs a mic, a real key and audio.
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack (`convex
// dev` NOT --once + `next dev` :3111 — see e2e/README.md). Where the harness lacks E2E_USER_
// credentials / a Gmail-connected user, this is authored-and-documented per prior phases, not a red run.

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");

// Mirrors voice.spec/cockpit-briefing.spec: invoke the convex CLI through node (no shell) so Windows
// quoting can never mangle the JSON arg (the tenantId contains a `|`, a cmd.exe pipe). Success is
// decided by the CLI's OUTPUT, not its exit code (on Windows + Node 24 the CLI can crash during exit
// teardown).
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
 * — the only way to name the tenant `smoke:seedVoiceDocSession` must seed. (voice.spec precedent.)
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

// Wave 0 places the harness; plan 14-08 fills the body once PostCall + the card's excerpt render
// exist. Keep the helpers above — they are the agreed harness, do not invent a different one.
test.fixme(
  "SC3: seeded voice-doc review renders quoted + quote-less findings → choose an outcome → Approve gate, nothing sent",
  async ({ page }) => {
    await page.goto("/dashboard");
    const tenantId = await resolveTenantId(page);
    convexRun("smoke:seedVoiceDocSession", { tenantId });
    expect(tenantId).toBeTruthy();
  },
);
