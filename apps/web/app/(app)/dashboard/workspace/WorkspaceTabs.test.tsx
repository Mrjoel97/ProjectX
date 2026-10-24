// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type WorkspaceOutput, WorkspaceTabs } from "./WorkspaceTabs";
import { emptyWorkspaceTabs, selectWorkspaceTab } from "./workspaceTabState";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
const outputs: WorkspaceOutput[] = [
  {
    key: "doc:one",
    title: "Sales report",
    kind: "document",
    format: "Workbook",
    status: "Ready",
    createdAt: 1,
  },
  {
    key: "campaign:two",
    title: "Launch assets",
    kind: "campaign",
    format: "Media batch",
    status: "Partly ready",
    createdAt: 2,
  },
];
const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  act(() => {
    for (const root of mounted.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  document.documentElement.scrollTop = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function render(props: Partial<Parameters<typeof WorkspaceTabs>[0]> = {}) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  mounted.push(root);
  const state = {
    ...selectWorkspaceTab(selectWorkspaceTab(emptyWorkspaceTabs(), "doc:one"), "campaign:two"),
    unread: ["doc:one"],
  };
  const onSelect = vi.fn(),
    onClose = vi.fn();
  const rerender = (next: Partial<Parameters<typeof WorkspaceTabs>[0]> = {}) =>
    act(() =>
      root.render(
        <WorkspaceTabs
          outputs={outputs}
          state={state}
          onSelect={onSelect}
          onClose={onClose}
          {...props}
          {...next}
        >
          <article>Selected batch content</article>
        </WorkspaceTabs>,
      ),
    );
  rerender();
  return { div, onSelect, onClose, rerender };
}

/** Controlled layout models clipping and scrolling; jsdom has no layout engine. */
function tabGeometry(initialWidth: number) {
  let width = initialWidth;
  const callbacks = new Set<() => void>();
  const disconnected = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      private readonly resize: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.resize = () => callback([], this);
        callbacks.add(this.resize);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        callbacks.delete(this.resize);
        disconnected();
      }
    },
  );
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("role") === "tablist" ? width : 0;
  });
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("role") === "tablist" ? 440 : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const strip = this.closest('[role="tablist"]');
    const label = this.querySelector('[role="tab"]')?.textContent;
    const offset = label === "Sales report" ? 80 : label === "Launch assets" ? 260 : 0;
    const size = this.getAttribute("role") === "tablist" ? width : label === "Work" ? 80 : 180;
    const left = 100 + (this === strip ? 0 : offset - (strip?.scrollLeft ?? 0));
    return new DOMRect(left, 50, size, 46);
  });
  return {
    resize(next: number) {
      width = next;
      act(() => {
        for (const callback of callbacks) callback();
      });
    },
    disconnected,
    callbacks,
  };
}

function selectedTabBounds(div: HTMLDivElement) {
  const strip = div.querySelector<HTMLElement>('[role="tablist"]');
  const selected = strip?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
  if (!strip || !selected) throw new Error("Expected selected artifact tab and strip");
  return {
    strip,
    selected,
    viewport: strip.getBoundingClientRect(),
    bounds: selected.getBoundingClientRect(),
  };
}
test("artifact tabs have roving keyboard navigation and a separately labelled close control", () => {
  const { div, onSelect, onClose } = render();
  const tabs = div.querySelectorAll<HTMLElement>('[role="tab"]');
  expect(tabs).toHaveLength(3);
  expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");
  act(() =>
    tabs[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  expect(onSelect).toHaveBeenLastCalledWith("doc:one");
  expect(document.activeElement).toBe(tabs[1]);
  act(() => tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  expect(onClose).toHaveBeenCalledWith("doc:one");
  expect(div.querySelectorAll("button button")).toHaveLength(0);
});
test("closed files remain discoverable in the output browser with filtering and explicit earlier paging", () => {
  const onLoadOlder = vi.fn();
  const { div, onSelect } = render({ hasOlder: true, onLoadOlder });
  const browse = div.querySelector<HTMLButtonElement>('[aria-label="Browse conversation outputs"]');
  act(() => browse?.click());
  expect(browse?.getAttribute("aria-expanded")).toBe("true");
  const input = div.querySelector<HTMLInputElement>('[aria-label="Find an output"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Sales");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const library = div.querySelector('[aria-label="All conversation outputs"]');
  expect(library?.textContent).toContain("Sales report");
  expect(library?.textContent).not.toContain("Launch assets");
  const open = Array.from(library?.querySelectorAll("button") ?? []).find((button) =>
    button.textContent?.includes("Sales report"),
  );
  act(() => open?.click());
  expect(onSelect).toHaveBeenCalledWith("doc:one");
  expect(div.querySelector('[aria-label="All conversation outputs"]')).toBeNull();
});
test("new output notice offers one-step access without replacing the selected panel", () => {
  const { div, onSelect } = render();
  expect(div.querySelector('[role="tabpanel"]')?.textContent).toContain("Selected batch content");
  const latest = Array.from(div.querySelectorAll("button")).find(
    (button) => button.textContent === "Open latest",
  );
  act(() => latest?.click());
  expect(onSelect).toHaveBeenCalledWith("doc:one");
});

test("reveals a restored active tab when its metadata mounts after the initial render", () => {
  tabGeometry(220);
  const view = render({ outputs: [] });
  expect(view.div.querySelector('[aria-selected="true"]')).toBeNull();
  view.rerender({ outputs });
  const { strip, viewport, bounds } = selectedTabBounds(view.div);
  expect(strip.scrollLeft).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
  expect(bounds.right).toBeLessThanOrEqual(viewport.right);
});

test("keeps the selected tab visible after strip resize without moving page or reader scroll", () => {
  const geometry = tabGeometry(600);
  const { div } = render();
  const panel = div.querySelector<HTMLElement>('[role="tabpanel"]');
  if (!panel) throw new Error("Expected artifact reader panel");
  panel.scrollTop = 123;
  document.documentElement.scrollTop = 240;
  expect(selectedTabBounds(div).strip.scrollLeft).toBe(0);
  geometry.resize(220);
  const { strip, viewport, bounds } = selectedTabBounds(div);
  expect(strip.scrollLeft).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
  expect(bounds.right).toBeLessThanOrEqual(viewport.right);
  expect(document.documentElement.scrollTop).toBe(240);
  expect(panel.scrollTop).toBe(123);
});

test("aligns the leading label of an oversized tab and releases obsolete resize observers", () => {
  const geometry = tabGeometry(120);
  const view = render();
  const { viewport, bounds } = selectedTabBounds(view.div);
  expect(bounds.left).toBe(viewport.left);
  expect(geometry.callbacks.size).toBe(1);
  view.rerender({ state: selectWorkspaceTab(emptyWorkspaceTabs(), "doc:one") });
  expect(geometry.disconnected).toHaveBeenCalledOnce();
  expect(geometry.callbacks.size).toBe(1);
  expect(view.div.querySelector('[role="tab"]')?.textContent).toBe("Work");
  expect(view.div.querySelector('[aria-label="Close tab: Work"]')).toBeNull();
});
