// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WebRecipeQualification } from "./WebRecipeQualification";

const candidate = {
  id: "candidate-1",
  name: "web-recipe-business-site",
  version: 2,
  bodyHash: "b".repeat(64),
  definitionHash: "d".repeat(64),
  provenanceValid: true,
  evalValid: true,
  browserValid: false,
};
let groups: Array<{
  name: string;
  candidate: typeof candidate | null;
  active: typeof candidate | null;
  rollbackTargets: (typeof candidate)[];
}> = [];
let readback: unknown = null;
const mutations = new Map<string, ReturnType<typeof vi.fn>>();
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args: unknown) => {
    const name = getFunctionName(ref);
    return name === "skills:webRecipeCandidatesForReview"
      ? groups
      : name === "webRecipes:getStorefrontQualification" && args !== "skip"
        ? readback
        : null;
  },
  useMutation: (ref: never) => mutations.get(getFunctionName(ref)) ?? vi.fn(),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  groups = [
    { name: candidate.name, candidate: { ...candidate }, active: null, rollbackTargets: [] },
  ];
  readback = null;
  mutations.clear();
  mutations.set(
    "skills:beginWebRecipeBrowserQualification",
    vi.fn().mockResolvedValue({ runId: "run-1", revision: 0 }),
  );
  let revision = 0;
  mutations.set(
    "skills:advanceWebRecipeBrowserQualification",
    vi.fn().mockImplementation(async () => ({ revision: ++revision })),
  );
  mutations.set(
    "webRecipes:previewWebRecipeCandidate",
    vi.fn().mockImplementation(async (args: { values: { brandName: string } }) => {
      const next = ++revision;
      return args.values.brandName.includes("<script>")
        ? { kind: "refusal", revision: next, inputHash: "i".repeat(64) }
        : {
            kind: "rendered",
            outcome: "preview",
            revision: next,
            candidateId: candidate.id,
            bodyHash: candidate.bodyHash,
            inputHash: "i".repeat(64),
            documentHash: "d".repeat(64),
            artifactHash: "a".repeat(64),
            byteLength: 120,
            html: `<html><body><h1>${args.values.brandName}</h1></body></html>`,
          };
    }),
  );
  mutations.set(
    "skills:finalizeWebRecipeBrowserQualification",
    vi.fn().mockResolvedValue({ transcriptHash: "f".repeat(64) }),
  );
  mutations.set("skills:activateWebRecipeCandidate", vi.fn().mockResolvedValue({}));
  mutations.set("skills:rollbackWebRecipe", vi.fn().mockResolvedValue({}));
  mutations.set(
    "webRecipes:qualifyStorefront",
    vi.fn().mockResolvedValue({ projectId: "private-1" }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = async () => act(async () => root.render(createElement(WebRecipeQualification)));
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button?.click());
};
const input = async (label: string, value: string) => {
  const element = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  expect(element).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("owner controls record server observations and render exact HTML in an empty-sandbox iframe", async () => {
  await render();
  expect(host.textContent).toContain("2 of 3 evidence planes pass");
  await click("Start rendered candidate qualification");
  expect(mutations.get("skills:beginWebRecipeBrowserQualification")).toHaveBeenCalledWith({
    candidateId: candidate.id,
  });
  await input("Candidate brand name", "Authored studio");
  await click("Open desktop lane");
  expect(mutations.get("skills:advanceWebRecipeBrowserQualification")).toHaveBeenCalledWith({
    candidateId: candidate.id,
    runId: "run-1",
    revision: 0,
    viewport: "desktop",
  });
  await click("Try allowed partial");
  const firstCall = mutations.get("webRecipes:previewWebRecipeCandidate")?.mock.calls[0]?.[0];
  expect(firstCall).toMatchObject({
    candidateId: candidate.id,
    runId: "run-1",
    revision: 1,
    viewport: "desktop",
    values: { brandName: "Authored studio" },
  });
  expect(firstCall).not.toHaveProperty("outcomeRefs");
  expect(firstCall).not.toHaveProperty("documentHash");
  const frame = host.querySelector("iframe");
  expect(frame?.getAttribute("sandbox")).toBe("");
  expect(frame?.getAttribute("srcdoc")).toContain("Authored studio");
  await click("Try bounded refusal");
  expect(host.textContent).toContain("Bounded input refusal observed");
  expect(host.querySelector("iframe")).toBeNull();
  await click("Render recovery");
  expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Authored studio");
  await input("Candidate brand name", "Edited studio");
  await click("Render changed edit");
  expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Edited studio");
  await click("Preview and read back exact document");
  expect(host.textContent).toContain("document " + "d".repeat(64));
  expect(
    mutations.get("skills:finalizeWebRecipeBrowserQualification")?.mock.calls.length ?? 0,
  ).toBe(0);
  await click("Open mobile lane");
  for (const label of [
    "Try allowed partial",
    "Try bounded refusal",
    "Render recovery",
    "Render changed edit",
    "Preview and read back exact document",
  ])
    await click(label);
  await click("Finalize owner transcript");
  expect(mutations.get("skills:finalizeWebRecipeBrowserQualification")).toHaveBeenCalledWith({
    candidateId: candidate.id,
    runId: "run-1",
    revision: 12,
  });
  expect(host.textContent).toContain("awaiting trusted runner review");
  expect(mutations.get("skills:activateWebRecipeCandidate")).not.toHaveBeenCalled();
});

test("private storefront control uses owner mutation and renders its readback", async () => {
  groups = [
    {
      name: "web-recipe-storefront-catalogue",
      candidate: null,
      active: { ...candidate, name: "web-recipe-storefront-catalogue", version: 2 },
      rollbackTargets: [],
    },
  ];
  await render();
  expect(host.textContent).toContain("Commerce unavailable");
  await click("Create private storefront artifact");
  expect(mutations.get("webRecipes:qualifyStorefront")).toHaveBeenCalledWith(
    expect.objectContaining({
      recipeId: "storefront-catalogue",
      slug: "phase49-private-catalogue",
      expectedAvailability: "private_qualification",
    }),
  );
  readback = {
    project: { _id: "private-1" },
    version: {
      recipeRef: { version: 2, bodyHash: candidate.bodyHash },
      contentHash: "c".repeat(64),
    },
  };
  await render();
  expect(host.querySelector('[data-testid="storefront-readback"]')?.textContent).toContain(
    "private-1",
  );
});

test("an unfinished desktop lane cannot be stranded by opening mobile", async () => {
  await render();
  await click("Start rendered candidate qualification");
  await click("Open desktop lane");
  const mobile = () =>
    [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Open mobile lane",
    );
  expect(mobile()?.disabled).toBe(true);
  expect(host.textContent).toContain("Finish the desktop lane before opening the other viewport.");
  await click("Open mobile lane");
  expect(mutations.get("skills:advanceWebRecipeBrowserQualification")).toHaveBeenCalledTimes(1);
  for (const label of [
    "Try allowed partial",
    "Try bounded refusal",
    "Render recovery",
    "Render changed edit",
    "Preview and read back exact document",
  ])
    await click(label);
  expect(mobile()?.disabled).toBe(false);
  await click("Open mobile lane");
  expect(mutations.get("skills:advanceWebRecipeBrowserQualification")).toHaveBeenCalledTimes(2);
});

test("loaded empty owner review has an explicit empty state", async () => {
  groups = [];
  await render();
  expect(host.textContent).toContain(
    "No web recipe candidates or active versions are available for review.",
  );
  expect(host.querySelectorAll("article")).toHaveLength(0);
});
