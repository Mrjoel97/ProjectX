// @vitest-environment jsdom
import { materializeWebRecipe } from "@pikar/core/webRecipes";
import { renderWebDocument } from "@pikar/core/webRuntime";
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  exact: null as unknown,
  project: null as unknown,
  qualification: null as unknown,
  search: "",
  calls: [] as { name: string; args: unknown }[],
  previewAsset: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useAction: () => state.previewAsset,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    if (args === "skip") return undefined;
    if (name === "webProjects:getVersion") return state.exact;
    if (name === "webProjects:getProject") return state.project;
    if (name === "webRecipes:getStorefrontQualification") return state.qualification;
    throw new Error(`Unexpected preview query ${name}`);
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search) }));

import { inertPreviewHtml, PreviewCanvas, type PreviewVersion } from "./PreviewCanvas";

const assetRef = `webasset:fixture-image:${"a".repeat(64)}`;
const imageData = "data:image/png;base64,iVBORw0KGgo=";

function savedVersion(version = 4, withMedia = false): PreviewVersion {
  const document = materializeWebRecipe("business-site", {
    brandName: "Acme",
    headline: `Saved version ${version}`,
    services: ["Advice"],
    about: "Our business",
    pageMode: "multi-page",
    projectSlug: "acme",
    ctaLabel: "Inquire",
    ctaHref: "https://inquiry.example/",
    contactConsent: "Contact me about this inquiry.",
    ...(withMedia
      ? { media: { hero: { storageRef: assetRef, alt: "Generated paper study" } } }
      : {}),
  });
  return {
    version,
    contentHash: `sha256:${String(version).repeat(64)}`,
    document,
    artifacts: document.pages.map((page) => {
      const html = renderWebDocument(document, { slug: "acme", page: page.slug });
      return { pageSlug: page.slug, html, byteLength: new TextEncoder().encode(html).byteLength };
    }),
  } as PreviewVersion;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.exact = savedVersion();
  state.project = { _id: "project-one", title: "Acme", kind: "site" };
  state.qualification = null;
  state.search = "";
  state.calls = [];
  state.previewAsset.mockReset();
  state.previewAsset.mockImplementation(async (args: { assetRef: string }) => ({
    assetRef: args.assetRef,
    dataUrl: imageData,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const mount = async (version = 4) => {
  await act(async () => root.render(<PreviewCanvas projectId="project-one" version={version} />));
};
const select = async (label: string, value: string) => {
  const element = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  if (!element) throw new Error(`Missing selector ${label}`);
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("exact stored website preview", () => {
  test("loads private images for the exact version and changes only the inert preview", async () => {
    state.exact = savedVersion(4, true);
    const original = (state.exact as PreviewVersion).artifacts?.[0]?.html;
    await mount();
    expect(state.previewAsset).toHaveBeenCalledWith({
      projectId: "project-one",
      version: 4,
      assetRef,
    });
    const html = container.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelector("img")?.getAttribute("src")).toBe(imageData);
    expect(parsed.querySelector("img")?.getAttribute("alt")).toBe("Generated paper study");
    expect(
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    ).toContain("img-src data:");
    expect((state.exact as PreviewVersion).artifacts?.[0]?.html).toBe(original);
    expect(original).not.toContain(imageData);
    expect(
      inertPreviewHtml(original ?? "", [{ assetRef, dataUrl: "https://private.example/file" }]),
    ).toBeNull();
    expect(inertPreviewHtml(original ?? "", [])).toBeNull();
  });

  test("a missing private image blocks the preview and reports it unready", async () => {
    state.exact = savedVersion(4, true);
    state.previewAsset.mockRejectedValue(new Error("not available"));
    const readiness = vi.fn();
    await act(async () =>
      root.render(
        <PreviewCanvas projectId="project-one" version={4} onReadinessChange={readiness} />,
      ),
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("saved images could not be loaded");
    expect(readiness).toHaveBeenLastCalledWith(false);
  });

  test("a late image response cannot replace another exact version's preview", async () => {
    let resolveOld!: (asset: { assetRef: string; dataUrl: string }) => void;
    state.previewAsset.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    state.exact = savedVersion(4, true);
    await mount();
    state.exact = savedVersion(5, true);
    await mount(5);
    await act(async () => resolveOld({ assetRef, dataUrl: "data:image/png;base64,YQ==" }));
    expect(container.querySelector("iframe")?.title).toContain("version 5");
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain(imageData);
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).not.toContain("base64,YQ==");
  });

  test("selects all four saved pages without loading a public or different version", async () => {
    await mount();
    const exact = state.exact as PreviewVersion;
    for (const page of exact.document.pages) {
      await select("Page to review", page.slug);
      const frame = container.querySelector("iframe");
      expect(frame?.title).toContain(page.title);
      const artifact = exact.artifacts?.find((candidate) => candidate.pageSlug === page.slug);
      expect(frame?.getAttribute("srcdoc")).toBe(inertPreviewHtml(artifact?.html ?? ""));
      expect(frame?.hasAttribute("src")).toBe(false);
    }
    expect(state.calls.filter((call) => call.name === "webProjects:getVersion")).toEqual([
      { name: "webProjects:getVersion", args: { projectId: "project-one", version: 4 } },
    ]);
  });

  test("makes links request blocked popups and forms inert while preserving source and scrolling", async () => {
    const exact = state.exact as PreviewVersion;
    const original = exact.artifacts?.[0]?.html;
    await mount();
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    const rendered = new DOMParser().parseFromString(
      frame?.getAttribute("srcdoc") ?? "",
      "text/html",
    );
    expect(rendered.querySelector("head > base")?.getAttribute("target")).toBe("_blank");
    expect(rendered.querySelector("a")?.getAttribute("href")).toBe("/p/acme/home");
    expect(rendered.querySelector("a[target]")).toBeNull();
    expect(frame?.style.pointerEvents).toBe("");
    expect(exact.artifacts?.[0]?.html).toBe(original);
    expect(original).not.toContain("<base");
    expect(container.textContent).toContain("links and forms are disabled");
  });

  test("offers phone and desktop widths and resets page selection on a new exact pin", async () => {
    await mount();
    await select("Page to review", "contact");
    await select("Preview width", "phone");
    expect(container.querySelector("iframe")?.style.maxWidth).toBe("390px");
    await select("Preview width", "desktop");
    expect(container.querySelector("iframe")?.style.maxWidth).toBe("1120px");
    state.exact = savedVersion(5);
    await mount(5);
    expect(container.querySelector("iframe")?.title).toContain("Saved version 5");
    expect(
      (container.querySelector('select[aria-label="Page to review"]') as HTMLSelectElement).value,
    ).toBe("home");
    expect(container.querySelector("a")?.getAttribute("href")).toContain("version=5");
  });

  test("refuses a missing selected artifact instead of substituting another page or version", async () => {
    const exact = savedVersion();
    state.exact = {
      ...exact,
      artifacts: exact.artifacts?.filter((artifact) => artifact.pageSlug !== "contact"),
    };
    await mount();
    await select("Page to review", "contact");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("No other version has been substituted");
  });

  test("distinguishes loading, absence and a malformed saved artifact", async () => {
    state.exact = undefined;
    await mount();
    expect(container.textContent).toContain("Loading exact version");
    state.exact = null;
    await mount();
    expect(container.textContent).toContain("This version is unavailable");
    expect(inertPreviewHtml("unrendered content")).toBeNull();
  });

  test("qualification URL selects only the owner query and cannot fall back to tenant reads", async () => {
    state.search = "qualification=only";
    state.qualification = {
      project: { ...(state.project as object), kind: "storefront" },
      version: savedVersion(),
    };
    await mount();
    expect(container.textContent).toContain("Qualification only — commerce unavailable");
    expect(state.calls).toContainEqual({ name: "webProjects:getProject", args: "skip" });
    expect(state.calls).toContainEqual({ name: "webProjects:getVersion", args: "skip" });
    expect(state.calls).toContainEqual({
      name: "webRecipes:getStorefrontQualification",
      args: { projectId: "project-one" },
    });
  });
});
