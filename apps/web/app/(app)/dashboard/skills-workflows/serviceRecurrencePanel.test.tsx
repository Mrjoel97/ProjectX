// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ServiceRecurrencePanel } from "./ServiceRecurrencePanel";

const mocks = vi.hoisted(() => ({
  status: {} as Record<string, unknown>,
  configure: vi.fn(),
  suspend: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.status,
  useMutation: (ref: never) =>
    getFunctionName(ref).endsWith(":configure") ? mocks.configure : mocks.suspend,
}));
type Service = Parameters<typeof ServiceRecurrencePanel>[0]["service"];
const service: Service = {
  id: "service-a" as Service["id"],
  tenantId: "a",
  serviceId: "social-marketing",
  revision: 2,
  controlRevision: 3,
  controlState: "active",
  goal: "Prepare useful posts",
  budgetLimitCents: 50,
  readiness: {
    ready: true,
    reasons: [],
    accounts: [],
    skills: [],
    sources: { businessProfileReady: true },
    businessKnowledge: { ready: true, gaps: [], nextQuestion: null },
    missingSources: [],
    qualification: "builtin_attended_social",
  },
  operationIds: ["social.prepare"],
  accounts: [],
  skills: [],
  goalId: null,
  createdAt: 1,
  updatedAt: 1,
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mocks.status = { qualified: true, approval: null };
  mocks.configure.mockReset().mockResolvedValue({ revision: 1 });
  mocks.suspend.mockReset().mockResolvedValue({ suspended: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function approve() {
  await act(async () => button("Set a schedule").click());
  const form = host.querySelector<HTMLFormElement>(
    'form[aria-label="Review automatic work schedule"]',
  );
  if (!form) throw new Error("Missing schedule review");
  const consent = form.querySelector<HTMLInputElement>('[name="consent"]');
  if (!consent) throw new Error("Missing consent");
  consent.checked = true;
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
test("rendering never opts a business into automatic work; explicit review binds current revisions and expiry", async () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  await act(async () => root.render(<ServiceRecurrencePanel service={service} />));
  expect(mocks.configure).not.toHaveBeenCalled();
  expect(host.textContent).toContain("You still approve every post");
  await approve();
  expect(mocks.configure).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      serviceId: "social-marketing",
      expectedRevision: 2,
      expectedControlRevision: 3,
      expectedApprovalRevision: 0,
      expiresAtMs: now + 7 * 86400000,
      schedule: expect.objectContaining({ cadence: "daily", weekday: null, hour: 9, minute: 0 }),
    }),
  );
});
test("authorization loss explains reconnect and fresh approval without silently resuming", async () => {
  mocks.status = {
    qualified: true,
    approval: {
      revision: 4,
      enabled: false,
      suspensionReason: "authorization_required",
      schedule: { cadence: "daily", weekday: null, hour: 9, minute: 0, timeZone: "UTC" },
    },
  };
  await act(async () => root.render(<ServiceRecurrencePanel service={service} />));
  expect(host.textContent).toContain("Reconnect it");
  expect(host.textContent).toContain("approve a new schedule");
  expect(mocks.configure).not.toHaveBeenCalled();
});
test("pausing automatic work uses current service controls and never starts another run", async () => {
  mocks.status = {
    qualified: true,
    approval: {
      revision: 4,
      enabled: true,
      expiresAtMs: Date.now() + 86400000,
      nextDueAtMs: Date.now() + 60000,
      schedule: { cadence: "daily", weekday: null, hour: 9, minute: 0, timeZone: "UTC" },
    },
  };
  await act(async () => root.render(<ServiceRecurrencePanel service={service} />));
  await act(async () => button("Pause automatic work").click());
  expect(mocks.suspend).toHaveBeenCalledExactlyOnceWith({
    serviceId: "social-marketing",
    expectedRevision: 2,
    expectedControlRevision: 3,
  });
  expect(mocks.configure).not.toHaveBeenCalled();
});
test("stale approval refusal keeps the user's schedule draft without retrying", async () => {
  mocks.configure.mockRejectedValueOnce(new Error("STANDING_SERVICE_APPROVAL_CONFLICT"));
  await act(async () => root.render(<ServiceRecurrencePanel service={service} />));
  await approve();
  expect(host.querySelector('form[aria-label="Review automatic work schedule"]')).not.toBeNull();
  expect(host.textContent).toContain("schedule was not approved");
  expect(mocks.configure).toHaveBeenCalledTimes(1);
});
test("an unqualified or unready service cannot approve an automatic schedule", async () => {
  mocks.status = { qualified: false, approval: null };
  await act(async () => root.render(<ServiceRecurrencePanel service={service} />));
  expect(button("Set a schedule").disabled).toBe(true);
  await act(async () => button("Set a schedule").click());
  expect(mocks.configure).not.toHaveBeenCalled();
});
