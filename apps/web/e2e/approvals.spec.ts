import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "@pikar/backend/api";
import { expect, type Page, test } from "@playwright/test";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";

// Connected APRV-01 browser evidence. Internal smoke mutations seed only plan rows for this
// authenticated tenant; every state transition below uses the shipped public mutation. A seeded
// done/delivering row proves UI composition only. This spec never claims Gmail, Calendar or media
// vendor success and never replaces the separate owner/live-provider evidence boundary.

type Auth = { token: string; url: string };
type PlanId = NonNullable<FunctionReturnType<typeof api.plans.byThread>>["_id"];

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;
const defaultAppOrigin = "http://127.0.0.1:3111";
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? defaultAppOrigin;

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
    // libuv closing-handle assertion. The JSON result is the operation evidence; a missing/invalid
    // result still fails below, so this does not turn a real Convex error green.
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

async function authFor(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";
  if (!token) throw new Error("Approvals E2E has no Convex Auth JWT in storageState.");
  return { token, url };
}

function seedPlan(
  tenant: string,
  patch: Record<string, unknown>,
): { planId: PlanId; threadId: string } {
  const seeded = convexRun<{ planId: PlanId; threadId: string }>("smoke:seedCockpitPlan", {
    tenant,
  });
  convexRun<null>("plans:patchPlan", { planId: seeded.planId, ...patch });
  return seeded;
}

