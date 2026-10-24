// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ConnectBufferPage from "../../connect-buffer/page";
import { BufferMarketing } from "./BufferPanel";

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  calls: {} as Record<string, ReturnType<typeof vi.fn>>,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => mocks.queries[getFunctionName(ref)],
  useMutation: (ref: never) =>
    (mocks.calls[getFunctionName(ref)] ??= vi.fn().mockResolvedValue(undefined)),
  useAction: (ref: never) =>
    (mocks.calls[getFunctionName(ref)] ??= vi.fn().mockResolvedValue(undefined)),
}));
const channelId = "1234567890abcdef12345678";
const organizationId = "1234567890abcdef12345679";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mocks.calls = {};
  mocks.queries = {
    "buffer:status": {
      configured: true,
      connected: true,
      status: "connected",
      organizationId,
      organizationName: "Synthetic business",
      channels: [
        { id: channelId, name: "Business LinkedIn", service: "linkedin", available: true },
      ],
      selectedChannelIds: [channelId],
      dailyReports: false,
      reportsAvailable: false,
    },
    "buffer:posts": [],
    "buffer:reports": [],
  };
  window.history.replaceState(null, "", "/connect-buffer");
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
const button = (label: string) => {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};

test("rendering and reviewing never approve a post; explicit approval sends the exact revision", async () => {
  mocks.queries["buffer:posts"] = [
    {
      _id: "post1",
      revision: 3,
      campaign: "Launch",
      channelId,
      text: "Review this exact text",
      mode: "addToQueue",
      status: "draft",
    },
  ];
  await act(async () => root.render(<BufferMarketing />));
  expect(mocks.calls["buffer:approvePost"]).not.toHaveBeenCalled();
  await act(async () => button("Review approval").click());
  expect(host.textContent).toContain("Approve this exact post");
  expect(mocks.calls["buffer:approvePost"]).not.toHaveBeenCalled();
  await act(async () => button("Approve and schedule").click());
  expect(mocks.calls["buffer:approvePost"]).toHaveBeenCalledExactlyOnceWith({
    postId: "post1",
    revision: 3,
  });
});

test("editing keeps the visible revision, saves a new draft and never schedules it", async () => {
  mocks.queries["buffer:posts"] = [
    {
      _id: "post1",
      revision: 3,
      campaign: "Launch",
      channelId,
      text: "Original copy",
      mode: "addToQueue",
      status: "draft",
    },
  ];
  await act(async () => root.render(<BufferMarketing />));
  await act(async () => button("Review approval").click());
  await act(async () => button("Edit draft").click());
  const form = host.querySelector<HTMLFormElement>('form[aria-label="Edit social draft"]');
  if (!form) throw new Error("Editor missing");
  const text = form.querySelector<HTMLTextAreaElement>('textarea[name="text"]');
  if (!text) throw new Error("Draft text missing");
  text.value = "Revised copy";
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mocks.calls["buffer:editPost"]).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      postId: "post1",
      revision: 3,
      text: "Revised copy",
      channelId,
    }),
  );
  expect(mocks.calls["buffer:approvePost"]).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Review it again before approving");
  expect(host.textContent).not.toContain("Approve this exact post");
});

test("a changed query revision requires another review rather than inheriting an earlier approval dialog", async () => {
  const draft = {
    _id: "post1",
    revision: 3,
    campaign: "Launch",
    channelId,
    text: "Original copy",
    mode: "addToQueue",
    status: "draft",
  };
  mocks.queries["buffer:posts"] = [draft];
  await act(async () => root.render(<BufferMarketing />));
  await act(async () => button("Review approval").click());
  mocks.queries["buffer:posts"] = [{ ...draft, revision: 4, text: "Changed elsewhere" }];
  await act(async () => root.render(<BufferMarketing />));
  expect(
    [...host.querySelectorAll("button")].some(
      (node) => node.textContent === "Approve and schedule",
    ),
  ).toBe(false);
  expect(mocks.calls["buffer:approvePost"]).not.toHaveBeenCalled();
  await act(async () => button("Review approval").click());
  await act(async () => button("Approve and schedule").click());
  expect(mocks.calls["buffer:approvePost"]).toHaveBeenCalledExactlyOnceWith({
    postId: "post1",
    revision: 4,
  });
});

