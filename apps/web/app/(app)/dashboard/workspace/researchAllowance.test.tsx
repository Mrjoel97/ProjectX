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
vi.mock("./IntakeControls", () => ({
  IntakeControls: ({ children }: { children: import("react").ReactNode }) => children,
}));

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

test("typed submit uses the bounded server default without a research selector", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Composer />));
    expect(host.querySelector('summary[aria-label="Message tools"]')).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).not.toContain("Research page attempts");
    expect(requireElement<HTMLTextAreaElement>(host, "textarea").rows).toBe(1);
    // A real starter fills the controlled composer; the send hook itself stays unmocked.
    const starter = requireElement<HTMLButtonElement>(host, "fieldset button");
    await act(async () => starter.click());
    const send = requireElement<HTMLButtonElement>(host, 'button[aria-label="Send"]');
    await act(async () => send.click());
    expect(state.send).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread",
      text: starter.textContent,
      clientContext: { nowMs: expect.any(Number), tz: expect.any(String) },
    });
    expect(requireElement<HTMLTextAreaElement>(host, "textarea").value).toBe("");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
