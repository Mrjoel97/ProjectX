// @vitest-environment jsdom

import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import FoundationOnboarding from "./FoundationOnboarding";

const state = vi.hoisted(() => ({
  revision: 1,
  start: vi.fn(),
  sendText: vi.fn().mockResolvedValue(true),
  publish: vi.fn().mockResolvedValue({ docIds: [] }),
  discard: vi.fn().mockResolvedValue(null),
  status: "idle",
  voiceError: null as string | null,
}));
vi.mock("../voice/useVoiceSession", () => ({
  useVoiceSession: () => ({
    status: state.status,
    transcript: [],
    error: state.voiceError,
    start: state.start,
    end: vi.fn(),
    sendText: state.sendText,
  }),
}));
vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: (fn: unknown) =>
    getFunctionName(fn as Parameters<typeof getFunctionName>[0]) === "foundation:publish"
      ? state.publish
      : getFunctionName(fn as Parameters<typeof getFunctionName>[0]) === "foundation:discard"
        ? state.discard
        : vi.fn(),
  useQuery: (fn: unknown) => {
    switch (getFunctionName(fn as Parameters<typeof getFunctionName>[0])) {
      case "foundation:get":
        return {
          revision: state.revision,
          phase: "enrichment",
          profile: {
            name: "Test",
            oneLineDescription: "Repair bikes",
            stage: "",
            offering: "Repairs",
            targetCustomer: "Riders",
            primaryGoals: [],
            knownConstraints: [],
          },
          answers: [],
          reply: "Ready for review",
        };
      case "foundation:review":
        return {
          revision: state.revision,
          reviewHash: `hash_${state.revision}`,
          documents: [
            "Business overview",
            "Offers and customers",
            "Operating model",
            "Sales and delivery process",
            "Goals and metrics",
            "Constraints and decisions",
          ].map((title, i) => ({
            section: String(i),
            title,
            text: `Approved statement ${i}`,
            kind: "document",
          })),
          blueprint: "# Proposed Blueprint",
          previousBlueprint: "# Current Blueprint",
        };
      default:
        return [];
    }
  },
}));
function button(host: HTMLElement, text: string) {
  const found = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(text));
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
afterEach(() => {
  state.revision = 1;
  state.status = "idle";
  state.voiceError = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("only an on-screen approval publishes the exact displayed revision and hash", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FoundationOnboarding />));
    expect(state.publish).not.toHaveBeenCalled();
    await act(async () => button(host, "Review six documents").click());
    expect(host.textContent).toContain("Operating model");
    expect(host.textContent).toContain("Previously approved Blueprint");
    expect(state.publish).not.toHaveBeenCalled();
    await act(async () => button(host, "Approve revision 1").click());
    expect(state.publish).toHaveBeenCalledExactlyOnceWith({ revision: 1, reviewHash: "hash_1" });
  } finally {
    await act(async () => root.unmount());
  }
});

test("a changed revision disables stale approval until a fresh review", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FoundationOnboarding />));
    await act(async () => button(host, "Review six documents").click());
    state.revision = 2;
    await act(async () => root.render(<FoundationOnboarding />));
    expect(button(host, "Approve revision 1").disabled).toBe(true);
    expect(host.textContent).toContain("This draft changed");
    expect(state.publish).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

test("microphone failure leaves typed interview available while foundation is enabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.voiceError = "permission denied";
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FoundationOnboarding voiceEnabled={false} />));
    expect(button(host, "Start voice onboarding").disabled).toBe(true);
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(host.textContent).toContain("continue by typing");
    expect(host.textContent).toContain("Saved revision 1");
  } finally {
    await act(async () => root.unmount());
  }
});

test("foundation disabled retains draft reading and discard without write controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FoundationOnboarding readOnly voiceEnabled={false} />));
    expect(host.textContent).toContain("temporarily read-only");
    expect(host.textContent).toContain("Repair bikes");
    expect(host.textContent).toContain("Operating model");
    expect(host.querySelector("textarea")).toBeNull();
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).toEqual([
      "Discard unpublished progress",
    ]);
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
    await act(async () => button(host, "Discard unpublished progress").click());
    expect(state.discard).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
  } finally {
    await act(async () => root.unmount());
  }
});

async function typeAnswer(host: HTMLElement, value: string) {
  const textarea = host.querySelector("textarea");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!textarea || !setValue) throw new Error("Answer input missing");
  await act(async () => {
    setValue.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}
test("connecting retains typed input until a session can acknowledge it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.status = "connecting";
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FoundationOnboarding />));
    const textarea = await typeAnswer(host, "My draft answer");
    expect(button(host, "Send typed answer").disabled).toBe(true);
    await act(async () => button(host, "Send typed answer").click());
    expect(state.sendText).not.toHaveBeenCalled();
    expect(textarea.value).toBe("My draft answer");
  } finally {
    await act(async () => root.unmount());
  }
});
test("failed voice commands retain the editable answer for retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.status = "live";
  state.sendText.mockResolvedValueOnce(false);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<FoundationOnboarding />));
    const textarea = await typeAnswer(host, "Retain this answer");
    await act(async () => button(host, "Send typed answer").click());
    expect(state.sendText).toHaveBeenCalledWith("Retain this answer");
    expect(textarea.value).toBe("Retain this answer");
    expect(host.textContent).toContain("Your answer was not sent");
    await act(async () => button(host, "Send typed answer").click());
    expect(textarea.value).toBe("");
  } finally {
    await act(async () => root.unmount());
  }
});
