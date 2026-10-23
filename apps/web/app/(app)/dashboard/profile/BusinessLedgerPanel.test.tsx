// @vitest-environment jsdom

import type { BlueprintLedgerField } from "@pikar/core";
import { type FunctionReference, getFunctionName } from "convex/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Ledger = { blueprintDocId: string | null; fields: BlueprintLedgerField[] };
const state = vi.hoisted(() => ({
  data: undefined as Ledger | undefined,
  query: vi.fn(),
  opened: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (reference: FunctionReference<"query">, args: unknown) => {
    state.query(getFunctionName(reference), args);
    return state.data;
  },
}));
vi.mock("../workspace/cards", () => ({
  VaultDocButton: ({
    docId,
    children,
    style,
  }: {
    docId: string;
    children: ReactNode;
    style: object;
  }) => (
    <button type="button" style={style} data-doc-id={docId} onClick={() => state.opened(docId)}>
      {children}
    </button>
  ),
}));

import { BusinessLedgerPanel } from "./BusinessLedgerPanel";

const field = (changes: Partial<BlueprintLedgerField> = {}): BlueprintLedgerField => ({
  field: "offering",
  label: "Offering",
  values: ["Maua Shop's local delivery service"],
  origin: "stated",
  sourceState: "current",
  sourceDocId: "owned-source",
  sourceHash: "a".repeat(64),
  sourceCreatedAt: Date.parse("2020-01-03T12:00:00Z"),
  originalObservedAt: null,
  firstRecordedAt: Date.parse("2021-02-03T12:00:00Z"),
  reviewedAt: Date.parse("2026-10-23T12:00:00Z"),
  reviewAuditId: "review-ref",
  ...changes,
});
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.data = { blueprintDocId: "owned-blueprint", fields: [field()] };
  state.query.mockReset();
  state.opened.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () => {
  await act(async () => root.render(<BusinessLedgerPanel />));
};
const text = () => host.textContent ?? "";

test("reads the existing native ledger and preserves distinct original source and review clocks", async () => {
  await render();
  expect(state.query).toHaveBeenCalledWith("blueprint:businessLedger", {});
  expect(text()).toContain("Document states");
  expect(text()).toContain("Source available");
  expect(text()).toContain("2020");
  expect(text()).toContain("2021");
  expect(text()).toContain("2026");
  expect(text()).toContain("Document created");
  expect(text()).toContain("Proposal reviewed");
  expect(text()).toContain("Observation timeNot recorded");
});

test("source controls reuse the exact owned document reference without a navigation route", async () => {
  await render();
  const button = host.querySelector("button[data-doc-id]");
  if (!button) throw new Error("missing owned source button");
  expect(button.textContent).toBe("Open source for Offering");
  await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(state.opened).toHaveBeenCalledWith("owned-source");
  expect(host.querySelector("a")).toBeNull();
});

test("derived claims remain agent inference after proposal review", async () => {
  state.data = { blueprintDocId: "owned-blueprint", fields: [field({ origin: "derived" })] };
  await render();
  expect(text()).toContain("Agent inference");
  expect(text()).not.toContain("Document states");
  expect(text()).not.toMatch(/confirmed fact|verified business fact/i);
});

test("changed sources keep the value and permit review of the current owned document", async () => {
  state.data = { blueprintDocId: "owned-blueprint", fields: [field({ sourceState: "changed" })] };
  await render();
  expect(text()).toContain("Source changed — review needed");
  expect(text()).toContain("Maua Shop's local delivery service");
  expect(host.querySelector("button[data-doc-id]")).not.toBeNull();
});

test("source withdrawal removes navigation while retaining the original value and provenance", async () => {
  await render();
  state.data = { blueprintDocId: "owned-blueprint", fields: [field({ sourceState: "withdrawn" })] };
  await render();
  expect(text()).toContain("Source removed");
  expect(text()).toContain("Maua Shop's local delivery service");
  expect(host.querySelector("button[data-doc-id]")).toBeNull();
  expect(text()).toContain("a".repeat(64));
});

test("legacy/unverified metadata never invents timestamps or a clickable source", async () => {
  state.data = {
    blueprintDocId: "old-blueprint",
    fields: [
      field({
        sourceState: "unverified",
        sourceHash: null,
        sourceCreatedAt: null,
        firstRecordedAt: null,
        reviewedAt: null,
        reviewAuditId: null,
      }),
    ],
  };
  await render();
  expect(text()).toContain("Source not verified");
  expect(host.querySelector("button[data-doc-id]")).toBeNull();
  expect(text()).not.toContain("2026");
  expect(text()).not.toContain("2020");
});

test("loading and empty states preserve the section without fabricated values", async () => {
  state.data = undefined;
  await render();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  state.data = { blueprintDocId: null, fields: [] };
  await render();
  expect(text()).toContain("Review a business blueprint");
  expect(host.querySelector("ul")).toBeNull();
});

test("long values and full fingerprints remain readable within a shrinking column", async () => {
  const value = "A deliberately long customer description ".repeat(20);
  state.data = {
    blueprintDocId: "owned-blueprint",
    fields: [field({ values: [value], sourceHash: "b".repeat(64) })],
  };
  await render();
  expect(text()).toContain(value);
  expect(host.querySelector("code")?.textContent).toBe("b".repeat(64));
  const row = host.querySelector("li");
  if (!row) throw new Error("missing field row");
  expect(row.style.minWidth).toBe("0");
  expect(row.style.overflowWrap).toBe("anywhere");
});