function localInput(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("connected approvals: four kinds, schedule/cancel/discard/idempotency and scheduler races", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Local shared-tree debugging may already have Next on :3000 while the canonical harness owns
  // :3111. `--no-deps` can reuse the saved state on that alternate origin without printing or
  // persisting a copied token; the normal setup-dependent command stays on :3111 unchanged.
  if (appOrigin !== defaultAppOrigin) {
    const state = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), ".auth/user.json"), "utf8"),
    ) as { origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
    const entries = state.origins?.find((origin) => origin.origin === defaultAppOrigin)?.localStorage;
    if (!entries) throw new Error("Saved Approvals auth state has no canonical localStorage origin.");
    await page.addInitScript((seed) => {
      for (const entry of seed) window.localStorage.setItem(entry.name, entry.value);
    }, entries);
  }
  await page.goto(`${appOrigin}/dashboard/approvals`);
  const auth = await authFor(page);
  const tenant = tenantIdFrom(auth.token);
  convexRun("onboarding:__seedOnboardedTenant", { tenantId: tenant });

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const email = seedPlan(tenant, {
    status: "proposed",
    recipients: [`approvals-${suffix}@example.com`],
    mode: "individual",
    subject: `Approvals schedule ${suffix}`,
    body: "Seeded email body for connected UI evidence only.",
  });
  const race = seedPlan(tenant, {
    status: "proposed",
    recipients: [`race-${suffix}@example.com`],
    mode: "individual",
    subject: `Scheduler race ${suffix}`,
    body: "Seeded race plan. No provider success is claimed.",
  });
  const discard = seedPlan(tenant, {
    status: "proposed",
    recipients: [`discard-${suffix}@example.com`],
    mode: "individual",
    subject: `Discard ${suffix}`,
    body: "Seeded discard plan.",
  });
  const memo = seedPlan(tenant, {
    status: "proposed",
    kind: "memo",
    body: `Close the evidence gap ${suffix}\nSeeded memo content.`,
  });
  const calendar = seedPlan(tenant, {
    status: "proposed",
    kind: "calendar_event",
    eventTitle: `Discovery call ${suffix}`,
    eventStartMs: Date.now() + 2 * 60 * 60 * 1000,
    eventDurationMs: 45 * 60 * 1000,
    eventTz: "Africa/Dar_es_Salaam",
  });
  const media = seedPlan(tenant, {
    status: "proposed",
    kind: "media",
    body: `Seeded media plan ${suffix}`,
  });
  seedPlan(tenant, {
    status: "delivering",
    recipients: [`legacy-${suffix}@example.com`],
    subject: `Legacy progress ${suffix}`,
  });
  seedPlan(tenant, { status: "done", subject: `Seeded done ${suffix}` });
  seedPlan(tenant, { status: "canceled", subject: `Seeded legacy cancel ${suffix}` });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Clear the gate" })).toBeVisible({ timeout: 20_000 });

  // Rollout gate: direct route is reachable while the rail remains a real disabled/Soon entry.
  const approvalsNav = page.locator(".rail-item.is-soon", { hasText: "Approvals" });
  await expect(approvalsNav).toHaveAttribute("aria-disabled", "true");
  await expect(approvalsNav).toContainText("Soon");

  const awaiting = page.getByRole("region", { name: /Awaiting you/i });
  for (const kind of ["Email", "Reel", "Calendar event", "Next-step memo"]) {
    await expect(awaiting.getByText(kind, { exact: true }).first()).toBeVisible();
  }
  await expect(awaiting.getByRole("link", { name: /Open in cockpit/i }).first()).toHaveAttribute(
    "href",
    /\/dashboard\/workspace\?thread=/,
  );
  await expect(page.getByRole("link", { name: /Review in Compliance/i })).toHaveAttribute(
    "href",
    "/ops",
  );
  await expect(page.getByText(/Exact counters are unavailable for this legacy plan/i)).toBeVisible();

  // Initial scheduling requires a separate absolute-time review. Past input refuses before any
  // mutation; a valid local input names the browser IANA zone before setPlanSendTime + executePlan.
  const emailCard = page.locator(`[data-plan-id="${email.planId}"]`);
  await emailCard.getByRole("button", { name: "Schedule…" }).click();
  const picker = emailCard.getByLabel("Local date and time");
  await picker.fill("2020-01-01T10:00");
  await emailCard.getByRole("button", { name: "Review absolute time" }).click();
  await expect(emailCard.getByRole("alert")).toContainText("future time");

  const scheduledAt = Date.now() + 90 * 60 * 1000;
  await picker.fill(localInput(scheduledAt));
  await emailCard.getByRole("button", { name: "Review absolute time" }).click();
  const confirmation = emailCard.getByRole("group", { name: "Confirm absolute schedule" });
  await expect(confirmation).toContainText(/\([A-Za-z_]+\/[A-Za-z_]+\)|\(UTC\)/);
  await confirmation.getByRole("button", { name: "Confirm schedule" }).click();

  await expect
    .poll(
      async () => {
        const result = await fetchQuery(
          api.approvals.listScheduled,
          { paginationOpts: { numItems: 50, cursor: null } },
          auth,
        );
        return result.items.find((item) => item.planId === email.planId) ?? null;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();

  const scheduled = await fetchQuery(
    api.approvals.listScheduled,
    { paginationOpts: { numItems: 50, cursor: null } },
    auth,
  );
  const scheduledEmail = scheduled.items.find((item) => item.planId === email.planId);
  if (!scheduledEmail?.scheduledAt) throw new Error("Scheduled email has no absolute sendAt.");
  expect(
    await fetchMutation(
      api.cockpit.moveScheduledPlan,
      { planId: email.planId, sendAt: scheduledEmail.scheduledAt },
      auth,
    ),
  ).toEqual({ result: "moved" });

  const scheduledCard = page.locator(`[data-plan-id="${email.planId}"]`);
  await expect(scheduledCard.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 15_000 });
  const beforeCancel = await fetchQuery(api.plans.reportForPlan, { planId: email.planId }, auth);
  await scheduledCard.getByRole("button", { name: "Cancel" }).click();
  await scheduledCard.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect
    .poll(async () => (await fetchQuery(api.plans.byThread, { threadId: email.threadId }, auth))?.status)
    .toBe("canceled");
  expect(await fetchMutation(api.cockpit.cancelScheduledPlan, { planId: email.planId }, auth)).toEqual({
    ok: true,
    alreadyResolved: true,
  });
  expect(await fetchMutation(api.cockpit.executePlan, { planId: email.planId }, auth)).toEqual({
    ok: true,
    alreadyStarted: true,
  });
  const afterCancel = await fetchQuery(api.plans.reportForPlan, { planId: email.planId }, auth);
  expect(afterCancel).toHaveLength(beforeCancel.length);

  // Lost scheduler race: drive a second plan through the real schedule mutation, then use the
  // existing internal status setter to model the callback's serialized win without any provider.
  const raceAt = Date.now() + 2 * 60 * 60 * 1000;
  await fetchMutation(api.plans.setPlanSendTime, { planId: race.planId, sendAt: raceAt }, auth);
  const armed = await fetchMutation(api.cockpit.executePlan, { planId: race.planId }, auth);
  expect(armed).toMatchObject({ ok: true, scheduled: true });
  convexRun("plans:setPlanStatus", { planId: race.planId, status: "delivering" });
  expect(await fetchMutation(api.cockpit.cancelScheduledPlan, { planId: race.planId }, auth)).toEqual({
    ok: true,
    alreadyResolved: true,
  });
  expect(
    await fetchMutation(
      api.cockpit.moveScheduledPlan,
      { planId: race.planId, sendAt: raceAt + 30 * 60 * 1000 },
      auth,
    ),
  ).toEqual({ result: "already_fired" });
  await expect(page.locator(`[data-plan-id="${race.planId}"]`)).toContainText(/in flight|exact counters/i, {
    timeout: 15_000,
  });

  // Destructive discard is permanent; reschedule replay cannot re-arm it.
  const discardCard = page.locator(`[data-plan-id="${discard.planId}"]`);
  await discardCard.getByRole("button", { name: "Discard" }).click();
  await discardCard.getByRole("button", { name: "Yes, discard it" }).click();
  await expect
    .poll(async () => (await fetchQuery(api.plans.byThread, { threadId: discard.threadId }, auth))?.status)
    .toBe("canceled");
  expect(await fetchMutation(api.cockpit.reschedulePlan, { planId: discard.planId }, auth)).toEqual({
    ok: true,
    alreadyResolved: true,
  });

  // Memo gives a provider-free double-approve proof: exactly one inline vault terminal, second is
  // the server CAS no-op. Calendar/media remain rendered, and media reaches the no-deck refusal.
  const firstMemo = await fetchMutation(api.cockpit.executePlan, { planId: memo.planId }, auth);
  const secondMemo = await fetchMutation(api.cockpit.executePlan, { planId: memo.planId }, auth);
  expect(firstMemo).toEqual({ ok: true });
  expect(secondMemo).toEqual({ ok: true, alreadyStarted: true });

  const mediaCard = page.locator(`[data-plan-id="${media.planId}"]`);
  await mediaCard.getByRole("button", { name: "Approve governed generation" }).click();
  await expect(mediaCard.getByRole("status")).toContainText(/no generation-ready deck|Nothing was generated/i);
  await expect(page.locator(`[data-plan-id="${calendar.planId}"]`).getByRole("link", { name: "Change time in cockpit" })).toBeVisible();
});
