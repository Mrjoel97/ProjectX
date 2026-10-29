// @vitest-environment jsdom

import { type FunctionReference, getFunctionName } from "convex/server";
import type { GenericId as Id } from "convex/values";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  outcome: undefined as ReturnType<typeof fixture> | null | undefined,
  goals: undefined as { id: string; text: string; status: string }[] | undefined,
  record: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">) =>
    getFunctionName(ref) === "goals:listGoals" ? state.goals : state.outcome,
  useMutation: () => state.record,
}));

import { ServiceGoalLink, ServiceOutcomesPanel } from "./ServiceOutcomesPanel";

const runId = "run-a" as Id<"managedServiceRuns">;
const now = Date.parse("2026-10-23T12:00:00Z");
function fixture() {
  return {
    runId,
    operational: "completed",
    usefulness: "unreviewed",
    goal: null as { goalId: string; status: string } | null,
    reporting: {
      state: "insufficient_history",
      retrieval: "fresh",
      sourceFailure: false,
      observations: [{ observationId: "snapshot-ref", retrievedAt: now, capturedAt: now }],
      movement: null as
        | {
            accountId: string;
            platform: string;
            postId: string;
            source: string;
            freshness: { retrieval: string; upstream: string; sourceObservedAt: number | null };
            metrics: {
              metric: string;
              previous: number | null;
              current: number | null;
              delta: number | null;
            }[];
          }[]
        | null,
    },
    social: [] as {
      draftRef: string;
      publication: { status: string };
      publisherAttribution: string;
      nextAction: string;
    }[],
    socialTruncated: false,
  };
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.outcome = fixture();
  state.goals = [
    { id: "owned-goal", text: "Bring more local customers to Maua Shop", status: "active" },
    { id: "old-goal", text: "Past business objective", status: "achieved" },
  ];
  state.record.mockReset();
  state.record.mockResolvedValue({ ok: true });
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
  await act(async () => root.render(<ServiceOutcomesPanel runId={runId} />));
};
const current = () => {
  if (!state.outcome) throw new Error("fixture outcome");
  return state.outcome;
};
const button = (text: string) => {
  const result = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!result) throw new Error(`missing ${text}`);
  return result;
};
const click = async (text: string) => {
  await act(async () => button(text).click());
};

test("loading and absent results do not fabricate feedback or engagement", async () => {
  state.outcome = undefined;
  await render();
  expect(host.textContent).toContain("Loading run results");
  expect(host.querySelector("button")).toBeNull();
  state.outcome = null;
  await render();
  expect(host.textContent).toContain("Results for this run are unavailable");
  expect(state.record).not.toHaveBeenCalled();
});

test("work completed, user usefulness and business impact remain three separate facts", async () => {
  current().goal = { goalId: "private-goal-ref", status: "active" };
  await render();
  expect([...host.querySelectorAll("dd")].map((item) => item.textContent)).toEqual([
    "Work completed",
    "Not reviewed",
    "Not established",
  ]);
  expect(host.textContent).toContain("does not complete that goal");
  expect(host.textContent).not.toContain("private-goal-ref");
  expect(host.textContent).toContain("More history is needed");
  expect(host.textContent).toContain("Retrieval time does not establish");
});

test("human usefulness is saved explicitly for the exact run and follows the authoritative readback", async () => {
  await render();
  expect(state.record).not.toHaveBeenCalled();
  await click("Useful");
  expect(state.record).toHaveBeenCalledExactlyOnceWith({ runId, usefulness: "accepted" });
  expect(host.textContent).toContain("Your feedback is saved");
  expect(button("Useful").getAttribute("aria-pressed")).toBe("false");
  current().usefulness = "accepted";
  await render();
  expect(button("Useful").getAttribute("aria-pressed")).toBe("true");
  await click("Needs improvement");
  expect(state.record).toHaveBeenLastCalledWith({ runId, usefulness: "rejected" });
});

