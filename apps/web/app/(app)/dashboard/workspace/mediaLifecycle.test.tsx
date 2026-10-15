// @vitest-environment jsdom

import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  plan: {} as Record<string, unknown>,
  rows: [] as Record<string, unknown>[],
  pageStatus: "Exhausted",
  loadMore: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    if (name === "plans:byThread") return state.plan;
    if (name === "plans:reportForPlan") return [];
    return null;
  },
  usePaginatedQuery: () => ({
    results: state.rows,
    status: state.pageStatus,
    loadMore: state.loadMore,
  }),
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
vi.mock("@convex-dev/agent/react", () => ({
  useThreadMessages: () => ({ results: [], status: "Exhausted" }),
}));
vi.mock("./useSendCockpitMessage", () => ({ useSendCockpitMessage: () => vi.fn() }));
vi.mock("./IntakeControls", () => ({ IntakeControls: () => null }));
vi.mock("./RevenuePackPanel", () => ({ RevenuePackPanel: () => null }));
vi.mock("./MediaCanvas", () => ({
  MediaCanvas: ({ plan }: { plan: Record<string, unknown> }) => (
    <section data-testid="media-canvas">{String(plan.renderStatus ?? "proposal")}</section>
  ),
  ProposalFailureCanvas: () => null,
}));

import { ChatPane } from "./ChatPane";
import { CardList } from "./cards";

beforeEach(() => {
  state.plan = { _id: "plan", kind: "media", status: "proposed" };
  state.rows = [];
  state.pageStatus = "Exhausted";
  state.loadMore.mockClear();
});

describe("media stays visible after Generate", () => {
  test.each([
    "collecting",
    "proposed",
    "approved",
    "delivering",
    "done",
  ])("%s keeps the canvas instead of an email report", (status) => {
    state.plan.status = status;
    const html = renderToStaticMarkup(<CardList threadId="thread" sending={false} />);
    expect(html).toContain('data-testid="media-canvas"');
    expect(html).not.toContain("REPORT");
    expect(html).not.toContain("No recipients yet");
  });

  test("a terminal render failure reaches the canvas while the plan remains delivering", () => {
    Object.assign(state.plan, {
      status: "delivering",
      renderStatus: "failed",
      renderReason: "incomplete_batch",
    });
    const html = renderToStaticMarkup(<CardList threadId="thread" sending={false} />);
    expect(html).toContain('data-testid="media-canvas">failed');
    expect(html).not.toContain("REPORT");
  });

  test.each(["delivering", "done"])("%s retains email reporting and truthful chat", (status) => {
    state.plan.status = status;
    const chat = () =>
      renderToStaticMarkup(
        <ChatPane threadId="thread" sending={false} onSending={() => {}} onThread={() => {}} />,
      );
    const mediaChat = chat();
    expect(mediaChat).toContain("Pikar AI can make mistakes");
    expect(mediaChat).not.toContain("Sending…");
    expect(mediaChat).not.toContain("Sent ✓");

    state.plan.kind = "email";
    const html = renderToStaticMarkup(<CardList threadId="thread" sending={false} />);
    expect(html).toContain("REPORT");
    expect(html).toContain("No recipients yet");
    expect(html).not.toContain('data-testid="media-canvas"');
    expect(chat()).toContain(status === "delivering" ? "Sending…" : "Sent ✓");
  });
});

test("report keeps loaded outcomes and offers the next page until legacy101 recipients are visible", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.plan = { _id: "plan", kind: "email", status: "done" };
  const all = Array.from({ length: 101 }, (_, i) => ({
    requestId: "request" + i,
    correlationId: "corr" + i,
    recipient: "recipient" + i + "@example.test",
    status: "failed",
    deliveryAttempt: null,
    messageId: null,
    attachments: [],
    delivered: false,
  }));
  state.rows = all.slice(0, 25);
  state.pageStatus = "CanLoadMore";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CardList threadId="thread" sending={false} />));
    expect(container.textContent).toContain("recipient24@example.test");
    expect(container.textContent).not.toContain("recipient100@example.test");
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Load more recipients",
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(state.loadMore).toHaveBeenCalledWith(25);
    state.rows = all;
    state.pageStatus = "Exhausted";
    await act(async () => root.render(<CardList threadId="thread" sending={false} />));
    expect(container.querySelectorAll("li")).toHaveLength(101);
    expect(container.textContent).toContain("recipient100@example.test");
    expect(container.textContent).not.toContain("Load more recipients");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
