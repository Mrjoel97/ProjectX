// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AdminView } from "./AdminView";

const mocks = vi.hoisted(() => ({
  pending: [] as unknown[],
  issued: [] as unknown[],
  approve: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference) === "invites:pending"
      ? mocks.pending
      : getFunctionName(reference) === "invites:issued"
        ? mocks.issued
        : undefined,
  useMutation: () => mocks.approve,
}));
vi.mock("./VerticalReviewConsole", () => ({ VerticalReviewConsole: () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.approve.mockReset();
  mocks.pending = [];
  mocks.issued = [];
});

test("the invite handoff survives approval removing the pending request", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.pending = [
    { waitlistId: "fixture-request", email: "tester@example.test", name: null, referral: null },
  ];
  mocks.approve.mockImplementation(async () => {
    mocks.pending = [];
    mocks.issued = [
      {
        inviteId: "fixture-invite",
        code: "ABCD-EFGH-JKMN-PQRS",
        email: "tester@example.test",
        status: "ready",
      },
    ];
    return { code: "ABCD-EFGH-JKMN-PQRS", email: "tester@example.test" };
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(AdminView)));
    const approve = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Approve & mint invite"),
    );
    expect(approve).toBeDefined();
    await act(async () => approve?.click());
    expect(mocks.approve).toHaveBeenCalledWith({ waitlistId: "fixture-request" });
    expect(container.textContent).toContain("No one is waiting");
    expect(container.textContent).toContain("Invitation ready for tester@example.test");
    expect(container.textContent).toContain("/signup?invite=ABCD-EFGH-JKMN-PQRS");
    expect(container.textContent).toContain("Copy invite link");
    expect(container.textContent).not.toContain("Approve & mint invite");
    // A new component has no approval response in memory: the saved invitation still renders.
    await act(async () => root.render(createElement(AdminView, { key: "after-reload" })));
    expect(container.textContent).toContain("/signup?invite=ABCD-EFGH-JKMN-PQRS");
    expect(container.textContent).toContain("Copy invite link");
    mocks.issued = [
      {
        inviteId: "fixture-invite",
        code: null,
        email: "tester@example.test",
        status: "verification_pending",
      },
    ];
    await act(async () => root.render(createElement(AdminView, { key: "after-reload" })));
    expect(container.textContent).toContain("Awaiting email verification");
    expect(container.textContent).not.toContain("Copy invite link");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
