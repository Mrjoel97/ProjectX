import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// Phase 17.1 Task 4 — the deterministic half of the Blueprint founder review. This spec runs
// signed-in against the already-running LOCAL stack and calls internal read/fixture seams through
// the Convex CLI. It makes no model, embedding, Realtime, mailbox, or provider call.
//
// What it proves:
//   1. the exact confirmed spine enters a no-tool cockpit prompt without mutating the baseline;
//   2. a contradiction starts OFF, discard preserves the founder-authored target customer, and an
//      explicit checked confirmation changes the Blueprint while leaving the typed profile intact;
//   3. the accepted spine enters the exact voice instruction assembler used before Realtime mint.
//
// What stays human-only: whether the model's answer is good grounding, and whether a live spoken
// response sounds faithful. Those qualitative founder judgments happen only after the conclusive
// L6 candidate exists; this spec never manufactures owner acceptance.

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

const TYPED_TARGET = "Independent city bicycle couriers";
const DERIVED_TARGET = "Regional fleet operators";
const BROWSER_EVIDENCE_DIR = process.env.PIKAR_E2E_BROWSER_EVIDENCE_DIR;

async function captureResponsiveEvidence(page: Page) {
  if (!BROWSER_EVIDENCE_DIR) return;
  mkdirSync(BROWSER_EVIDENCE_DIR, { recursive: true });
  for (const viewport of [
    { name: "desktop", width: 1280, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(page.getByText(DERIVED_TARGET, { exact: true }).first()).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth),
      `Blueprint page overflows at ${viewport.width}px`,
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: resolve(BROWSER_EVIDENCE_DIR, `blueprint-${viewport.name}.png`),
      fullPage: true,
    });
  }
  // The assertions below continue through profile tabs; restore a desktop viewport after the
  // mobile witness so that evidence capture cannot itself change the interaction being tested.
  await page.setViewportSize({ width: 1280, height: 1000 });
}

function convexRun(fn: string, args: Record<string, unknown>): string {
  const res = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (res.error) throw new Error(`spawn failed for ${fn}: ${res.error.message}`);
  const stderr = res.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) throw new Error(`${fn} failed:\n${stderr.trim()}`);
  const stdout = res.stdout ?? "";
  if (!stdout.trim()) throw new Error(`${fn} returned no stdout.`);
  return stdout;
}

function convexJson<T>(fn: string, args: Record<string, unknown>): T {
  const line = convexRun(fn, args).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error(`${fn} returned no JSON line.`);
  return JSON.parse(line) as T;
}

async function resolveTenantId(page: Page): Promise<string> {
  const jwt = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((name) => name.startsWith("__convexAuthJWT"));
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!jwt) throw new Error("No Convex Auth JWT — is the Playwright storage state current?");
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT (no payload segment). ");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!claims.sub) throw new Error("Convex Auth JWT carries no `sub` claim.");
  return claims.sub.split("|")[0] ?? claims.sub;
}

test("confirmed Blueprint stays stable until an explicit contradiction choice, then feeds cockpit and voice", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const tenantId = await resolveTenantId(page);

  // The initial state has a confirmed, founder-authored target plus a pending contradictory draft.
  // The internal fixture is idempotent and writes only the local authenticated tenant.
  const seeded = convexJson<{
    typedTargetCustomer: string;
    derivedTargetCustomer: string;
  }>("smoke:seedBlueprintActiveSpineFixture", { tenantId, withDraft: true });
  expect(seeded.typedTargetCustomer).toBe(TYPED_TARGET);
  expect(seeded.derivedTargetCustomer).toBe(DERIVED_TARGET);

  await page.goto("/dashboard/profile?tab=profile&section=blueprint");
  await expect(page.getByRole("heading", { name: "Review what changed" })).toBeVisible({
    timeout: 15_000,
  });
  const contradiction = page.locator('input[name="contradiction-targetCustomer"]');
  await expect(contradiction).toBeVisible();
  await expect(contradiction).not.toBeChecked();
  await expect(page.getByText(TYPED_TARGET, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(DERIVED_TARGET, { exact: true }).first()).toBeVisible();

  // Declining is a real discard, not an unchecked confirmation. The prior live Blueprint returns.
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByRole("heading", { name: "Review what changed" })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByText(TYPED_TARGET, { exact: true }).first()).toBeVisible();

  // `__cockpitTurnPrompt` is the production prompt assembler stopped immediately before the model.
  // It represents a no-tool question and is read-only, so an exact before/after spine comparison
  // proves prompt construction cannot rewrite the accepted baseline.
  const spineBefore = convexJson<string>("blueprint:spineForTenant", { tenantId });
  const plan = convexJson<{ planId: string }>("smoke:seedCockpitPlan", { tenant: tenantId });
  const prompt = convexJson<string>("llm:__cockpitTurnPrompt", {
    tenantId,
    planId: plan.planId,
    text: "What should I prioritize in the business this week?",
  });
  expect(prompt).toContain("<business_blueprint>");
  expect(prompt).toContain(TYPED_TARGET);
  expect(prompt).toContain("The user says: What should I prioritize in the business this week?");
  expect(convexJson<string>("blueprint:spineForTenant", { tenantId })).toBe(spineBefore);

  // Re-present the same proposal. Replacement happens only after the destructive row is checked.
  convexJson("smoke:seedBlueprintActiveSpineFixture", { tenantId, withDraft: true });
  await page.reload();
  await expect(contradiction).toBeVisible({ timeout: 15_000 });
  await contradiction.check();
  await page.getByRole("button", { name: "Accept and confirm" }).click();
  await expect(page.getByText(DERIVED_TARGET, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  await captureResponsiveEvidence(page);

  // Confirmation replaces the Blueprint value only. The typed profile remains byte-faithful.
  await page.getByRole("tab", { name: "What the business is" }).click();
  await expect(page.getByLabel("Target customer (optional)")).toHaveValue(TYPED_TARGET);

  const acceptedSpine = convexJson<string>("blueprint:spineForTenant", { tenantId });
  expect(acceptedSpine).toContain(DERIVED_TARGET);
  expect(acceptedSpine).not.toContain(TYPED_TARGET);

  // This invokes the SAME instruction helper as `mintClientSecret`, but stops before key access or
  // fetch. It proves accepted standing context reaches voice guidance without opening a session.
  const voiceInstructions = convexJson<string>("voiceToken:__voiceInstructionsForTest", {
    tenantId,
  });
  expect(voiceInstructions).toContain(acceptedSpine);
  expect(voiceInstructions).toContain(DERIVED_TARGET);
  expect(voiceInstructions).not.toContain(TYPED_TARGET);
});
