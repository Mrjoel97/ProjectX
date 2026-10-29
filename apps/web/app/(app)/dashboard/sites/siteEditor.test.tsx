// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: undefined as Record<string, unknown> | null | undefined,
  versions: [] as {
    _id: string;
    version: number;
    contentHash: string;
    document: { pages: { slug: string }[] };
    assetSnapshots?: { assetRef: string }[];
    requiresProviderReview?: boolean;
    providerReceipt?: { runRef: string };
    browserQualityReady?: boolean;
    browserReview?: { status: "passed" | "failed" };
    browserReviewJob?: { state: "running" | "captured" | "completed" | "failed"; reason?: string };
  }[],
  calls: [] as { name: string; args: unknown }[],
  queries: [] as { name: string; args: unknown }[],
  results: [] as unknown[],
  fail: false,
  forceSession: false,
  session: undefined as unknown,
  warningsByVersion: {} as Record<number, { code: string }[]>,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: { version?: number } | "skip") => {
    const name = getFunctionName(ref);
    state.queries.push({ name, args });
    if (args === "skip") return undefined;
    if (name === "webProjects:getProject") return state.project;
    if (name === "webProjects:getVersion")
      return state.versions.find((item) => item.version === args.version) ?? null;
    if (name === "webProjects:listVersions") return state.versions;
    if (name === "onlinePresence:sessionForProject") {
      if (state.forceSession) return state.session;
      const exact = state.versions.find((item) => item.version === args.version);
      return exact
        ? {
            threadId: "website conversation",
            version: exact.version,
            contentHash: exact.contentHash,
            sourceWarnings: state.warningsByVersion[exact.version] ?? [],
          }
        : null;
    }
    throw new Error(`Unexpected review query ${name}`);
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return async (args: unknown) => {
      state.calls.push({ name, args });
      if (state.fail) throw new Error("Unconfirmed network result");
      return state.results.length ? state.results.shift() : { ok: true };
    };
  },
}));
vi.mock("./preview/PreviewCanvas", () => ({
  PreviewCanvas: ({
    projectId,
    version,
    onReadinessChange,
  }: {
    projectId: string;
    version: number;
    onReadinessChange?: (ready: boolean) => void;
  }) => (
    <div data-testid="exact-preview" data-project={projectId} data-version={version}>
      <button type="button" onClick={() => onReadinessChange?.(true)}>
        Finish image preview
      </button>
    </div>
  ),
}));

import { SiteEditor } from "./SiteEditor";

