// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  token: "",
  queries: vi.fn(),
  loadMore: vi.fn(),
  rows: {} as Record<
    string,
    Array<{
      key: string;
      kind: string;
      title: string;
      createdAt: number;
      status: string;
      docId: string;
      mimeType: string;
    }>
  >,
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthToken: () => fixture.token }));
vi.mock("convex/react", () => ({
  usePaginatedQuery: (_ref: unknown, args: { threadId: string; stream: string }) => ({
    results: args.stream === "documents" ? (fixture.rows[args.threadId] ?? []) : [],
    status: "Exhausted",
    loadMore: fixture.loadMore,
  }),
  useQuery: (
    ref: Parameters<typeof getFunctionName>[0],
    args: "skip" | { threadId: string; key?: string; keys?: string[] },
  ) => {
    fixture.queries(getFunctionName(ref), args);
    if (args === "skip") return undefined;
    const rows = fixture.rows[args.threadId] ?? [];
    if (getFunctionName(ref) === "workspaceArtifacts:resolveKeys")
      return rows.filter((item) => args.keys?.includes(item.key));
    if (getFunctionName(ref) === "workspaceArtifacts:resolve") {
      const item = rows.find((row) => row.key === args.key);
      return item ? { kind: "document", item, doc: { _id: item.docId, title: item.title } } : null;
    }
    throw new Error("Unexpected output subscription");
  },
  useMutation: () => {
    throw new Error("Viewing must never mutate or generate");
  },
}));
vi.mock("../artifacts/ArtifactViewer", () => ({
  ArtifactViewer: ({ doc }: { doc: { _id: string } }) => (
    <div data-preview={doc._id}>Selected {doc._id}</div>
  ),
  ArtifactViewerBody: () => <div>Attachment</div>,
}));
vi.mock("./cards", () => ({ CardList: () => <div>Activity</div> }));
vi.mock("./CampaignCollection", () => ({ CampaignCollection: () => <div>Batch</div> }));
vi.mock("./MediaCanvas", () => ({ CanvasPane: () => <div>Storyboard</div> }));

import { ArtifactWorkspace } from "./ArtifactWorkspace";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const documentRow = (id: string, time: number) => ({
  key: `doc:${id}`,
  kind: "document",
  title: id,
  createdAt: time,
  status: "ready",
  docId: id,
  mimeType: "application/pdf",
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.token = `h.${btoa(JSON.stringify({ sub: "ownerA|session" }))}.s`;
  fixture.rows = {
    chatA: [documentRow("older", 1), documentRow("latest", 2)],
    chatB: [documentRow("otherchat", 3)],
  };
  fixture.queries.mockClear();
  fixture.loadMore.mockClear();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(threadId = "chatA", planId?: string) {
  await act(async () =>
    root.render(<ArtifactWorkspace threadId={threadId} sending={false} planId={planId} />),
  );
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label || node.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}

test("mounts only the selected preview, keeps deliberate selections and reopens closed tabs", async () => {
  await render();
  expect(host.querySelectorAll("[data-preview]")).toHaveLength(1);
  expect(host.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("latest");
  await click("Browse conversation outputs");
  await click("olderPDF · Ready");
  fixture.rows.chatA = [...(fixture.rows.chatA ?? []), documentRow("new", 4)];
  await render();
  expect(host.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("older");
  expect(host.textContent).toContain("A new output is available");
  await click("Open latest");
  expect(host.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("new");
  await click("Close tab: new");
  await click("Browse conversation outputs");
  await click("newPDF · Ready");
  expect(host.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("new");
  const stored = sessionStorage.getItem("pikar.artifact-tabs.v1:ownerA:chatA");
  expect(stored).toContain("doc:new");
  expect(stored).not.toContain("https:");
});

test("chat and account switches revalidate selections and never reuse another preview", async () => {
  await render();
  await render("chatB");
  expect(host.querySelector("[data-preview]")?.getAttribute("data-preview")).toBe("otherchat");
  fixture.token = `h.${btoa(JSON.stringify({ sub: "ownerB|session" }))}.s`;
  fixture.rows.chatB = [];
  await render("chatB");
  expect(host.querySelector("[data-preview]")).toBeNull();
  expect(sessionStorage.getItem("pikar.artifact-tabs.v1:ownerB:chatB")).not.toContain("otherchat");
  expect(
    fixture.queries.mock.calls
      .filter(([name, args]) => name === "workspaceArtifacts:resolve" && args !== "skip")
      .at(-1)?.[1],
  ).toMatchObject({ threadId: "chatB" });
});

test("a missing exact plan does not fall back to a different output; expansion restores scrolling", async () => {
  await render("chatA", "missing");
  expect(host.querySelector("[data-preview]")).toBeNull();
  expect(host.textContent).toContain("unavailable in this conversation");
  await click("Expand workspace");
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.body.style.overflow).toBe("");
  expect(host.querySelector('[aria-modal="true"]')).toBeNull();
});

test("an empty exact plan link mounts no inventory or selected preview", async () => {
  await render("chatA", "");
  expect(host.textContent).toContain("production plan link is invalid");
  expect(host.querySelector("[data-preview]")).toBeNull();
  expect(fixture.queries).not.toHaveBeenCalled();
});
