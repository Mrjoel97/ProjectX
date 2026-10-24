// @vitest-environment jsdom
import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  view: undefined as ReturnType<typeof initial> | null | undefined,
  begin: vi.fn(),
  save: vi.fn(),
  defer: vi.fn(),
  confirm: vi.fn(),
  continue: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.view,
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref);
    if (name === "serviceConversations:begin") return state.begin;
    if (name === "serviceConversations:save") return state.save;
    if (name === "serviceConversations:defer") return state.defer;
    if (name === "serviceConversations:confirm") return state.confirm;
    throw new Error(`Unexpected mutation ${name}`);
  },
  useAction: () => state.continue,
}));

import { ServiceKnowledgeConversation } from "./ServiceKnowledgeConversation";

function initial() {
  return {
    serviceId: "social-marketing",
    goal: "Bring local customers to the shop.",
    revision: 2,
    controlRevision: 5,
    conversationRevision: 0,
    state: "collecting",
    needsRebind: false,
    canConfirm: false,
    reviewHash: "a".repeat(64),
    budgetLimitCents: 100,
    nextQuestion: question(),
    answers: [] as {
      key: string;
      value: string;
      origin: string;
      sourceRef: string | null;
      sourceHash: string | null;
      confirmedAt: number | null;
      sourceState?: string;
    }[],
    launchState: null as string | null,
    launchRunId: null,
  };
}
function question(): { key: string; question: string; why: string; reason: string } | null {
  return {
    key: "brandVoice",
    question: "How should your business sound?",
    why: "So your drafts sound like you.",
    reason: "missing",
  };
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.view = initial();
  for (const fn of [state.begin, state.save, state.defer, state.confirm, state.continue])
    fn.mockReset();
  state.begin.mockImplementation(async () => ({ ...state.view, conversationRevision: 1 }));
  state.save.mockResolvedValue({});
  state.defer.mockResolvedValue({});
  state.confirm.mockResolvedValue({});
  state.continue.mockResolvedValue({ launch: { state: "started", runId: "run" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (inbox = false) => {
  await act(async () =>
    root.render(<ServiceKnowledgeConversation budgetLimitCents={100} inbox={inbox} />),
  );
};
const click = async (text: string) => {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(`Missing ${text}`);
  await act(async () => button.click());
};
const enter = async (value: string) => {
  const input = host.querySelector("textarea");
  if (!input) throw new Error("Missing answer");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("shows one contextual question without creating state, confirming or starting work on render", async () => {
  await render();
  expect(host.textContent).toContain("How should your business sound?");
  expect(host.querySelectorAll("textarea")).toHaveLength(1);
  for (const fn of [state.begin, state.save, state.confirm, state.continue])
    expect(fn).not.toHaveBeenCalled();
});
test("the first answer starts a durable conversation and saves a draft against its returned revision", async () => {
  await render();
  await enter("Warm, clear and helpful.");
  await click("Continue");
  expect(state.begin).toHaveBeenCalledWith({
    serviceId: "social-marketing",
    expectedRevision: 2,
    expectedControlRevision: 5,
    expectedConversationRevision: 0,
  });
  expect(state.save).toHaveBeenCalledWith({
    serviceId: "social-marketing",
    expectedRevision: 2,
    expectedControlRevision: 5,
    expectedConversationRevision: 1,
    key: "brandVoice",
    value: "Warm, clear and helpful.",
  });
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.continue).not.toHaveBeenCalled();
});
test("a refused save keeps the user's answer editable", async () => {
  state.save.mockRejectedValue(new Error("SERVICE_CONVERSATION_STALE"));
  await render();
  await enter("Avoid extravagant claims.");
  await click("Continue");
  expect(host.querySelector("textarea")?.value).toBe("Avoid extravagant claims.");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("answer is kept");
});
test("deferring preserves the conversation and cannot launch a service", async () => {
  await render();
  await click("Finish this later");
  expect(state.defer).toHaveBeenCalledWith(
    expect.objectContaining({ expectedConversationRevision: 1 }),
  );
  expect(state.continue).not.toHaveBeenCalled();
});
test("the reviewed exact snapshot is confirmed and continued only after an explicit click", async () => {
  state.view = {
    ...initial(),
    conversationRevision: 4,
    state: "review",
    nextQuestion: null,
    canConfirm: true,
    answers: [
      {
        key: "brandVoice",
        value: "Warm and honest.",
        origin: "draft",
        sourceRef: null,
        sourceHash: null,
        confirmedAt: null,
      },
    ],
  };
  await render();
  expect(state.continue).not.toHaveBeenCalled();
  expect(host.textContent).toContain("$1.00");
  await click("Confirm and let Pikar prepare");
  expect(state.continue).toHaveBeenCalledWith({
    serviceId: "social-marketing",
    expectedRevision: 2,
    expectedControlRevision: 5,
    expectedConversationRevision: 4,
    reviewHash: "a".repeat(64),
  });
  expect(host.textContent).toContain("Pikar is preparing");
});
test("a failed continuation preserves confirmed information and never claims work started", async () => {
  state.view = {
    ...initial(),
    conversationRevision: 4,
    state: "review",
    nextQuestion: null,
    canConfirm: true,
  };
  state.continue.mockResolvedValue({ launch: { state: "resume_required", runId: null } });
  await render();
  await click("Confirm and let Pikar prepare");
  expect(host.textContent).toContain("Work has not been confirmed as started");
  expect(host.textContent).not.toContain("Pikar is preparing");
});
test("an empty workspace and deferred conversation have no persistent intake panel", async () => {
  state.view = null;
  await render(true);
  expect(host.textContent).toBe("");
  state.view = { ...initial(), conversationRevision: 2, state: "deferred" };
  await render(true);
  expect(host.textContent).toBe("");
});
test("a changed saved source is shown as needing confirmation", async () => {
  state.view = {
    ...initial(),
    answers: [
      {
        key: "offering",
        value: "Old offer",
        origin: "existing",
        sourceRef: "profile:old",
        sourceHash: "b".repeat(64),
        confirmedAt: 1,
        sourceState: "changed",
      },
    ],
  };
  await render();
  expect(host.textContent).toContain("Saved source changed or needs confirmation");
  expect(host.textContent).not.toContain("Previously confirmed information");
});
test("a changed service setup offers an explicit review before continuing", async () => {
  state.view = { ...initial(), conversationRevision: 3, needsRebind: true };
  await render();
  expect(state.begin).not.toHaveBeenCalled();
  await click("Review changed setup");
  expect(state.begin).toHaveBeenCalledWith({
    serviceId: "social-marketing",
    expectedRevision: 2,
    expectedControlRevision: 5,
    expectedConversationRevision: 3,
  });
});
test("a live question update cannot silently move an unsent answer to another business field", async () => {
  await render();
  await enter("Warm and clear.");
  state.view = {
    ...initial(),
    conversationRevision: 2,
    nextQuestion: {
      key: "publishingBoundaries",
      question: "What should Pikar avoid?",
      why: "Keep content within your rules.",
      reason: "missing",
    },
  };
  await render();
  expect(host.textContent).toContain("How should your business sound?");
  await click("Continue");
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      key: "brandVoice",
      value: "Warm and clear.",
      expectedConversationRevision: 2,
    }),
  );
});
