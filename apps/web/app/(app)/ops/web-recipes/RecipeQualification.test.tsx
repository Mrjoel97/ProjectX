// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { inertRecipePreview } from "./preview";
import RecipeQualification from "./RecipeQualification";

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isLoading: false },
  owner: true,
  families: [] as unknown[],
  queries: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => state.auth,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    state.queries(name, args);
    if (args === "skip") return undefined;
    return name === "owner:viewer" ? { isOwner: state.owner } : state.families;
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
    state.mutate(getFunctionName(ref), args),
}));

const identity = {
  id: "candidate-1",
  version: 4,
  current: true,
  bodyHash: "body-current",
  definitionHash: "definition-current",
  bundleHash: "bundle-current",
  rendererVersion: "renderer-current",
  fields: [{ id: "brandName", label: "Brand name", type: "text", required: true }],
  provenanceReady: true,
  evaluationReady: true,
  browserReady: false,
  staleRun: false,
  run: null,
};
let host: HTMLDivElement;
let root: Root;
const render = async () => {
  await act(async () => root.render(<RecipeQualification />));
};
const button = (text: string) => {
  const found = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
const click = async (text: string) => {
  await act(async () => button(text).click());
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.auth = { isAuthenticated: true, isLoading: false };
  state.owner = true;
  state.families = [
    { recipeId: "business-site", name: "web-recipe-business-site", candidate: { ...identity } },
  ];
  state.queries.mockClear();
  state.mutate.mockReset();
  state.mutate.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("native owner qualification operator", () => {
  test("does not subscribe to private candidate data for a non-owner or anonymous viewer", async () => {
    state.owner = false;
    await render();
    expect(host.textContent).toContain("unavailable");
    expect(
      state.queries.mock.calls.some(([name]) => name === "webRecipes:listQualificationCandidates"),
    ).toBe(false);
    state.auth.isAuthenticated = false;
    state.queries.mockClear();
    await render();
    expect(host.textContent).toContain("unavailable");
    expect(state.queries.mock.calls.every(([, args]) => args === "skip")).toBe(true);
  });
  test("uses actual candidate identity and server revision, retaining inputs and focusing a stale-run error", async () => {
    state.families = [
      {
        recipeId: "business-site",
        name: "web-recipe-business-site",
        candidate: {
          ...identity,
          run: {
            runId: "current-run",
            revision: 7,
            ownedByViewer: true,
            finalizedHash: null,
            lanes: [],
          },
        },
      },
    ];
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    await render();
    state.mutate.mockRejectedValueOnce(new Error("WEB_RECIPE_BROWSER_REVISION_MISMATCH"));
    await click("Open desktop lane");
    expect(state.mutate).toHaveBeenCalledWith("skills:advanceWebRecipeBrowserQualification", {
      candidateId: "candidate-1",
      runId: "current-run",
      revision: 7,
      viewport: "desktop",
    });
    expect(host.querySelector("textarea")?.value).toBe("{}");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("REVISION_MISMATCH");
    expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
    expect(button("Mobile").disabled).toBe(false);
    await click("Mobile");
    expect(button("Open mobile lane").disabled).toBe(true);
  });
  test("finalization only requests independent review and never writes evidence or activation", async () => {
    const lanes = ["desktop", "mobile"].map((viewport) => ({
      viewport,
      outcomes: ["selected", "partial", "refusal", "recovery", "edit", "preview"],
    }));
    state.families = [
      {
        recipeId: "business-site",
        name: "web-recipe-business-site",
        candidate: {
          ...identity,
          run: {
            runId: "complete-run",
            revision: 12,
            ownedByViewer: true,
            finalizedHash: null,
            lanes,
          },
        },
      },
    ];
    state.mutate.mockResolvedValue({
      status: "awaiting_runner_review",
      transcriptHash: "frozen-hash",
    });
    await render();
    await click("Finalize for independent review");
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate).toHaveBeenCalledWith("skills:finalizeWebRecipeBrowserQualification", {
      candidateId: "candidate-1",
      runId: "complete-run",
      revision: 12,
    });
    expect(host.textContent).toContain(
      "Awaiting independent runner review. Transcript frozen-hash",
    );
  });
  test("candidate identity changes reset local results and stale definitions cannot start", async () => {
    await render();
    state.families = [
      {
        recipeId: "business-site",
        name: "web-recipe-business-site",
        candidate: { ...identity, bodyHash: "tampered", current: false },
      },
    ];
    await render();
    expect(button("Begin qualification").disabled).toBe(true);
    expect(host.textContent).toContain("Stale definition");
  });
  test("records the exact preview request and discards a late result after candidate replacement", async () => {
    state.families = [
      {
        recipeId: "business-site",
        name: "web-recipe-business-site",
        candidate: {
          ...identity,
          run: {
            runId: "render-run",
            revision: 1,
            ownedByViewer: true,
            finalizedHash: null,
            lanes: [{ viewport: "desktop", outcomes: ["selected"] }],
          },
        },
      },
    ];
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    let resolvePreview: (result: unknown) => void = () => {
      throw new Error("Preview was not requested");
    };
    state.mutate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    await render();
    await click("Record partial");
    expect(state.mutate).toHaveBeenCalledWith("webRecipes:previewWebRecipeCandidate", {
      candidateId: "candidate-1",
      runId: "render-run",
      revision: 1,
      viewport: "desktop",
      values: {},
    });
    state.families = [
      {
        recipeId: "business-site",
        name: "web-recipe-business-site",
        candidate: { ...identity, id: "candidate-2", version: 5 },
      },
    ];
    await render();
    await act(async () =>
      resolvePreview({
        kind: "rendered",
        outcome: "partial",
        html: "<h1>Old candidate result</h1>",
        artifactHash: "old-artifact",
      }),
    );
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).not.toContain("old-artifact");
    expect(host.textContent).toContain("Candidate v5");
    state.mutate.mockResolvedValueOnce({ runId: "fresh-run" });
    await click("Begin qualification");
    expect(state.mutate).toHaveBeenLastCalledWith("skills:beginWebRecipeBrowserQualification", {
      candidateId: "candidate-2",
    });
  });
  test("preview neutralizes inherited base URLs, network resources, redirects, navigation and forms", () => {
    const html = inertRecipePreview(
      '<html><head><base href="https://outside.example"><meta http-equiv="refresh" content="0;url=https://outside.example"><style>body{background:url(https://outside.example/a)}</style></head><body onload="fetch(1)"><script>fetch(1)</script><a href="/p/site" target="_top">Go</a><form action="https://outside.example"><button formaction="/write">Send</button></form><img src="https://outside.example/a"><iframe src="/private"></iframe></body></html>',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("base,script,iframe")).toBeNull();
    expect(doc.querySelector("meta")?.getAttribute("content")).toContain("default-src 'none'");
    expect(doc.querySelector("meta[http-equiv=refresh]")).toBeNull();
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("body")?.hasAttribute("onload")).toBe(false);
    expect(doc.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(doc.querySelector("form")?.hasAttribute("action")).toBe(false);
    expect(doc.querySelector("button")?.disabled).toBe(true);
  });
  test("renders server observations in an inert frame and clears them when the same candidate gets a new run", async () => {
    const current = {
      ...identity,
      run: {
        runId: "observed-run",
        revision: 1,
        ownedByViewer: true,
        finalizedHash: null,
        lanes: [{ viewport: "desktop", outcomes: ["selected"] }],
      },
    };
    state.families = [
      { recipeId: "business-site", name: "web-recipe-business-site", candidate: current },
    ];
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    state.mutate.mockResolvedValueOnce({
      kind: "rendered",
      outcome: "partial",
      html: '<h1>Server observation</h1><a href="/private">Continue</a>',
      artifactHash: "server-artifact-hash",
    });
    await render();
    await click("Record partial");
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("srcdoc")).toContain("Server observation");
    expect(frame?.getAttribute("srcdoc")).not.toContain('href="/private"');
    expect(host.textContent).toContain("server-artifact-hash");
    state.families = [
      {
        recipeId: "business-site",
        name: "web-recipe-business-site",
        candidate: {
          ...current,
          run: { ...current.run, runId: "replacement-run", revision: 0, lanes: [] },
        },
      },
    ];
    await render();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).not.toContain("server-artifact-hash");
    expect(host.querySelector('[role="status"]')?.textContent).not.toContain("partial recorded");
  });
});
