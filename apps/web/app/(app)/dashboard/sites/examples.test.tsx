// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPresenceExample,
  examplePresentationHtml,
  isPresenceExampleId,
  PRESENCE_EXAMPLES,
} from "./examples";
import { PresenceExampleViewer } from "./PresenceExampleViewer";

const mocks = vi.hoisted(() => ({ start: vi.fn(), push: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("convex/react", () => ({ useAction: () => mocks.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
const mounted: { root: ReturnType<typeof createRoot>; host: HTMLDivElement }[] = [];
beforeEach(() => {
  mocks.start.mockReset().mockResolvedValue({ threadId: "new-thread" });
  mocks.push.mockReset();
});
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});
async function mount(id: "studio" | "retreat" | "homeware") {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => root.render(<PresenceExampleViewer exampleId={id} />));
  return host;
}

describe("real renderer examples", () => {
  it("compiles distinct website, landing and shop examples with actual owned fixture media rather than mock HTML", () => {
    const examples = PRESENCE_EXAMPLES.map(({ id }) => buildPresenceExample(id));
    expect(examples.map(({ document }) => document.kind)).toEqual([
      "site",
      "landing",
      "storefront",
    ]);
    expect(examples.map(({ designProfile }) => designProfile.surfaceStyle)).toEqual([
      "minimal",
      "glass",
      "clay",
    ]);
    expect(examples.map(({ designProfile }) => designProfile.dials.motion)).toEqual([6, 6, 6]);
    expect(examples[0]?.pages.map(({ slug }) => slug)).toEqual([
      "home",
      "about",
      "services",
      "contact",
    ]);
    expect(examples[2]?.images).toHaveLength(4);
    for (const example of examples)
      for (const page of example.pages) {
        const rendered = new DOMParser().parseFromString(page.html, "text/html");
        expect(rendered.querySelector('meta[name="generator"]')?.getAttribute("content")).toBe(
          "web-design-renderer-v8",
        );
        expect(rendered.querySelector("style")?.textContent).toContain(
          ".hero h1{animation:pikar-copy-arrive var(--motion-enter)",
        );
        expect(rendered.querySelector("style")?.textContent).toContain(
          "@media(prefers-reduced-motion:no-preference)",
        );
        expect(rendered.querySelector("h1")).not.toBeNull();
        expect(rendered.querySelector("script")).toBeNull();
        expect(rendered.querySelector("footer")?.textContent).toContain("Fictional design example");
      }
    expect(isPresenceExampleId("unowned-path")).toBe(false);
  });

  it("presents only matched code-owned local imagery, blocks submission, and preserves expandable product facts", () => {
    const example = buildPresenceExample("homeware");
    const html = examplePresentationHtml(
      example.pages[0]!.html,
      example.images,
      "https://pikar.test",
    );
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect([...parsed.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
      "https://pikar.test/presence-examples/homeware.webp",
      "https://pikar.test/presence-examples/jug.webp",
      "https://pikar.test/presence-examples/bowl.webp",
      "https://pikar.test/presence-examples/vase.webp",
    ]);
    expect(parsed.querySelectorAll("details")).toHaveLength(3);
    expect(parsed.querySelector("details p")?.textContent).toContain("seafoam ceramic jug");
    expect(
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    ).toContain("form-action 'none'");
    expect(parsed.querySelector("base")?.target).toBe("_blank");
    expect(() => examplePresentationHtml(example.pages[0]!.html, [], "https://pikar.test")).toThrow(
      "EXAMPLE_ASSET_MISMATCH",
    );
    expect(() =>
      examplePresentationHtml(
        example.pages[0]!.html,
        [{ ref: example.images[0]!.ref, path: "https://foreign.test/image.webp" }],
        "https://pikar.test",
      ),
    ).toThrow("EXAMPLE_ASSET_MISMATCH");
  });

  it("lets the reader inspect all website pages and phone width inside an empty sandbox", async () => {
    const host = await mount("studio");
    const page = host.querySelector('select[aria-label="Example page"]') as HTMLSelectElement;
    expect(page.options).toHaveLength(4);
    await act(async () => {
      page.value = "contact";
      page.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const width = host.querySelector('select[aria-label="Example width"]') as HTMLSelectElement;
    await act(async () => {
      width.value = "phone";
      width.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.style.maxWidth).toBe("390px");
    expect(frame.srcdoc).toContain('data-page="contact"');
    expect(frame.srcdoc).toContain("/p/example-studio/contact/forms/contact");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("starts an ordinary business workflow only after the explicit outer action and does not clone fictional claims", async () => {
    const host = await mount("retreat");
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.start.mock.calls[0]?.[0]?.text).toContain("a landing page");
    expect(mocks.start.mock.calls[0]?.[0]?.text).toContain("glass visual style");
    expect(mocks.start.mock.calls[0]?.[0]?.text).toContain(
      "not its fictional content, products or prices",
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/dashboard/workspace?thread=new-thread&label=Your%20website",
    );
  });
});