test("rejecting a draft sends its visible revision and never approves it", async () => {
  mocks.queries["buffer:posts"] = [
    {
      _id: "post1",
      revision: 7,
      campaign: "Launch",
      channelId,
      text: "Reject this copy",
      mode: "addToQueue",
      status: "draft",
    },
  ];
  await act(async () => root.render(<BufferMarketing />));
  await act(async () => button("Discard draft").click());
  expect(mocks.calls["buffer:discardPost"]).toHaveBeenCalledExactlyOnceWith({
    postId: "post1",
    revision: 7,
  });
  expect(mocks.calls["buffer:approvePost"]).not.toHaveBeenCalled();
  expect(host.textContent).toContain("It will not be scheduled");
});

test("only a known pre-submission failure offers an explicit unapproved replacement", async () => {
  mocks.queries["buffer:posts"] = [
    {
      _id: "post1",
      revision: 2,
      campaign: "Launch",
      channelId,
      text: "Expired schedule",
      mode: "addToQueue",
      status: "failed",
      failure: "schedule_expired",
    },
  ];
  await act(async () => root.render(<BufferMarketing />));
  await act(async () => button("Create replacement draft").click());
  const form = host.querySelector<HTMLFormElement>('form[aria-label="Edit social draft"]');
  if (!form) throw new Error("Replacement editor missing");
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mocks.calls["buffer:restageFailedPost"]).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ postId: "post1", revision: 2 }),
  );
  expect(mocks.calls["buffer:approvePost"]).not.toHaveBeenCalled();
  mocks.queries["buffer:posts"] = [
    {
      _id: "post2",
      revision: 1,
      campaign: "Uncertain",
      channelId,
      text: "Unknown outcome",
      mode: "addToQueue",
      status: "unknown",
    },
  ];
  await act(async () => root.render(<BufferMarketing />));
  expect(host.textContent).not.toContain("Create replacement draft");
});
test("uncertain submissions have no retry button and real zero metrics remain visible", async () => {
  mocks.queries["buffer:posts"] = [
    {
      _id: "post1",
      revision: 1,
      campaign: "Launch",
      channelId,
      text: "Submitted",
      mode: "addToQueue",
      status: "unknown",
    },
  ];
  mocks.queries["buffer:reports"] = [
    {
      connectionId: "connection1",
      organizationId,
      channelIds: [channelId],
      startAt: 1,
      endAt: 2,
      metricsUpdatedAt: null,
      metrics: [{ type: "comments", name: "Comments", value: 0, unit: "count" }],
    },
  ];
  await act(async () => root.render(<BufferMarketing />));
  expect(host.querySelector("dd")?.textContent).toBe("0");
  expect(host.textContent).toContain("Check your queue in Buffer before creating a replacement");
  expect(host.textContent).not.toContain("Approve and schedule");
  expect(host.textContent).not.toContain("Retry submission");
});
test("the callback completes once and clears the receipt from browser history", async () => {
  window.history.replaceState(null, "", `/connect-buffer?complete=${"a".repeat(43)}`);
  await act(async () => root.render(<ConnectBufferPage />));
  await act(async () => root.render(<ConnectBufferPage />));
  expect(mocks.calls["buffer:completeConnect"]).toHaveBeenCalledExactlyOnceWith({
    receipt: "a".repeat(43),
  });
  expect(window.location.search).toBe("");
  expect(mocks.calls["bufferActions:startConnect"]).not.toHaveBeenCalled();
});
test("channel selection works while unsupported background reporting stays disabled", async () => {
  await act(async () => root.render(<ConnectBufferPage />));
  expect(mocks.calls["buffer:selectChannels"]).not.toHaveBeenCalled();
  const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(boxes[0]?.checked).toBe(true);
  expect(boxes[1]?.checked).toBe(false);
  expect(boxes[1]?.disabled).toBe(true);
  await act(async () => boxes[1]!.click());
  await act(async () => button("Save channel selection").click());
  expect(mocks.calls["buffer:selectChannels"]).toHaveBeenCalledExactlyOnceWith({
    channelIds: [channelId],
    dailyReports: false,
  });
});

test("engagement controls explain the provider restriction and never request a report", async () => {
  await act(async () => root.render(<BufferMarketing />));
  expect(host.textContent).toContain("Buffer does not currently allow engagement reports");
  expect(button("Refresh engagement report").disabled).toBe(true);
  await act(async () => button("Refresh engagement report").click());
  expect(mocks.calls["bufferActions:refreshReport"]).not.toHaveBeenCalled();
});
