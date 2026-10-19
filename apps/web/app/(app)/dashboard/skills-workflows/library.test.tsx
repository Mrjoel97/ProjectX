// @vitest-environment jsdom
import { api } from "@pikar/backend/api";
import { type FunctionReference, getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: false,
  start: vi.fn(),
  off: vi.fn(),
  rollback: vi.fn(),
  publish: vi.fn(),
  push: vi.fn(),
  queries: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => state.queries(ref, args),
  useAction: () => state.start,
  useMutation: (ref: unknown) =>
    getFunctionName(ref as FunctionReference<"mutation">) ===
    getFunctionName(api.skills.publishUserCandidate)
      ? state.publish
      : getFunctionName(ref as FunctionReference<"mutation">) ===
          getFunctionName(api.skills.deactivatePack)
        ? state.off
        : state.rollback,
}));

import Page from "./page";

const pack = {
  packId: "business-pulse",
  title: "Business pulse",
  blurb: "Review your business",
  opener: "Review my business.",
  version: 2,
  output: "briefing",
  sources: [],
  missingKnownCount: 0,
  missingRuntimeCount: 0,
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.owner = false;
  for (const mock of [
    state.start,
    state.off,
    state.rollback,
    state.publish,
    state.push,
    state.queries,
  ])
    mock.mockReset();
  state.start.mockResolvedValue({ threadId: "thread /?&" });
  state.off.mockResolvedValue({});
  state.rollback.mockResolvedValue({});
  state.queries.mockImplementation((ref, args) => {
    if (getFunctionName(ref as FunctionReference<"query">) === getFunctionName(api.owner.viewer))
      return { isOwner: state.owner };
    if (args === "skip") return undefined;
    if (
      getFunctionName(ref as FunctionReference<"query">) ===
      getFunctionName(api.workflowPackDiscovery.listPacks)
    )
      return [pack];
    if (
      getFunctionName(ref as FunctionReference<"query">) ===
      getFunctionName(api.workflowPackDiscovery.listPackCandidates)
    )
      return [{ ...pack, version: 7 }];
    if (
      getFunctionName(ref as FunctionReference<"query">) ===
      getFunctionName(api.workflowPackDiscovery.listPackPriorVersions)
    )
      return [{ packId: pack.packId, version: 1 }];
    if (
      getFunctionName(ref as FunctionReference<"query">) ===
      getFunctionName(api.skills.myUserSkills)
    )
      return [
        {
          name: "offer-architect",
          label: "Offer",
          version: 3,
          author: "agent",
          status: "candidate",
          gatePassed: false,
          authoredBody: "Use my business context.",
        },
      ];
    return undefined;
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<Page />));
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button?.click());
}
test("tenant library shows live offers and its own agent drafts, skipping owner reads and authoring", async () => {
  await render();
  expect(host.textContent).toContain("Business pulse");
  expect(state.queries).toHaveBeenCalledWith(api.workflowPackDiscovery.listPackCandidates, "skip");
  expect(state.queries).toHaveBeenCalledWith(
    api.workflowPackDiscovery.listPackPriorVersions,
    "skip",
  );
  expect(host.querySelector("details")).toBeNull();
  await click('[role="tab"]#skills-tab');
  expect(host.querySelector("#skills-panel")?.hasAttribute("hidden")).toBe(false);
  expect(host.querySelector("#workflows-panel")?.hasAttribute("hidden")).toBe(true);
  expect(host.textContent).toContain("Authored with Executive");
  expect(host.textContent).toContain("Draft saved");
  expect(host.querySelector("textarea")).toBeNull();
});
test("starting an active offer opens its exact returned thread without a candidate version", async () => {
  await render();
  await click('button[aria-label="Start Business pulse"]');
  expect(state.start).toHaveBeenCalledExactlyOnceWith({ packId: pack.packId, text: pack.opener });
  expect(state.push).toHaveBeenCalledExactlyOnceWith(
    "/dashboard/workspace?thread=thread%20%2F%3F%26&label=Business%20pulse",
  );
});
test("a refused start stays in the library and recovers on retry", async () => {
  state.start.mockRejectedValueOnce(new Error("refused"));
  await render();
  await click('button[aria-label="Start Business pulse"]');
  expect(host.querySelector('[role="status"]')?.textContent).toContain("could not be started");
  expect(host.textContent).not.toContain("Nothing ran");
  expect(state.push).not.toHaveBeenCalled();
  await click('button[aria-label="Start Business pulse"]');
  expect(state.push).toHaveBeenCalledTimes(1);
});
test("owner preview pins the displayed candidate, and draft entry is visible", async () => {
  state.owner = true;
  await render();
  await click('button[aria-label="Preview Business pulse"]');
  expect(state.start).toHaveBeenCalledExactlyOnceWith({
    packId: pack.packId,
    text: pack.opener,
    previewVersion: 7,
  });
  await click("#skills-tab");
  expect(host.querySelector("textarea")).not.toBeNull();
  expect(host.textContent).not.toContain("Activate");
});
test("owner lifecycle failures remain explicit, and rollback uses the displayed prior version", async () => {
  state.owner = true;
  state.off.mockRejectedValueOnce(new Error("refused"));
  await render();
  await click('button[aria-label="Turn off Business pulse"]');
  expect(host.querySelector('[role="status"]')?.textContent).toContain("could not be turned off");
  expect(state.off).toHaveBeenCalledExactlyOnceWith({ name: "pack-business-pulse" });
  await click('button[aria-label="Roll back Business pulse to v1"]');
  expect(state.rollback).toHaveBeenCalledExactlyOnceWith({
    name: "pack-business-pulse",
    version: 1,
  });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("back on v1");
});

test("editing a skill draft survives rejection and recovers without publishing live", async () => {
  state.owner = true;
  state.publish
    .mockRejectedValueOnce(new Error("refused"))
    .mockResolvedValueOnce({ inserted: true, version: 4 });
  await render();
  await click("#skills-tab");
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
  expect(textarea).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(textarea, "Only offer our approved services.");
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Save as draft",
  );
  expect(save?.disabled).toBe(false);
  await act(async () => save?.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("could not be saved");
  expect(textarea?.value).toBe("Only offer our approved services.");
  await act(async () => save?.click());
  expect(state.publish).toHaveBeenLastCalledWith({
    name: expect.any(String),
    authoredBody: "Only offer our approved services.",
  });
  expect(textarea?.value).toBe("");
  expect(host.textContent).toContain("Saved as version 4. It is a draft");
  expect(state.rollback).not.toHaveBeenCalled();
});
