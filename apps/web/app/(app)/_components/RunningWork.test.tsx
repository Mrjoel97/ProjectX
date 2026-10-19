// @vitest-environment jsdom
import { useQuery } from "convex/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RunningWork } from "./RunningWork";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));

beforeEach(() => vi.mocked(useQuery).mockReset());
const render = () => renderToStaticMarkup(createElement(RunningWork));

describe("RunningWork", () => {
  test("loading and a confirmed empty result render no misleading count", () => {
    vi.mocked(useQuery).mockReturnValue(undefined);
    expect(render()).toBe("");
    vi.mocked(useQuery).mockReturnValue({ items: [], partial: false });
    expect(render()).toBe("");
  });

  test("an empty partial selection stays visible and never claims no work", () => {
    vi.mocked(useQuery).mockReturnValue({ items: [], partial: true });
    const html = render();
    expect(html).toContain("Work status · limited view");
    expect(html).toContain("Showing a limited selection");
    expect(html).not.toMatch(/no work|all complete/i);
  });

  test("each recorded stage has readable copy and routes to its originating surface", () => {
    const stages = ["delivering", "preparing", "rendering", "queued", "processing"];
    const threadId = "thread /?&label=Injected";
    vi.mocked(useQuery).mockReturnValue({
      items: stages.map((stage, index) => ({
        id: String(index),
        threadId: index < 3 ? threadId : null,
        kind: index < 3 ? "memo" : "document",
        stage,
        createdAt: Date.UTC(2026, 8, 10, 12, index),
      })),
      partial: false,
    });
    const html = render();
    for (const label of [
      "Sending",
      "Preparing",
      "Creating media",
      "Waiting to process",
      "Processing document",
    ]) {
      expect(html).toContain(`${label} ·`);
    }
    expect(html).toContain(
      `href="/dashboard/workspace?thread=${encodeURIComponent(threadId)}&amp;label=Work"`,
    );
    expect(html.match(/href="\/dashboard\/vault"/g)).toHaveLength(2);
    expect(html.match(/href="\/dashboard\/workspace\?/g)).toHaveLength(3);
    expect(html).toContain("Work in progress · 5</summary>");
    expect(html).not.toContain("limited selection");
    expect(html).not.toContain("undefined");
  });

  test("truncation qualifies the displayed count and provides a route to more work", () => {
    vi.mocked(useQuery).mockReturnValue({
      items: [{ id: "one", threadId: null, kind: "document", stage: "queued", createdAt: 1 }],
      partial: true,
    });
    const html = render();
    expect(html).toContain("Work in progress · 1 · limited view");
    expect(html).toContain("Open Approvals or the Vault to see more.");
    expect(html).toContain('href="/dashboard/vault"');
  });
});

test("closing hides the current jobs across updates but shows a new job", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const item = { id: "one", threadId: null, stage: "queued", createdAt: 1 };
  try {
    vi.mocked(useQuery).mockReturnValue({ items: [item], partial: false });
    await act(async () => root.render(createElement(RunningWork)));
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Hide work status"]');
    expect(close).not.toBeNull();
    expect(host.textContent).toContain("Jobs continue running");
    await act(async () => close?.click());
    expect(host.innerHTML).toBe("");
    vi.mocked(useQuery).mockReturnValue({
      items: [{ ...item, stage: "processing" }],
      partial: false,
    });
    await act(async () => root.render(createElement(RunningWork)));
    expect(host.innerHTML).toBe("");
    vi.mocked(useQuery).mockReturnValue({ items: [item, { ...item, id: "two" }], partial: false });
    await act(async () => root.render(createElement(RunningWork)));
    expect(host.textContent).toContain("Work in progress · 2");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