test("refused feedback remains honest and recovers without exposing internal errors", async () => {
  state.record.mockRejectedValueOnce(new Error("PRIVATE_NATIVE_ERROR"));
  await render();
  await click("Useful");
  expect(host.textContent).toContain("could not be saved");
  expect(host.textContent).not.toContain("PRIVATE_NATIVE_ERROR");
  expect(button("Useful").getAttribute("aria-pressed")).toBe("false");
  await click("Useful");
  expect(state.record).toHaveBeenCalledTimes(2);
});

test.each([
  "claimed",
  "running",
  "unknown",
])("%s outcomes cannot accept usefulness feedback", async (operational) => {
  current().operational = operational;
  await render();
  expect(button("Useful").disabled).toBe(true);
  expect(button("Useful").style.cursor).toBe("not-allowed");
  await click("Useful");
  expect(state.record).not.toHaveBeenCalled();
  expect(host.textContent).toContain("after this run has finished or stopped");
});

test("known zero survives while missing values, unknown timestamps and stale evidence stay explicit", async () => {
  const data = current();
  data.reporting.state = "ready";
  data.reporting.movement = [
    {
      accountId: "private-account",
      platform: "instagram",
      postId: "private-post",
      source: "external",
      freshness: { retrieval: "fresh", upstream: "unknown", sourceObservedAt: null },
      metrics: [
        { metric: "likes", previous: 0, current: 0, delta: 0 },
        { metric: "views", previous: null, current: null, delta: null },
      ],
    },
  ];
  await render();
  const cells = [...host.querySelectorAll("td")].map((item) => item.textContent);
  expect(cells).toEqual(["0", "0", "Unavailable", "Unavailable"]);
  expect(host.textContent).toContain("Compare each post’s all-time measurements.");
  expect(host.textContent).toContain("Update time unknown");
  expect(host.textContent).toContain("Provider update: Unavailable");
  expect(host.textContent).not.toContain("private-account");
  expect(host.textContent).not.toContain("private-post");
  const first = data.reporting.movement[0];
  if (!first) throw new Error("fixture movement");
  first.freshness.upstream = "stale";
  first.freshness.retrieval = "stale";
  first.freshness.sourceObservedAt = now - 2 * 86400_000;
  await render();
  expect(host.textContent).toContain("Retrieved report: Stale. Provider measurements: Stale");
});

