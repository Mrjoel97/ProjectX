import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

// ACTN-02's offline browser proof. The provider snapshot is seeded into the SAME stageChange
// mutation the tool calls after inspection; no Google/Graph request and no approval runs here.
// Tool-level tests own the inspect action. This spec owns the user-observable handoff:
// bounded list identity → staged plan → exact current/proposed card → Approve still waiting.

type PlanId = string;
type ManagedEventId = string;
type Auth = { tenantId: string };

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

function convexRun<T>(fn: string, args: Record<string, unknown>): T {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  if (CLI_FAILURE.test(result.stderr ?? "")) {
    throw new Error(`${fn} failed:\n${result.stderr.trim()}\n${result.stdout.trim()}`);
  }
  return JSON.parse(result.stdout.trim()) as T;
}

async function authFor(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  const payload = token?.split(".")[1];
  if (!payload) throw new Error("Calendar E2E has no Convex Auth JWT in storageState.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  const tenantId = claims.sub?.split("|")[0];
  if (!tenantId) throw new Error("Convex Auth JWT carries no stable user id.");
  return { tenantId };
}

function seedPlan(tenantId: string): { planId: PlanId; threadId: string } {
  return convexRun("smoke:seedCockpitPlan", { tenant: tenantId });
}

function seedManaged(
  tenantId: string,
  planId: PlanId,
  title: string,
  startMs: number,
): ManagedEventId {
  return convexRun("calendarEvents:upsertManaged", {
    tenantId,
    sourcePlanId: planId,
    provider: "google",
    externalEventId: `offline-${planId}`,
    etag: '"seeded-fresh"',
    title,
    startMs,
    durationMs: 30 * 60_000,
    tz: "Africa/Dar_es_Salaam",
    attendeeFree: true,
  });
}

function seedTrace(tenantId: string, threadId: string, turnId: string) {
  for (const [index, tool] of [
    "listManagedCalendarEvents",
    "proposeCalendarChange",
  ].entries()) {
    const stepKey = `${turnId}:${index}`;
    convexRun("agentSteps:record", {
      tenantId,
      threadId,
      turnId,
      stepKey,
      tool,
      startedAt: Date.now() + index,
    });
    convexRun("agentSteps:finish", {
      tenantId,
      turnId,
      stepKey,
      phase: "done",
      durationMs: 5,
      endedAt: Date.now() + index + 5,
    });
  }
}

test("offline list → update/delete stage renders truthful management cards before Approve", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/dashboard/workspace");
  const { tenantId } = await authFor(page);
  convexRun("onboarding:__seedOnboardedTenant", { tenantId });

  const currentStart = Date.now() + 3 * 3_600_000;
  const update = seedPlan(tenantId);
  const updateEvent = seedManaged(tenantId, update.planId, "Quarterly review", currentStart);
  const listed = convexRun<{ events: Array<{ managedEventId: string; title: string }> }>(
    "calendarEvents:listManageable",
    { tenantId },
  );
  expect(listed.events).toContainEqual(
    expect.objectContaining({ managedEventId: updateEvent, title: "Quarterly review" }),
  );
  convexRun("calendarEvents:stageChange", {
    tenantId,
    planId: update.planId,
    managedEventId: updateEvent,
    operation: "update",
    storedEtag: '"seeded-fresh"',
    etag: '"seeded-fresh"',
    observed: {
      title: "Quarterly review",
      startMs: currentStart,
      durationMs: 30 * 60_000,
      attendeeCount: 0,
    },
    desired: { title: "Quarterly review — revised", durationMs: 45 * 60_000 },
  });
  seedTrace(tenantId, update.threadId, `calendar-update-${Date.now()}`);

  await page.goto(`/dashboard/workspace?thread=${encodeURIComponent(update.threadId)}`);
  const workspace = page.getByTestId("workspace-pane");
  const updateCard = workspace.getByTestId("calendar-manage-plan-card");
  await expect(updateCard).toBeVisible({ timeout: 20_000 });
  await expect(updateCard.getByTestId("calendar-manage-original")).toContainText(
    "Quarterly review",
  );
  const proposed = updateCard.getByTestId("calendar-manage-proposed");
  await expect(proposed).toContainText("Quarterly review — revised");
  await expect(proposed).toContainText("45 min");
  await expect(proposed).not.toContainText("Time:"); // unchanged fields are not repeated as changed
  await expect(updateCard).not.toContainText(/recipient|subject|email preview/i);
  await expect(updateCard.getByRole("button", { name: /Approve & update calendar/i })).toBeEnabled();
  const trace = workspace.getByTestId("activity-card");
  await expect(trace).toContainText("Found events I can change");
  await expect(trace).toContainText("Calendar change ready to approve");

  const updatePlan = convexRun<{ status: string; calendarRunId?: string } | null>("plans:getById", {
    planId: update.planId,
  });
  expect(updatePlan?.status).toBe("proposed");
  expect(updatePlan?.calendarRunId).toBeUndefined(); // no Approve, provider write, or retrier run

  const removal = seedPlan(tenantId);
  const removalEvent = seedManaged(
    tenantId,
    removal.planId,
    "Cancel the quiet event",
    currentStart + 86_400_000,
  );
  convexRun("calendarEvents:stageChange", {
    tenantId,
    planId: removal.planId,
    managedEventId: removalEvent,
    operation: "delete",
    storedEtag: '"seeded-fresh"',
    etag: '"seeded-fresh"',
    observed: {
      title: "Cancel the quiet event",
      startMs: currentStart + 86_400_000,
      durationMs: 30 * 60_000,
      attendeeCount: 0,
    },
  });
  seedTrace(tenantId, removal.threadId, `calendar-delete-${Date.now()}`);

  await page.goto(`/dashboard/workspace?thread=${encodeURIComponent(removal.threadId)}`);
  const deleteCard = page.getByTestId("workspace-pane").getByTestId("calendar-manage-plan-card");
  await expect(deleteCard).toContainText("Cancel the quiet event");
  await expect(deleteCard).toContainText(/remains on your Google Calendar/i);
  await expect(deleteCard).not.toContainText("PROPOSED CHANGES");
  const removeButton = deleteCard.getByRole("button", { name: /Approve & remove/i });
  await expect(removeButton).toBeEnabled();
  await expect(removeButton).toHaveAttribute("style", /danger-text/);
  await expect(deleteCard).not.toContainText(/recipient|subject|email preview/i);
});
