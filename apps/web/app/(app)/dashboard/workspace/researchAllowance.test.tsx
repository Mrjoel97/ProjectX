// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => null,
  useMutation: () => vi.fn(),
  useAction: () => state.send,
}));
vi.mock("@convex-dev/agent/react", () => ({
  useThreadMessages: () => ({ results: [], status: "Exhausted" }),
}));
vi.mock("./IntakeControls", () => ({ IntakeControls: () => null }));

import { ChatPane } from "./ChatPane";

beforeEach(() => {
  state.send.mockReset().mockResolvedValue({ threadId: "thread" });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

function Composer() {
  const [sending, onSending] = useState(false);
  return <ChatPane threadId="thread" sending={sending} onSending={onSending} onThread={() => {}} />;
}

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing test element: ${selector}`);
  return element;
}

test.each([
  6, 2, 0,
])("typed submit carries allowance %i through the real clock hook", async (limit) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Composer />));
    const select = requireElement<HTMLSelectElement>(host, "select");
    expect(select.value).toBe("6");
    expect(Array.from(select.options, (option) => option.value)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(select.options[0]?.textContent).toContain("no page reads");
    expect(select.options[6]?.textContent).toContain("default");
    expect(host.textContent).toContain("including failed reads");
    expect(host.textContent).toContain("separate turns");
    await act(async () => {
      select.value = String(limit);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // A real starter fills the controlled composer; the send hook itself stays unmocked.
    const starter = requireElement<HTMLButtonElement>(host, "fieldset button");
    await act(async () => starter.click());
    const send = requireElement<HTMLButtonElement>(host, 'button[aria-label="Send"]');
    await act(async () => send.click());
    expect(state.send).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread",
      text: starter.textContent,
      maxPageReadAttempts: limit,
      clientContext: { nowMs: expect.any(Number), tz: expect.any(String) },
    });
    expect(select.value).toBe(String(limit));
    expect(requireElement<HTMLTextAreaElement>(host, "textarea").value).toBe("");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