test("a scheduled post and unverified mapping never become confirmed delivery or attributed campaign results", async () => {
  current().social = [
    {
      draftRef: "draft-ref",
      publication: { status: "scheduled" },
      publisherAttribution: "unverified",
      nextAction: "verify_native_mapping",
    },
  ];
  await render();
  expect(host.textContent).toContain("Delivery is not yet confirmed");
  expect(host.textContent).toContain("Engagement has not been attributed");
  expect(host.textContent).toContain("have not been verified as the same post");
  expect(host.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe(
    "/dashboard/marketing",
  );
});

test("unknown publication recommends checking Buffer and does not offer an automatic replacement", async () => {
  current().social = [
    {
      draftRef: "draft-ref",
      publication: { status: "unknown" },
      publisherAttribution: "unverified",
      nextAction: "check_buffer_before_retry",
    },
  ];
  await render();
  expect(host.textContent).toContain("Check Buffer before replacing this post");
  expect(host.querySelectorAll("button")).toHaveLength(2);
});

test("report and draft sampling bounds stay visible and missing analytics are not success", async () => {
  const data = current();
  data.reporting.state = "unavailable";
  data.socialTruncated = true;
  data.social = Array.from({ length: 5 }, (_, i) => ({
    draftRef: `draft-${i}`,
    publication: { status: "sent" },
    publisherAttribution: "unverified",
    nextAction: "refresh_report",
  }));
  await render();
  expect(host.textContent).toContain("No engagement report is available");
  expect(host.textContent).toContain("limited selection of linked drafts");
  expect(host.textContent).toContain("Social draft 3");
  expect(host.textContent).not.toContain("Social draft 4");
  expect(host.textContent).toContain("Missing measurements are unavailable, not zero");
});

test("stale reports and failed refreshes never read as ready evidence", async () => {
  current().reporting.state = "stale";
  current().reporting.sourceFailure = true;
  await render();
  expect(host.textContent).toContain("report needs refreshing");
  expect(host.textContent).toContain("latest report refresh failed");
});

const renderGoal = async (
  revision = 2,
  controlRevision = 3,
  goalId: Id<"goals"> | null = null,
  disabled = false,
) => {
  await act(async () =>
    root.render(
      <ServiceGoalLink
        serviceId={"service-a" as Id<"managedServices">}
        revision={revision}
        controlRevision={controlRevision}
        goalId={goalId}
        disabled={disabled}
      />,
    ),
  );
};
async function chooseGoal(id: string) {
  const select = host.querySelector("select");
  if (!select) throw new Error("missing goal selector");
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("a saved owned goal can be linked before any run with both configuration revisions", async () => {
  await renderGoal();
  expect(state.record).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Bring more local customers");
  expect(host.textContent).not.toContain("Past business objective");
  await chooseGoal("owned-goal");
  await click("Link business goal");
  expect(state.record).toHaveBeenCalledExactlyOnceWith({
    serviceId: "service-a",
    goalId: "owned-goal",
    expectedRevision: 2,
    expectedControlRevision: 3,
  });
  expect(host.textContent).toContain("does not mark it achieved or approve any work");
  expect(host.textContent).toContain("Work will start only when you choose");
});

test("goal selection loading, missing choices and a foreign injected option cannot send a goal link", async () => {
  state.goals = undefined;
  await renderGoal();
  expect(button("Link business goal").disabled).toBe(true);
  state.goals = [];
  await renderGoal();
  expect(host.textContent).toContain("No active business goals");
  state.goals = [{ id: "owned-goal", text: "My business goal", status: "active" }];
  await renderGoal();
  const select = host.querySelector("select");
  if (!select) throw new Error("missing selector");
  const foreign = document.createElement("option");
  foreign.value = "foreign-goal";
  foreign.textContent = "Untrusted injected option";
  select.append(foreign);
  await chooseGoal("foreign-goal");
  await click("Link business goal");
  expect(button("Link business goal").disabled).toBe(true);
  expect(state.record).not.toHaveBeenCalled();
});

test("a refused stale goal link preserves the chosen goal and never changes goal status", async () => {
  state.record.mockRejectedValueOnce(new Error("SERVICE_CONFIGURATION_STALE"));
  await renderGoal();
  await chooseGoal("owned-goal");
  await click("Link business goal");
  expect(host.textContent).toContain("Refresh the service");
  expect(host.textContent).not.toContain("SERVICE_CONFIGURATION_STALE");
  expect(host.querySelector("select")?.value).toBe("owned-goal");
  await renderGoal(4, 5);
  expect(state.record).toHaveBeenCalledTimes(1);
  await click("Link business goal");
  expect(state.record).toHaveBeenLastCalledWith({
    serviceId: "service-a",
    goalId: "owned-goal",
    expectedRevision: 4,
    expectedControlRevision: 5,
  });
});

test("the currently linked goal is shown without another mutation", async () => {
  await renderGoal(2, 3, "owned-goal" as Id<"goals">);
  expect(host.textContent).toContain("Goal linked");
  expect(button("Link business goal").disabled).toBe(true);
  expect(state.record).not.toHaveBeenCalled();
});

test("active or unresolved work disables business-goal changes without sending a mutation", async () => {
  await renderGoal(2, 3, null, true);
  expect(host.querySelector("select")?.disabled).toBe(true);
  expect(button("Link business goal").disabled).toBe(true);
  expect(host.textContent).toContain("Finish or stop the current work");
  await click("Link business goal");
  expect(state.record).not.toHaveBeenCalled();
});
