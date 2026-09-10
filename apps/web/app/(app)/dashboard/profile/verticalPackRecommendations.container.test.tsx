// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VerticalPackRecommendations } from "./VerticalPackRecommendations";

const start = vi.fn();
const disable = vi.fn();
let disabled = false;
let available = true;
let loading = false;
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => {
    expect(getFunctionName(ref)).toBe("verticalPacks:discover");
    if (loading) return undefined;
    return {
      recommendations: disabled
        ? []
        : [
            {
              id: "engineering",
              workflowId: "engineering-runbook-review",
              state: available ? "available" : "blocked",
              reason: available ? "confirmed-repeat-workflow" : "review-required",
              missingSources: [],
            },
          ],
      controls: [{ id: "engineering", disabled }],
      partialHistory: false,
    };
  },
  useAction: (ref: never) => {
    expect(getFunctionName(ref)).toBe("cockpit:startVerticalPack");
    return start;
  },
  useMutation: (ref: never) => {
    expect(getFunctionName(ref)).toBe("verticalPacks:setDisabled");
    return disable;
  },
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  disabled = false;
  available = true;
  loading = false;
  start.mockReset();
  disable.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async () => act(async () => root.render(createElement(VerticalPackRecommendations)));
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
};

test("the accessible loading signal settles even when discovery is empty", async () => {
  loading = true;
  await render();
  expect(
    host.querySelector('section[aria-label="Workflow preferences"]')?.getAttribute("aria-busy"),
  ).toBe("true");
  disabled = true;
  loading = false;
  await render();
  expect(
    host.querySelector('section[aria-label="Workflow preferences"]')?.getAttribute("aria-busy"),
  ).toBe("false");
  expect(host.textContent).not.toContain("Start workflow");
});

test("a start calls the server with the selected id, and a stale refusal does not navigate", async () => {
  start.mockResolvedValue({ ok: false, reason: "disabled" });
  await render();
  await click("Start workflow");
  expect(start).toHaveBeenCalledOnce();
  expect(start.mock.calls[0]?.[0]).toEqual({
    verticalId: "engineering",
    text: expect.stringContaining("recorded evidence"),
  });
  expect(start.mock.calls[0]?.[0]).not.toHaveProperty("previewVersion");
  expect(host.textContent).toContain("no longer ready to start");
});

test("an uncertain action failure does not claim no work ran", async () => {
  start.mockRejectedValue(new Error("network"));
  await render();
  await click("Start workflow");
  expect(host.textContent).toContain("Check your workspace before trying again");
  expect(host.textContent).not.toContain("Nothing ran");
});

test("turning off and restoring a suggestion uses the same server preference", async () => {
  disable.mockImplementation(async (args: { disabled: boolean }) => {
    disabled = args.disabled;
  });
  await render();
  await click("Turn off this suggestion");
  expect(disable).toHaveBeenLastCalledWith({ verticalId: "engineering", disabled: true });
  expect(host.textContent).not.toContain("Start workflow");
  expect(host.textContent).toContain("saved documents remain");
  await click("Restore suggestion");
  expect(disable).toHaveBeenLastCalledWith({ verticalId: "engineering", disabled: false });
  expect(host.textContent).toContain("Start workflow");
  expect(start).not.toHaveBeenCalled();
});

test("blocked requirements never render a start control", async () => {
  available = false;
  await render();
  expect(host.textContent).toContain("Confirm who will review");
  expect(host.textContent).not.toContain("Start workflow");
  expect(start).not.toHaveBeenCalled();
});
