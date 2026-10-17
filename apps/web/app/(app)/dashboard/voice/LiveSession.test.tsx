// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { LiveSession } from "./LiveSession";
import type { VoiceSession } from "./useVoiceSession";

vi.mock("./DocStrip", () => ({ DocStrip: () => null }));
test("repeated Enter queues one command and preserves newer text while awaiting acknowledgement", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: (value: boolean) => void;
  const sendText = vi.fn(
    () =>
      new Promise<boolean>((r) => {
        resolve = r;
      }),
  );
  const session: VoiceSession = {
    status: "live",
    transcript: [],
    speaking: null,
    remainingMs: 300000,
    nearingCap: false,
    error: null,
    sessionId: null,
    start: vi.fn(),
    end: vi.fn(),
    reconnect: vi.fn(),
    sendText,
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LiveSession session={session} />));
    const input = host.querySelector("input");
    const form = host.querySelector("form");
    const send = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!input || !form || !setter) throw new Error("Text form missing");
    await act(async () => {
      setter.call(input, "First answer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(sendText).toHaveBeenCalledExactlyOnceWith("First answer");
    expect(send.disabled).toBe(true);
    await act(async () => {
      setter.call(input, "Next answer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => resolve(true));
    expect(input.value).toBe("Next answer");
    expect(send.disabled).toBe(false);
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(async () => resolve(false));
    expect(input.value).toBe("Next answer");
    expect(send.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
