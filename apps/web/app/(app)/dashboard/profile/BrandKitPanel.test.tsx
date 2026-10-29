// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BrandKitPanel } from "./BrandKitPanel";

const approve = vi.fn();
const discard = vi.fn();
const generate = vi.fn();
const kit = {
  name: "Forma",
  tagline: "Designed for every day",
  audience: "Creators",
  positioning: "Simple essentials",
  voice: ["Clear"],
  palette: [
    { name: "Ink", hex: "#112233" },
    { name: "Paper", hex: "#FFFFFF" },
  ],
  typography: { heading: "Inter", body: "Inter" },
  logoDirection: "Wordmark",
  imagery: "Natural light",
  motion: "Deliberate camera rise",
  examples: ["Make space"],
  prohibitedClaims: [],
};
let draft: { revision: number; reviewHash: string; kit: typeof kit } | null;
vi.mock("convex/react", () => ({
  useQuery: () => ({ revision: 4, draft, active: { revision: 2, kit } }),
  useAction: () => generate,
  useMutation: (ref: never) => (getFunctionName(ref) === "brandKits:approve" ? approve : discard),
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  draft = { revision: 4, reviewHash: "reviewed-four", kit };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = () => act(async () => root.render(createElement(BrandKitPanel)));
const click = (text: string) =>
  act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes(text))
      ?.click(),
  );

test("review renders all brand guidance without approving on display", async () => {
  await render();
  expect(host.textContent).toContain("awaiting your approval");
  expect(host.textContent).toContain("Deliberate camera rise");
  expect(host.textContent).toContain("#112233");
  expect(approve).not.toHaveBeenCalled();
  await click("Approve this brand kit");
  expect(approve).toHaveBeenCalledWith({ revision: 4, reviewHash: "reviewed-four" });
});
test("discard names the draft revision and does not approve it", async () => {
  await render();
  await click("Discard proposal");
  expect(discard).toHaveBeenCalledWith({ revision: 4 });
  expect(approve).not.toHaveBeenCalled();
});
test("a failed approval never reports that the kit was saved", async () => {
  approve.mockRejectedValueOnce(new Error("STALE_REVIEW"));
  await render();
  await click("Approve this brand kit");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("could not be saved");
});
test("an approved kit is visible without a second approve action", async () => {
  draft = null;
  await render();
  expect(host.textContent).toContain("saved in Knowledge Vault");
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Approve this brand kit"),
    ),
  ).toBe(false);
});
