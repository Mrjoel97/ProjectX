// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { type WorkspaceOutput, WorkspaceTabs } from "./WorkspaceTabs";
import { emptyWorkspaceTabs, selectWorkspaceTab } from "./workspaceTabState";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  act(() =>
    root.render(
      <WorkspaceTabs
        outputs={outputs}
        state={state}
        onSelect={onSelect}
        onClose={onClose}
        {...props}
      >
        <article>Selected batch content</article>
      </WorkspaceTabs>,
    ),
  );
  return { div, onSelect, onClose };
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
