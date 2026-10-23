// @vitest-environment jsdom
import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  options: {} as {
    accounts: (typeof bufferAccount)[];
    skills: (typeof skill)[];
    budgetLimitCents: number;
    truncated?: boolean;
  },
  services: [] as ReturnType<typeof saved>[],
  service: null as ReturnType<typeof saved> | null,
  runs: [] as { runId: string; state: string; threadId?: string }[],
  buffer: true,
  zernio: true,
  setup: vi.fn(),
  start: vi.fn(),
  control: vi.fn(),
  reconcile: vi.fn(),
  query: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) => {
    switch (getFunctionName(ref)) {
      case "managedServices:list":
        return { items: state.services, truncated: false };
      case "managedServices:setupOptions":
        return state.options;
      case "managedServices:status":
        return state.service;
      case "managedServiceRuns:list":
        return { items: state.runs, truncated: false };
      case "serviceOutcomes:runOutcome":
        return null;
      case "goals:listGoals":
        return [];
      case "buffer:status":
        return { connected: state.buffer };
      case "zernio:status":
        return { status: state.zernio ? "connected" : "reauth_required" };
      default:
        throw new Error(`Unexpected query ${getFunctionName(ref)}`);
    }
  },
  useMutation: (ref: FunctionReference<"mutation">) =>
    getFunctionName(ref) === "managedServices:setup"
      ? state.setup
      : getFunctionName(ref) === "managedServiceRuns:reconcile"
        ? state.reconcile
        : state.control,
  useAction: () => state.start,
  useConvex: () => ({ query: state.query }),
}));

import { ManagedServicesPanel } from "./ManagedServicesPanel";

