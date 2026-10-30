import { describe, expect, test } from "vitest";
import {
  closeWorkspaceTab,
  emptyWorkspaceTabs,
  MAX_OPEN_ARTIFACTS,
  reconcileWorkspaceTabs,
  restoreWorkspaceTabs,
  selectWorkspaceTab,
  WORK_TAB,
  workspaceStorageOwner,
} from "./workspaceTabState";

const item = (id: string, createdAt: number) => ({ key: `doc:${id}`, createdAt });
describe("per-chat output navigation", () => {
  test("opens the latest initial output, then new outputs without duplicating a revision", () => {
    let state = reconcileWorkspaceTabs(emptyWorkspaceTabs(), [item("older", 1), item("latest", 2)]);
    expect(state.open).toEqual(["doc:latest"]);
    expect(state.active).toBe("doc:latest");
    state = reconcileWorkspaceTabs(state, [item("new", 3), item("latest", 2), item("older", 1)]);
    expect(state.open).toEqual(["doc:latest", "doc:new"]);
    expect(state.active).toBe("doc:new");
    expect(reconcileWorkspaceTabs(state, [item("new", 3), item("latest", 2)]).open).toEqual(
      state.open,
    );
  });
  test("an explicit older selection sticks while new work becomes an unread background tab", () => {
    let state = reconcileWorkspaceTabs(emptyWorkspaceTabs(), [item("one", 1)]);
    state = selectWorkspaceTab(state, "doc:one");
    state = reconcileWorkspaceTabs(state, [item("two", 2), item("one", 1)]);
    expect(state.active).toBe("doc:one");
    expect(state.unread).toEqual(["doc:two"]);
    state = selectWorkspaceTab(state, "doc:two");
    expect(state.unread).toEqual([]);
  });
  test("loading older history and retrieval references never steals focus or claims new work", () => {
    let state = reconcileWorkspaceTabs(emptyWorkspaceTabs(), [item("latest", 10)]);
    state = reconcileWorkspaceTabs(state, [
      item("latest", 10),
      item("history", 2),
      { key: "source:row:reference", createdAt: 20 },
    ]);
    expect(state.active).toBe("doc:latest");
    expect(state.open).toEqual(["doc:latest"]);
    expect(state.unread).toEqual([]);
    expect(state.latestAt).toBe(10);
  });
  test("closing is a view preference, preserves the choice across refresh and supports reopening", () => {
    let state = reconcileWorkspaceTabs(emptyWorkspaceTabs(), [item("one", 1)]);
    state = closeWorkspaceTab(state, "doc:one");
    expect(state.active).toBe(WORK_TAB);
    state = reconcileWorkspaceTabs(restoreWorkspaceTabs(JSON.stringify(state)), [item("one", 1)]);
    expect(state.open).toEqual([]);
    expect(selectWorkspaceTab(state, "doc:one").open).toEqual(["doc:one"]);
    expect(closeWorkspaceTab(state, WORK_TAB)).toBe(state);
  });
  test("closing a background tab keeps the active artifact; removal never substitutes another file", () => {
    let state = reconcileWorkspaceTabs(emptyWorkspaceTabs(), [item("one", 1)]);
    state = reconcileWorkspaceTabs(state, [item("two", 2), item("one", 1)]);
    expect(closeWorkspaceTab(state, "doc:one").active).toBe("doc:two");
    state = selectWorkspaceTab(state, "doc:two");
    expect(reconcileWorkspaceTabs(state, []).active).toBe(WORK_TAB);
  });
  test("large simultaneous batches bound tab chrome while retaining a deliberate older selection", () => {
    let state = selectWorkspaceTab(emptyWorkspaceTabs(), "doc:held");
    state = { ...state, seen: ["doc:held"], latestAt: 1 };
    state = reconcileWorkspaceTabs(state, [
      item("held", 1),
      ...Array.from({ length: 50 }, (_, i) => item(`new${i}`, i + 2)),
    ]);
    expect(state.open.length).toBeLessThanOrEqual(MAX_OPEN_ARTIFACTS);
    expect(state.open).toContain("doc:held");
    expect(state.active).toBe("doc:held");
  });
  test("restores only bounded opaque references, never labels, bodies or bearer capabilities", () => {
    const raw = JSON.stringify({
      version: 1,
      open: ["doc:valid", "https://storage.example/private", "<script>"],
      active: "https://storage.example/private",
      title: "Confidential",
      url: "secret",
      followLatest: true,
    });
    const result = restoreWorkspaceTabs(raw);
    expect(result.open).toEqual(["doc:valid"]);
    expect(result.active).toBe(WORK_TAB);
    expect(JSON.stringify(result)).not.toMatch(/Confidential|storage\.example|secret|script/);
    expect(restoreWorkspaceTabs("{broken")).toEqual(emptyWorkspaceTabs());
  });
  test("signed-in storage namespaces separate identities and ignore malformed tokens", () => {
    const token = (sub: string) => `header.${btoa(JSON.stringify({ sub }))}.signature`;
    expect(workspaceStorageOwner(token("ownerA|session1"))).toBe("ownerA");
    expect(workspaceStorageOwner(token("ownerB|session2"))).toBe("ownerB");
    expect(workspaceStorageOwner(null)).toBe("anonymous");
  });
});
