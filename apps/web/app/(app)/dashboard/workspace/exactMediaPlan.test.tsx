// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  exact: null as Record<string, unknown> | null,
  queryError: false,
  search: "",
  calls: [] as { name: string; args: unknown }[],
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    if (args === "skip") return undefined;
    if (name === "plans:byId") {
      if (state.queryError) throw new Error("Invalid plans ID");
      return state.exact;
    }
    if (name === "plans:byThread") return { _id: "latest", kind: "memo", threadId: "thread" };
    return undefined;
  },
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
vi.mock("./useSendCockpitMessage", () => ({ useSendCockpitMessage: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search) }));

import { CanvasPane } from "./MediaCanvas";
import { WorkspaceRoute } from "./WorkspaceRoute";
import { conversationUrl, workspaceView, workspaceViewUrl } from "./workspaceNavigation";

const planId = "p573bm94xqt94mkv299msgcby98e932n";
test("switching conversations clears the exact pin and reloads the selected thread", () => {
  const href = `https://www.pikar-ai.com/dashboard/workspace?thread=old&plan=${planId}&label=Old&view=canvas#test`;
  const next = conversationUrl(href, "new");
  expect(next.searchParams.get("thread")).toBe("new");
  expect(next.searchParams.has("plan")).toBe(false);
  expect(next.searchParams.has("label")).toBe(false);
  expect(next.searchParams.get("view")).toBe("canvas");
  expect(next.hash).toBe("#test");
  expect(conversationUrl(href).searchParams.has("thread")).toBe(false);
});
beforeEach(() => {
  state.calls = [];
  state.queryError = false;
  state.exact = { _id: planId, kind: "media", threadId: "thread", status: "delivering" };
});
test("historical media reads its exact row and assets, never the newest root", () => {
  const html = renderToStaticMarkup(<CanvasPane threadId="thread" planId={planId} />);
  expect(html).toContain("Generate reel");
  expect(state.calls).toContainEqual({ name: "plans:byId", args: { planId } });
  expect(state.calls).toContainEqual({ name: "media:byPlan", args: { planId } });
  expect(state.calls).toContainEqual({ name: "plans:byThread", args: "skip" });
});
test.each([
  null,
  { _id: planId, kind: "media", threadId: "other" },
])("unavailable or wrong-thread exact row cannot fall back", (plan) => {
  state.exact = plan;
  expect(renderToStaticMarkup(<CanvasPane threadId="thread" planId={planId} />)).toContain(
    "unavailable in this conversation",
  );
  expect(state.calls).toContainEqual({ name: "plans:byThread", args: "skip" });
});
test.each([
  "",
  "not-an-id",
  "a".repeat(500),
])("malformed ID %s is rejected before a server request", (badId) => {
  expect(renderToStaticMarkup(<CanvasPane threadId="thread" planId={badId} />)).toContain(
    "link is invalid",
  );
  expect(state.calls.every((call) => call.args === "skip")).toBe(true);
});
test("an exact link requires its conversation; ordinary threads retain latest behavior", () => {
  expect(renderToStaticMarkup(<CanvasPane planId={planId} />)).toContain("link is invalid");
  const html = renderToStaticMarkup(<CanvasPane threadId="thread" />);
  expect(html).toContain("No image or reel in this thread yet");
  expect(state.calls).toContainEqual({ name: "plans:byThread", args: { threadId: "thread" } });
});

test("native ID validation errors stay inside the canvas and never resolve another row", async () => {
  state.queryError = true;
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CanvasPane threadId="thread" planId={"a".repeat(32)} />));
    expect(container.textContent).toContain("This media plan could not be opened");
    expect(
      state.calls
        .filter((call) => call.name === "plans:byThread")
        .every((call) => call.args === "skip"),
    ).toBe(true);
    await act(async () => root.unmount());
  } finally {
    errors.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("an exact row changed to a memo is not represented as historical media", () => {
  state.exact = { _id: planId, kind: "memo", threadId: "thread" };
  expect(renderToStaticMarkup(<CanvasPane threadId="thread" planId={planId} />)).toContain(
    "This plan does not contain an image or reel",
  );
});

test("native search changes update exact selection without remounting, including history back", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const onChange = vi.fn();
  try {
    for (const query of [
      "thread=A&plan=first",
      "thread=B&plan=second",
      "thread=A&plan=first",
      "thread=B",
    ]) {
      state.search = query;
      await act(async () => root.render(<WorkspaceRoute onChange={onChange} />));
      expect(onChange.mock.lastCall?.[0].toString()).toBe(query);
    }
    expect(onChange.mock.calls.map((call) => call[1])).toEqual([true, false, false, false]);
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

test("exact to Work to another conversation stays Work, while back restores the exact canvas", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const observed: { view: string; plan: string | null; thread: string | null }[] = [];
  const onChange = (params: URLSearchParams) =>
    observed.push({
      view: workspaceView(params),
      plan: params.get("plan"),
      thread: params.get("thread"),
    });
  const exact = new URL(
    `https://www.pikar-ai.com/dashboard/workspace?thread=A&plan=${planId}&view=canvas`,
  );
  const work = workspaceViewUrl(exact.href, "work");
  const nextThread = conversationUrl(work.href, "B");
  try {
    for (const url of [exact, work, nextThread, exact]) {
      state.search = url.search.slice(1);
      await act(async () => root.render(<WorkspaceRoute onChange={onChange} />));
    }
    expect(observed).toEqual([
      { view: "canvas", plan: planId, thread: "A" },
      { view: "work", plan: null, thread: "A" },
      { view: "work", plan: null, thread: "B" },
      { view: "canvas", plan: planId, thread: "A" },
    ]);
    expect(workspaceView(new URLSearchParams())).toBe("work");
    expect(workspaceView(new URLSearchParams("view=work"))).toBe("work");
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});