const hash = (version: number) => `sha256:${String(version).repeat(64)}`;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.project = {
    _id: "project-one",
    title: "Acme",
    kind: "site",
    slug: "acme",
    draftVersion: 3,
    revision: 7,
    publicHost: "sites.example",
  };
  state.versions = [3, 2, 1].map((version) => ({
    _id: `version-${version}`,
    version,
    contentHash: hash(version),
    document: { pages: [{ slug: "home" }] },
  }));
  state.calls = [];
  state.queries = [];
  state.results = [];
  state.fail = false;
  state.forceSession = false;
  state.session = undefined;
  state.warningsByVersion = {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const mount = async (version?: number) => {
  await act(async () => root.render(<SiteEditor projectId="project-one" version={version} />));
};
const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing ${text} button`);
  return found;
};
const click = async (text: string) => {
  await act(async () => button(text).click());
};

describe("human website review controls", () => {
  test("failed automatic review is not shown as indefinitely pending and never exposes internal failure details", async () => {
    state.versions[0]!.requiresProviderReview = true;
    state.versions[0]!.browserReviewJob = { state: "failed", reason: "PRIVATE_WORKER_DETAILS" };
    await mount(3);
    expect(container.textContent).toContain("Automatic visual review could not finish. This version remains private.");
    expect(container.textContent).not.toContain("Visual quality review pending");
    expect(container.textContent).not.toContain("PRIVATE_WORKER_DETAILS");
    expect(button("Approve this version").disabled).toBe(true);
    expect(button("Publish approved version").disabled).toBe(true);
    state.versions[0]!.browserReview = { status: "failed" };
    await mount(3);
    expect(container.textContent).toContain("Design needs refinement");
    expect(container.textContent).not.toContain("Visual review could not finish");
  });

  test.each(["running", "captured"] as const)("%s review shows active checks while approval stays unavailable", async (stateName) => {
    state.versions[0]!.requiresProviderReview = true;
    state.versions[0]!.browserReviewJob = { state: stateName };
    await mount(3);
    expect(container.textContent).toContain("Visual quality review in progress");
    expect(button("Approve this version").disabled).toBe(true);
  });

  test("generated designs cannot be approved or published before the server confirms exact visual evidence", async () => {
    state.versions[0]!.providerReceipt = { runRef: "design-run" };
    state.versions[0]!.browserReview = { status: "passed" };
    await mount(3);
    expect(button("Approve this version").disabled).toBe(true);
    expect(container.textContent).toContain("Visual quality review pending");
    expect(container.textContent).not.toContain("Loading the source information");
    await click("Approve this version");
    expect(state.calls).toEqual([]);
    state.project = { ...state.project, approvedVersion: 3, approvedContentHash: hash(3) };
    await mount(3);
    expect(button("Publish approved version").disabled).toBe(true);
    state.versions[0]!.browserQualityReady = true;
    await mount(3);
    expect(button("Publish approved version").disabled).toBe(false);
    expect(container.textContent).not.toContain("Visual quality review pending");
  });

  test("inherited provider review requirements block new drafts and historical restoration", async () => {
    state.versions[1]!.requiresProviderReview = true;
    state.versions[1]!.browserReview = { status: "failed" };
    await mount(2);
    expect(button("Approve for restoration").disabled).toBe(true);
    expect(container.textContent).toContain("Design needs refinement");
    state.project = { ...state.project, approvedVersion: 2, approvedContentHash: hash(2) };
    await mount(2);
    expect(button("Restore reviewed version").disabled).toBe(true);
    state.versions[1]!.browserQualityReady = true;
    await mount(2);
    expect(button("Restore reviewed version").disabled).toBe(false);
    state.versions[0]!.requiresProviderReview = true;
    await mount(3);
    expect(button("Approve this version").disabled).toBe(true);
  });

  test("saved image loading gates approval and readiness cannot carry into another version", async () => {
    state.versions[0]!.assetSnapshots = [{ assetRef: "prepared-image" }];
    await mount(3);
    expect(button("Approve this version").disabled).toBe(true);
    await click("Finish image preview");
    expect(button("Approve this version").disabled).toBe(false);
    const next = { ...state.versions[0]!, _id: "version-4", version: 4, contentHash: hash(4) };
    state.versions.unshift(next);
    state.project = { ...state.project, draftVersion: 4 };
    await mount(4);
    expect(button("Approve this version").disabled).toBe(true);
  });

  test("loads the pinned version and sends only its exact version/hash for approval", async () => {
    await mount(3);
    expect(
      container.querySelector('[data-testid="exact-preview"]')?.getAttribute("data-version"),
    ).toBe("3");
    expect(state.queries).toContainEqual({
      name: "webProjects:getVersion",
      args: { projectId: "project-one", version: 3 },
    });
    expect(button("Publish approved version").disabled).toBe(true);
    await click("Approve this version");
    expect(state.calls).toEqual([
      {
        name: "webProjects:approveVersion",
        args: { projectId: "project-one", version: 3, contentHash: hash(3) },
      },
    ]);
    expect(button("Publish approved version").disabled).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).not.toContain("JSON");
    expect(container.querySelector('a[href*="workspace"]')?.getAttribute("href")).toContain(
      "thread=website%20conversation",
    );
  });

  test("requires the approved hash and latest version before publishing with the current revision", async () => {
    state.project = { ...state.project, approvedVersion: 3, approvedContentHash: hash(2) };
    await mount(3);
    expect(button("Publish approved version").disabled).toBe(true);
    state.project = { ...state.project, approvedContentHash: hash(3), revision: 8 };
    await mount(3);
    expect(button("Approve this version").disabled).toBe(true);
    await click("Publish approved version");
    expect(state.calls).toEqual([
      {
        name: "webProjects:publishVersion",
        args: { projectId: "project-one", version: 3, contentHash: hash(3), expectedRevision: 8 },
      },
    ]);
    expect(container.querySelector('a[href="https://sites.example/p/acme/home"]')).toBeNull();
    state.project = {
      ...state.project,
      publishedVersion: 3,
      publishedContentHash: hash(3),
      revision: 9,
    };
    await mount(3);
    expect(
      container.querySelector('a[href="https://sites.example/p/acme/home"]')?.textContent,
    ).toBe("Open published website");
    expect(button("Publish approved version").disabled).toBe(true);
  });

  test("updates an already public site and takes it offline using the current revision", async () => {
    state.project = {
      ...state.project,
      approvedVersion: 3,
      approvedContentHash: hash(3),
      publishedVersion: 2,
      publishedContentHash: hash(2),
    };
    await mount(3);
    await click("Publish approved version");
    state.project = {
      ...state.project,
      publishedVersion: 3,
      publishedContentHash: hash(3),
      revision: 8,
    };
    await mount(3);
    await click("Take website offline");
    expect(state.calls).toEqual([
      {
        name: "webProjects:updateVersion",
        args: { projectId: "project-one", version: 3, contentHash: hash(3), expectedRevision: 7 },
      },
      { name: "webProjects:unpublish", args: { projectId: "project-one", expectedRevision: 8 } },
    ]);
  });

  test("keeps historical versions out of normal publish and requires explicit approval before restore", async () => {
    state.project = { ...state.project, publishedVersion: 3, publishedContentHash: hash(3) };
    await mount(2);
    expect(container.textContent).toContain("A newer draft exists");
    expect(button("Approve this version").disabled).toBe(true);
    expect(button("Publish approved version").disabled).toBe(true);
    await click("Approve for restoration");
    expect(state.calls).toEqual([
      {
        name: "webProjects:approveVersion",
        args: { projectId: "project-one", version: 2, contentHash: hash(2) },
      },
    ]);
    state.project = {
      ...state.project,
      approvedVersion: 2,
      approvedContentHash: hash(2),
      revision: 8,
    };
    await mount(2);
    await click("Restore reviewed version");
    expect(state.calls[1]).toEqual({
      name: "webProjects:rollback",
      args: { projectId: "project-one", version: 2, contentHash: hash(2), expectedRevision: 8 },
    });
    expect(button("Publish approved version").disabled).toBe(true);
    expect(
      state.calls.some(
        (call) =>
          call.name.includes("buildOnlinePresenceProject") ||
          call.name.includes("saveOnlinePresenceBrief"),
      ),
    ).toBe(false);
  });

  test("preserves a stale or failed result as unconfirmed without reporting publication", async () => {
    state.project = { ...state.project, approvedVersion: 3, approvedContentHash: hash(3) };
    state.results = [{ ok: false, code: "STALE_REVISION" }];
    await mount(3);
    await click("Publish approved version");
    expect(container.textContent).toContain("That change could not be completed");
    expect(container.textContent).not.toContain("Your website version was published");
    state.fail = true;
    await click("Publish approved version");
    expect(container.textContent).toContain("The result could not be confirmed");
    expect(container.querySelector('a[href="https://sites.example/p/acme/home"]')).toBeNull();
  });

  test("has no review controls for a missing project or unavailable exact version", async () => {
    state.project = undefined;
    await mount();
    expect(container.textContent).toContain("Loading your website version");
    state.project = null;
    await mount(3);
    expect(container.textContent).toContain("This website version is unavailable");
    expect(container.querySelector("button")).toBeNull();
    state.project = { _id: "project-one", draftVersion: 3 };
    await mount(42);
    expect(container.textContent).toContain("This website version is unavailable");
    expect(container.querySelector('[data-testid="exact-preview"]')).toBeNull();
  });

  test("reviews immutable warnings for the selected version instead of borrowing a newer brief", async () => {
    state.warningsByVersion = { 2: [{ code: "private_source" }], 3: [{ code: "planned_source" }] };
    await mount(2);
    expect(state.queries).toContainEqual({
      name: "onlinePresence:sessionForProject",
      args: { projectId: "project-one", version: 2 },
    });
    expect(container.textContent).toContain("This version uses private business material");
    expect(container.textContent).not.toContain("Some source information describes future plans");
    await mount(3);
    expect(container.textContent).toContain("Some source information describes future plans");
    expect(container.textContent).not.toContain("This version uses private business material");
  });

  test("waits for matching source-review metadata before approval, publication or restoration", async () => {
    state.forceSession = true;
    state.session = undefined;
    await mount(3);
    expect(button("Approve this version").disabled).toBe(true);
    await click("Approve this version");
    expect(state.calls).toEqual([]);
    state.session = {
      threadId: "website conversation",
      version: 2,
      contentHash: hash(2),
      sourceWarnings: [{ code: "private_source" }],
    };
    await mount(3);
    expect(button("Approve this version").disabled).toBe(true);
    expect(container.textContent).not.toContain("This version uses private business material");
    state.session = {
      threadId: "website conversation",
      version: 3,
      contentHash: hash(2),
      sourceWarnings: [],
    };
    state.project = { ...state.project, approvedVersion: 3, approvedContentHash: hash(3) };
    await mount(3);
    expect(button("Publish approved version").disabled).toBe(true);
    state.session = undefined;
    await mount(2);
    expect(button("Approve for restoration").disabled).toBe(true);
    state.project = { ...state.project, approvedVersion: 2, approvedContentHash: hash(2) };
    await mount(2);
    expect(button("Restore reviewed version").disabled).toBe(true);
    state.session = null;
    await mount(3);
    expect(button("Approve this version").disabled).toBe(false);
  });
});
