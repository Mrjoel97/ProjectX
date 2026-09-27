import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { internal } from "@pikar/backend/api";
import { expect, type Page, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

// ACTN-02's offline browser proof. The provider snapshot is seeded into the SAME stageChange
// mutation the tool calls after inspection; no Google/Graph request and no approval runs here.
// Tool-level tests own the inspect action. This spec owns the user-observable handoff:
// bounded list identity → staged plan → exact current/proposed card → Approve still waiting.

type PlanId = string;
type ManagedEventId = string;
type Auth = { tenantId: string };
type Identity = Auth & { email: string; password: string };
const privateRefs = internal as unknown as {
  invites: Record<string, unknown>;
  owner: Record<string, unknown>;
  onboarding: Record<string, unknown>;
};
const call = async <T>(client: ConvexHttpClient, ref: unknown, args: unknown, query = false) =>
  (query
    ? client.query(ref as FunctionReference<"query">, args as never)
    : client.mutation(ref as FunctionReference<"mutation">, args as never)) as Promise<T>;

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

function convexRun<T>(fn: string, args: Record<string, unknown>, allowEmpty = false): T {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0 || CLI_FAILURE.test(result.stderr ?? ""))
    throw new Error(`Calendar fixture call failed: ${fn}`);
  if (allowEmpty && !result.stdout.trim()) return undefined as T;
  try {
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    const shape = result.stdout.trim() ? "nonjson" : "empty";
    throw new Error(`Calendar fixture call returned invalid JSON: ${fn} (${shape})`);
  }
}

function disposableAdmin(): ConvexHttpClient {
  if (
    process.env.PIKAR_PHASE17_DISPOSABLE !== "1" ||
    process.env.PIKAR_PHASE49_DISPOSABLE !== "1" ||
    process.env.PIKAR_PHASE49_QUALIFICATION !== "1"
  )
    throw new Error("Calendar disposable mode needs the owned local runner");
  const root = process.env.PIKAR_PHASE49_DISPOSABLE_ROOT;
  const configPath = process.env.PIKAR_PHASE49_FIXTURE_CONFIG;
  if (!root || !configPath || !isAbsolute(root) || !isAbsolute(configPath))
    throw new Error("Calendar disposable root/config missing");
  const rel = relative(resolve(root), resolve(configPath));
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Calendar disposable config escaped its owned root");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    adminKey: string;
    ports: { cloud: number; site: number };
  };
  const origin = (value: string) => {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Calendar fixture origin is not exact loopback HTTP");
    return url;
  };
  const backend = origin(process.env.PIKAR_PHASE49_BACKEND_URL ?? "");
  const app = origin(process.env.PIKAR_E2E_BASE_URL ?? "");
  const site = origin(`http://127.0.0.1:${config.ports.site}`);
  if (
    backend.port !== String(config.ports.cloud) ||
    process.env.CONVEX_SELF_HOSTED_URL !== backend.origin ||
    !config.adminKey ||
    process.env.CONVEX_SELF_HOSTED_ADMIN_KEY !== config.adminKey ||
    new Set([backend.origin, app.origin, site.origin]).size !== 3
  )
    throw new Error("Calendar fixture backend/admin/app binding mismatch");
  const client = new ConvexHttpClient(backend.origin);
  (client as ConvexHttpClient & { setAdminAuth(key: string): void }).setAdminAuth(config.adminKey);
  return client;
}

async function disposableIdentity(page: Page): Promise<Identity> {
  const admin = disposableAdmin();
  const email = `phase17-calendar-${randomUUID()}@example.test`;
  const password = `Pikar-${randomUUID()}-test`;
  const invite = await call<{ code: string }>(admin, privateRefs.invites.__seedInvite, { email });
  if (!/^[A-Z0-9-]+$/.test(invite.code)) throw new Error("Calendar invite shape invalid");
  await page.goto(`/signup?invite=${invite.code}`);
  await page.getByPlaceholder("John Doe").fill("Calendar Test Tenant");
  await page.getByPlaceholder("name@company.com").fill(email);
  await page.getByPlaceholder("Create a password").fill(password);
  await page.getByPlaceholder("Confirm password").fill(password);
  await page.getByRole("button", { name: /Create Account/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/signup"), { timeout: 30_000 });
  const found = await call<{ result: { userId: string } | null }>(
    admin,
    privateRefs.owner.findUserIdByEmailForProvisioning,
    { email },
    true,
  );
  if (!found.result?.userId) throw new Error("Calendar disposable subject missing");
  const browser = await authFor(page);
  if (browser.tenantId !== found.result.userId)
    throw new Error("Calendar browser subject disagrees with disposable account");
  await call(admin, privateRefs.onboarding.__seedOnboardedTenant, {
    tenantId: found.result.userId,
  });
  return { tenantId: found.result.userId, email, password };
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

// A local `convex run` invalidates the saved browser session (e2e/README.md). Authenticate
// again after all fixture calls, so both card checks use a fresh session on the same tenant.
async function signInAfterFixtures(page: Page, { email, password }: Identity): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: /sign ?out/i })).toBeVisible({ timeout: 30_000 });
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
  for (const [index, tool] of ["listManagedCalendarEvents", "proposeCalendarChange"].entries()) {
    const stepKey = `${turnId}:${index}`;
    convexRun("agentSteps:record", {
      tenantId,
      threadId,
      turnId,
      stepKey,
      tool,
      startedAt: Date.now() + index,
    });
    convexRun(
      "agentSteps:finish",
      {
        tenantId,
        turnId,
        stepKey,
        phase: "done",
        durationMs: 5,
        endedAt: Date.now() + index + 5,
      },
      true,
    );
  }
}

test("offline list → update/delete stage renders truthful management cards before Approve", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const disposable = process.env.PIKAR_PHASE17_DISPOSABLE === "1";
  const identity: Identity = disposable
    ? await disposableIdentity(page)
    : await (async () => {
        await page.goto("/dashboard/workspace");
        const { tenantId } = await authFor(page);
        const email = process.env.E2E_USER_EMAIL;
        const password = process.env.E2E_USER_PASSWORD;
        if (!email || !password) throw new Error("Calendar E2E needs seeded E2E_USER credentials.");
        convexRun("onboarding:__seedOnboardedTenant", { tenantId });
        return { tenantId, email, password };
      })();
  const { tenantId } = identity;

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
  // latestTurn intentionally exposes only the tenant's newest turn. Leave the update trace newest
  // for the one activity-card assertion; the delete card is checked through its exact plan row.
  seedTrace(tenantId, update.threadId, `calendar-update-${Date.now()}`);

  await signInAfterFixtures(page, identity);
  expect((await authFor(page)).tenantId).toBe(tenantId);
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
  await expect(
    updateCard.getByRole("button", { name: /Approve & update calendar/i }),
  ).toBeEnabled();
  const trace = workspace.getByTestId("activity-card");
  await expect(trace).toContainText("Found events I can change");
  await expect(trace).toContainText("Calendar change ready to approve");

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
