import { expect, test } from "@playwright/test";

// SCHD-01 deferred-send card flow (SC2/SC3/SC4) — the whole compose → PLAN card with a resolved send
// time + datetime picker → single Approve → ScheduledCard → Cancel → Canceled path end to end over
// the OFFLINE `SMOKE::agent::` grammar (mirrors cockpit-personalize/cockpit-attachment): the cockpit
// is the governed Executive Agent tool-loop and each message drives ONE governed tool call offline
// (no gateway). Deferred send RIDES the immediate spine — Approve SCHEDULES the SAME frozen fan-out
// via ctx.scheduler.runAt (nothing sends before fire); Cancel is a CAS-guarded, audited halt. The
// real future send firing at the requested moment / a real cancel halting it / a dead token at fire
// degrading to awaiting_reauth is the manual human-verify (SCHD-01, the sole live-only proof — fake
// timers cannot observe real inbox arrival).
//
// Runs signed-in (storageState from auth.setup.ts) against the ALREADY-RUNNING local stack
// (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md). The body op carries the
// `SMOKE::route=direct_llm::` sentinel so draftCockpit returns a deterministic offline draft (no AI
// key). The harness user has a stale Gmail token, so the immediate-default send settles at
// `awaiting_reauth` (the automatable terminal).
//
// The offline `SMOKE::agent::sendTime=` op pins its clock to SMOKE_NOW_MS (2020-01-01 12:00 UTC), so
// `in 2 hours` resolves to a 2020 absolute time — this PROVES the natural-language fast path resolves
// an absolute moment into the picker BEFORE Approve, but that instant is in the real past, so to
// actually reach the SCHEDULED state we set a real-future time through the PLAN-card datetime picker
// (setPlanSendTime has no NL past-guard — the picker IS the confirm source of truth). Assertions ride
// the plan-row-derived CARDS (stable), never the agent's reply prose (which varies).

const DATETIME_PICKER = 'input[type="datetime-local"]';

test("compose → sendTime resolves an absolute time → picker future time → Approve → Scheduled → Cancel → Canceled (nothing sent)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Each send clears the composer on success — waiting for empty sequences turns without asserting prose.
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };

  const workspace = page.getByTestId("workspace-pane");

  // Compose a single-recipient plan offline, then volunteer a natural-language send time.
  await say("SMOKE::agent::add=alice@example.com");
  await say("SMOKE::agent::subject=Q3 sync");
  await say("SMOKE::agent::body=SMOKE::route=direct_llm:: the quarterly numbers for the team");
  await say("SMOKE::agent::sendTime=in 2 hours");
  await say("SMOKE::agent::propose");

  // PLAN card: the SEND TIME section shows a RESOLVED ABSOLUTE time (the picker carries a concrete
  // value parsed from "in 2 hours") BEFORE the single Approve, and the Approve button reflects the
  // deferred send ("Approve & schedule", not a bare "Approve"). Nothing is sent yet.
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByText("SEND TIME", { exact: true })).toBeVisible();
  const picker = workspace.locator(DATETIME_PICKER);
  await expect(picker).not.toHaveValue(""); // the NL "in 2 hours" resolved to a concrete absolute time
  const scheduleBtn = page.getByRole("button", { name: /approve & schedule/i });
  await expect(scheduleBtn).toHaveCount(1);
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);

  // The SMOKE clock pins the resolved instant to 2020 (real past) — the picker is the confirm
  // source-of-truth, so set a real-FUTURE time to actually schedule (setPlanSendTime, no past-guard).
  await picker.fill("2035-06-01T10:00");
  await expect(picker).toHaveValue("2035-06-01T10:00");
  await expect(scheduleBtn).toHaveCount(1); // still a deferred send

  // ONE Approve → executePlan SCHEDULES the frozen fan-out via ctx.scheduler.runAt (status scheduled).
  await scheduleBtn.click();

  // ScheduledCard: "Scheduled for <abs>" + a Cancel control, NOT a REPORT — nothing sent before fire.
  await expect(workspace.getByText("SCHEDULED", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText(/Scheduled for/)).toBeVisible();
  const cancel = page.getByRole("button", { name: /^cancel$/i });
  await expect(cancel).toHaveCount(1);
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0);
  // The single-approve gate held: the PLAN card (with its Approve) unmounted.
  await expect(scheduleBtn).toHaveCount(0);

  // Cancel BEFORE fire → cancelScheduledPlan (CAS-guarded, refs-only audit) → CanceledCard, no send.
  await cancel.click();
  await expect(workspace.getByText("CANCELED", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText(/canceled/i)).toBeVisible();
  await expect(workspace.getByText("REPORT", { exact: true })).toHaveCount(0); // never sent
});

// SC1 — the immediate default is unchanged: no send time → Approve → live REPORT (mirrors
// cockpit-report.spec over the SMOKE agent grammar). The stale-token harness user settles the send at
// awaiting_reauth (the automatable terminal); a real send is the human-verify.
test("no send time → Approve → immediate REPORT (default unchanged)", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };

  const workspace = page.getByTestId("workspace-pane");

  await say("SMOKE::agent::add=alice@example.com");
  await say("SMOKE::agent::subject=Q3 sync");
  await say("SMOKE::agent::body=SMOKE::route=direct_llm:: the quarterly numbers for the team");
  await say("SMOKE::agent::propose");

  // No send time set → the PLAN card offers a bare "Approve" (immediate), NOT "Approve & schedule".
  await expect(workspace.getByText("PLAN", { exact: true })).toBeVisible({ timeout: 15_000 });
  const approve = page.getByRole("button", { name: /^approve$/i });
  await expect(approve).toHaveCount(1);
  await expect(page.getByRole("button", { name: /approve & schedule/i })).toHaveCount(0);

  // ONE Approve → immediate fan-out → live REPORT (no scheduling).
  await approve.click();
  await expect(workspace.getByText("REPORT", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByText("alice@example.com")).toBeVisible();
  await expect(approve).toHaveCount(0);
});