const bufferAccount = {
  provider: "buffer",
  connectionId: "buffer-owned-pin",
  accountId: "buffer-channel",
  connectionRevision: 4,
  label: "Maua Shop · Instagram",
  available: true,
};
const zernioAccount = {
  provider: "zernio",
  connectionId: "zernio-owned-pin",
  accountId: "zernio-channel",
  connectionRevision: 2,
  label: "Maua Shop insights",
  available: true,
};
const skill = {
  skillId: "server-owned-skill",
  name: "cockpit-agent",
  version: 3,
  bodyHash: "a".repeat(64),
  tenantId: null,
};
const saved = (ready = false, controlState = "active", revision = 1, controlRevision = 1) => ({
  serviceId: "social-marketing",
  goal: "Bring customers to Maua Shop.",
  revision,
  controlRevision,
  controlState,
  accounts: [bufferAccount, zernioAccount],
  skills: [skill],
  operationIds: ["social.prepare", "social.report"],
  budgetLimitCents: 100,
  readiness: { ready, reasons: ready ? [] : ["operation_unqualified", "missing_tool_grant"] },
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.options = {
    accounts: [bufferAccount, zernioAccount],
    skills: [skill],
    budgetLimitCents: 100,
  };
  state.services = [];
  state.service = null;
  state.runs = [];
  state.buffer = true;
  state.zernio = true;
  for (const fn of [state.setup, state.start, state.control, state.query, state.reconcile])
    fn.mockReset();
  state.setup.mockResolvedValue({ revision: 1, controlRevision: 1 });
  state.start.mockResolvedValue({ runId: "new-run", state: "running", existing: false });
  state.control.mockResolvedValue({ providerCancellationRequested: false });
  state.query.mockImplementation((ref: FunctionReference<"query">) =>
    Promise.resolve(getFunctionName(ref) === "managedServices:status" ? state.service : {}),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () => root.render(<ManagedServicesPanel />));
};
const button = (label: string) => {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(found, label).toBeDefined();
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
};
async function text(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  );
  if (!input) throw new Error(`Missing input: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectAccounts() {
  await act(async () => {
    for (const label of host.querySelectorAll("label"))
      if (label.textContent?.includes("Maua Shop"))
        label.querySelector<HTMLInputElement>("input")?.click();
  });
}
const save = async () => {
  await act(async () =>
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
};

test("setup uses server-owned pins and chosen accounts, with review and budget boundaries visible", async () => {
  await render();
  await text("Service goal", "Grow local interest in Maua Shop.");
  await selectAccounts();
  expect(button("Save service setup").disabled).toBe(false);
  await save();
  expect(state.setup).toHaveBeenCalledExactlyOnceWith({
    serviceId: "social-marketing",
    expectedRevision: 0,
    goal: "Grow local interest in Maua Shop.",
    operationIds: ["social.prepare", "social.report"],
    accounts: [
      expect.objectContaining({ connectionId: "buffer-owned-pin", connectionRevision: 4 }),
      expect.objectContaining({ connectionId: "zernio-owned-pin", connectionRevision: 2 }),
    ],
    skills: [skill],
    budgetLimitCents: 100,
  });
  expect(state.setup.mock.calls[0]?.[0].accounts[0]).not.toHaveProperty("label");
  expect(host.textContent).not.toContain(skill.bodyHash);
  expect(host.textContent).not.toContain("buffer-owned-pin");
  expect(host.textContent).toContain("You review posts before anything is scheduled");
  expect(
    host.querySelector<HTMLInputElement>('input[type="checkbox"]:disabled')?.parentElement
      ?.textContent,
  ).toContain("Run on a schedule");
});

test("missing or disconnected account blocks saving until the unsupported activity is removed", async () => {
  state.zernio = false;
  await render();
  await text("Service goal", "Prepare next week’s social drafts.");
  await selectAccounts();
  expect(button("Save service setup").disabled).toBe(true);
  await save();
  expect(state.setup).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Reconnect to use");
  await act(async () =>
    [...host.querySelectorAll("label")]
      .find((l) => l.textContent?.includes("Review engagement"))
      ?.querySelector<HTMLInputElement>("input")
      ?.click(),
  );
  expect(button("Save service setup").disabled).toBe(false);
  expect(
    host.querySelector<HTMLAnchorElement>('a[href="/dashboard/profile?tab=connections"]'),
  ).not.toBeNull();
});

test("stale edits preserve the draft and require an explicit latest-revision reload", async () => {
  state.service = saved();
  state.services = [state.service];
  state.setup.mockRejectedValueOnce(new Error("SERVICE_STALE_REVISION"));
  await render();
  await click("Edit setup");
  await text("Service goal", "My unsaved change.");
  await save();
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("My unsaved change.");
  expect(button("Save service setup").disabled).toBe(true);
  state.query.mockResolvedValueOnce({
    ...saved(false, "active", 2, 2),
    goal: "Latest saved goal.",
  });
  await click("Load latest setup");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Latest saved goal.");
  await save();
  expect(state.setup).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 2, goal: "Latest saved goal." }),
  );
});

test("failed save and refresh retain input and allow a deliberate recovery", async () => {
  state.setup.mockRejectedValueOnce(new Error("private provider failure"));
  await render();
  await text("Service goal", "Keep this goal.");
  await selectAccounts();
  await save();
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Keep this goal.");
  expect(host.textContent).not.toContain("private provider failure");
  state.query.mockRejectedValueOnce(new Error("offline"));
  await click("Refresh services");
  expect(host.textContent).toContain("Your draft has been kept");
  await click("Refresh services");
  expect(host.textContent).toContain("connections checked");
  await save();
  expect(state.setup).toHaveBeenCalledTimes(2);
});

test("unqualified readiness stays disabled with human reasons and an honest empty history", async () => {
  state.service = saved();
  state.services = [state.service];
  await render();
  expect(button("Start one run").disabled).toBe(true);
  await click("Start one run");
  expect(state.start).not.toHaveBeenCalled();
  expect(host.textContent).toContain("This service is not available to run yet");
  expect(host.querySelectorAll("article li")).toHaveLength(1);
  expect(host.textContent).toContain("No runs yet.");
  expect(host.textContent).not.toContain("operation_unqualified");
  expect(host.textContent).not.toContain("execution checks");
});

test("readiness codes use plain explanations and repeated availability reasons appear once", async () => {
  state.service = saved();
  state.service.readiness.reasons = [
    "unsupported_service_operation",
    "budget_limit_unavailable",
    "missing_skill",
    "skill_unqualified",
    "account_unavailable",
    "unrecognized_internal_code",
  ];
  state.services = [state.service];
  await render();
  const messages = [...host.querySelectorAll("article li")].map((item) => item.textContent);
  expect(messages).toEqual([
    "This service is not available to run yet. Your setup can be saved.",
    "Review the maximum spend per run in setup before starting.",
    "A selected account has changed or needs reconnection. Review your setup.",
  ]);
  expect(host.textContent).not.toContain("unrecognized_internal_code");
  expect(button("Start one run").disabled).toBe(true);
});

test("uncertain start retries the same request key, then a confirmed completed run permits a new intent", async () => {
  state.service = saved(true);
  state.services = [state.service];
  state.start.mockRejectedValueOnce(new Error("connection lost"));
  await render();
  await click("Start one run");
  const first = state.start.mock.calls[0]?.[0];
  expect(host.textContent).toContain("Could not confirm the start");
  await click("Start one run");
  expect(state.start.mock.calls[1]?.[0]).toEqual(first);
  state.runs = [{ runId: "new-run", state: "completed", threadId: "thread /?&" }];
  await render();
  expect(host.querySelector<HTMLAnchorElement>('a[href*="thread="]')?.getAttribute("href")).toBe(
    "/dashboard/workspace?thread=thread%20%2F%3F%26",
  );
  await click("Start one run");
  expect(state.start.mock.calls[2]?.[0].requestKey).not.toBe(first.requestKey);
});

test("unknown outcomes block new work even when a later completed run is displayed first", async () => {
  state.service = saved(true);
  state.services = [state.service];
  state.runs = [
    { runId: "recent", state: "completed" },
    { runId: "uncertain", state: "unknown" },
  ];
  await render();
  expect(button("Start one run").disabled).toBe(true);
  expect(state.start).not.toHaveBeenCalled();
});

test("checking interrupted work uses the pending run and current revisions, retaining holds until native readback", async () => {
  state.service = saved(true, "active", 7, 11);
  state.services = [state.service];
  state.runs = [
    { runId: "latest-completed", state: "completed" },
    { runId: "older-interrupted", state: "unknown" },
  ];
  state.reconcile
    .mockResolvedValueOnce({ resolved: false, reason: "unsettled_cost" })
    .mockResolvedValueOnce({ resolved: true, state: "stopped" });
  await render();
  expect(state.reconcile).not.toHaveBeenCalled();
  expect(button("Start one run").disabled).toBe(true);
  await click("Check interrupted work");
  expect(state.reconcile).toHaveBeenCalledExactlyOnceWith({
    runId: "older-interrupted",
    expectedRevision: 7,
    expectedControlRevision: 11,
  });
  expect(host.textContent).toContain(
    "The final cost is not confirmed yet. The service stays on hold.",
  );
  expect(button("Start one run").disabled).toBe(true);
  expect(state.start).not.toHaveBeenCalled();
  await click("Check interrupted work");
  expect(host.textContent).toContain(
    "Interrupted work closed. Review any saved drafts before starting a new run.",
  );
  // A successful check is not an optimistic unlock: the authoritative run query must settle too.
  expect(button("Start one run").disabled).toBe(true);
  expect(state.start).not.toHaveBeenCalled();
  expect(state.control).not.toHaveBeenCalled();
  state.runs = [
    { runId: "latest-completed", state: "completed" },
    { runId: "older-interrupted", state: "stopped" },
  ];
  await render();
  expect(button("Start one run").disabled).toBe(false);
  expect(
    [...host.querySelectorAll("button")].some(
      (item) => item.textContent === "Check interrupted work",
    ),
  ).toBe(false);
  expect(state.start).not.toHaveBeenCalled();
  await click("Start one run");
  expect(state.start).toHaveBeenCalledExactlyOnceWith({
    serviceId: "social-marketing",
    expectedRevision: 7,
    expectedControlRevision: 11,
    requestKey: expect.any(String),
  });
});

test("an active run remains active after checking, with no duplicate start or automatic retry", async () => {
  state.service = saved(true, "active", 3, 6);
  state.services = [state.service];
  state.runs = [{ runId: "still-working", state: "running" }];
  state.reconcile.mockResolvedValueOnce({ resolved: false, reason: "still_running" });
  await render();
  await click("Check interrupted work");
  expect(host.textContent).toContain("Pikar is still working. No additional run was started.");
  expect(state.reconcile).toHaveBeenCalledExactlyOnceWith({
    runId: "still-working",
    expectedRevision: 3,
    expectedControlRevision: 6,
  });
  expect(button("Start one run").disabled).toBe(true);
  await render();
  expect(state.reconcile).toHaveBeenCalledTimes(1);
  expect(state.start).not.toHaveBeenCalled();
});

test("a rejected recovery keeps the run blocked and an explicit retry uses refreshed revision pins", async () => {
  state.service = saved(true, "active", 4, 8);
  state.services = [state.service];
  state.runs = [{ runId: "interrupted-run", state: "unknown" }];
  state.reconcile
    .mockRejectedValueOnce(new Error("PRIVATE_STALE_RECOVERY"))
    .mockResolvedValueOnce({ resolved: false, reason: "workflow_unknown" });
  await render();
  await click("Check interrupted work");
  expect(host.textContent).toContain(
    "Could not check this run. Refresh to check its latest state.",
  );
  expect(host.textContent).not.toContain("PRIVATE_STALE_RECOVERY");
  expect(button("Start one run").disabled).toBe(true);
  state.service = saved(true, "active", 5, 9);
  await render();
  expect(state.reconcile).toHaveBeenCalledTimes(1);
  await click("Check interrupted work");
  expect(state.reconcile).toHaveBeenLastCalledWith({
    runId: "interrupted-run",
    expectedRevision: 5,
    expectedControlRevision: 9,
  });
  expect(host.textContent).toContain(
    "Could not confirm the job status. The service stays on hold.",
  );
  expect(state.start).not.toHaveBeenCalled();
  expect(state.control).not.toHaveBeenCalled();
});

test("pause and stop use current control revisions and disclose Buffer’s existing queue", async () => {
  state.service = saved(true);
  state.services = [state.service];
  await render();
  await click("Pause service");
  expect(state.control).toHaveBeenLastCalledWith({
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    action: "pause",
  });
  expect(host.textContent).toContain("Work already in progress may finish");
  state.service = saved(false, "paused", 1, 2);
  await render();
  expect(button("Pause service").disabled).toBe(true);
  expect(button("Start one run").disabled).toBe(true);
  await click("Stop service");
  expect(state.control).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedControlRevision: 2, action: "stop" }),
  );
  expect(host.textContent).toContain("Posts already scheduled in Buffer stay in Buffer");
  state.service = saved(false, "stopped", 1, 3);
  await render();
  expect(button("Stop service").disabled).toBe(true);
  expect(button("Edit setup").disabled).toBe(true);
});

test("fractional-cent and nonfinite budgets never reach setup while exact cents are preserved", async () => {
  await render();
  await text("Service goal", "Prepare drafts.");
  await selectAccounts();
  await text("Maximum spend per run (USD)", "0.001");
  await save();
  expect(state.setup).not.toHaveBeenCalled();
  await text("Maximum spend per run (USD)", "0.29");
  await save();
  expect(state.setup).toHaveBeenLastCalledWith(expect.objectContaining({ budgetLimitCents: 29 }));
});

test("resuming is a separate revision-checked decision and never starts a run automatically", async () => {
  state.service = saved(false, "stopped", 2, 4);
  state.services = [state.service];
  await render();
  await click("Resume service");
  expect(state.control).toHaveBeenLastCalledWith({
    serviceId: "social-marketing",
    expectedRevision: 2,
    expectedControlRevision: 4,
    action: "resume",
  });
  expect(state.start).not.toHaveBeenCalled();
  expect(button("Start one run").disabled).toBe(true);
  state.service = saved(true, "active", 2, 5);
  await render();
  expect(button("Start one run").disabled).toBe(false);
  expect(state.start).not.toHaveBeenCalled();
  await click("Start one run");
  expect(state.start).toHaveBeenLastCalledWith(
    expect.objectContaining({ expectedRevision: 2, expectedControlRevision: 5 }),
  );
});

test("a setup created in another session can be loaded after a new-setup revision conflict", async () => {
  state.setup.mockRejectedValueOnce(new Error("SERVICE_STALE_REVISION"));
  await render();
  await text("Service goal", "My first goal.");
  await selectAccounts();
  await save();
  state.query.mockResolvedValueOnce(saved(false, "active", 3, 3));
  await click("Load latest setup");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
    "Bring customers to Maua Shop.",
  );
  await save();
  expect(state.setup).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3 }));
});
