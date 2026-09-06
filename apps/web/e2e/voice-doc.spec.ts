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

// ⚠ ROUTE CHOICE — THIS IS A TEST HARNESS, NOT A FEATURE, AND MUST NEVER BECOME ONE. ⚠
//
// This spec drives `/dashboard/workspace?thread=<synthetic voice-doc threadId>`, NOT the post-call
// screen. Why: the post-call screen only exists after a live in-memory session, which an offline
// spec cannot produce — but the workspace route renders **the same exported `CardList`** over the
// same seeded row, so the assertions cover the same component tree.
//
// NO NAVIGATION ENTRY POINT to this URL may ever be added anywhere in the product — no link, no
// redirect, no `router.push`. Two independent reasons:
//   1. "A workspace EVALUATION card for voice-doc findings (revisitable in chat)" is an explicitly
//      DEFERRED idea in 14-CONTEXT.md.
//   2. The synthetic id is not a Convex Agent thread, so a user who arrived here with a live
//      composer would hit Pitfall 7 — `sendCockpitMessage` would throw. Reads degrade gracefully;
//      a send does not. This spec therefore NEVER types into the composer.
test("SC3: seeded voice-doc review renders quoted + quote-less findings → gap → Approve gate, nothing sent", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const tenantId = await resolveTenantId(page);
  const out = convexRun("smoke:seedVoiceDocSession", { tenantId });
  const seeded = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { threadId?: string };
  expect(seeded.threadId, "seeder must return the synthetic threadId").toBeTruthy();

  await page.goto(`/dashboard/workspace?thread=${encodeURIComponent(seeded.threadId as string)}`);

  // SC2 — the findings are cited. The citation is welded in code, so its presence is the proof that
  // a persisted finding cannot exist without one.
  const citations = page.getByTestId("evaluation-citation");
  await expect(citations.first()).toBeVisible({ timeout: 15_000 });
  await expect(citations.first()).toContainText("Q3 Performance Report");

  // SC2's "shown" half — BOTH excerpt render paths, which is why the seeder's two findings are
  // deliberately asymmetric. Exactly one quote block for two findings: the finding that carries a
  // `citationExcerpt` shows it, and the one without renders with NO empty quote block.
  const excerpts = page.getByTestId("evaluation-excerpt");
  await expect(excerpts).toHaveCount(1);
  await expect(excerpts.first()).toContainText('"');
  expect(await citations.count()).toBeGreaterThan(1);

  // SC3 — the user chooses. Acting on a gap stages a plan.
  await page
    .getByRole("button", { name: /act on this/i })
    .first()
    .click();

  // …and it lands at the EXISTING single Approve gate. Nothing has been sent, and nothing can be
  // until a human presses this.
  await expect(page.getByRole("button", { name: /^approve/i })).toBeVisible({ timeout: 15_000 });

  // The negative half of SC3, and the one that matters most: no delivery surface appeared. A memo
  // plan must never reach the gmail fan-out, so there is no REPORT card and no send affordance.
  await expect(page.getByRole("button", { name: /^send\b/i })).toHaveCount(0);
  await expect(page.getByTestId("report-card")).toHaveCount(0);
});
