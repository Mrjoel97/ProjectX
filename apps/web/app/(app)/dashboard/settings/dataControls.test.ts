// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUDIT_ARCHIVE_STATEMENT } from "@pikar/core/tenantData";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { DataControls } from "./DataControls";

const query = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useConvex: () => ({ query }) }));

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("tenant data control reachability", () => {
  test("mounts the downloader on a routed settings page linked from the rail", () => {
    expect(read("./page.tsx")).toMatch(/<DataControls\s*\/>/);
    expect(read("../../layout.tsx")).toContain('href="/dashboard/profile?tab=settings"');
    expect(read("../../layout.tsx")).toContain("Settings</span>");
  });

  test("downloads the complete continuation sequence as structured JSON", () => {
    const source = read("./DataControls.tsx");

    expect(source).toContain('"tenantExport:exportTenantData"');
    expect(source).toContain("while (cursor)");
    expect(source).toContain('type: "application/json"');
    expect(source).toContain("Download my data");
  });

  // 22.1-05 Task 3. Erasure is irreversible, so the surface — not just the server — must refuse a
  // single click. The server already takes `v.literal("DELETE MY DATA")`; these pin that the UI arms
  // on the SAME exact phrase, and that the card repeats the privacy policy's own erasure/audit
  // resolution rather than inventing a softer promise.
  // ponytail: source guards, matching this file's existing idiom. Ceiling — they prove wiring, not
  // rendered behaviour. Upgrade path: server-render with instrumented hooks the way
  // `apps/web/app/(app)/ops/opsPresentation.test.ts` does, if this surface ever grows branches.
  test("arms erasure only on the exact typed phrase and states what survives it", () => {
    const source = read("./DataControls.tsx");

    expect(source).toContain('"tenantDelete:deleteTenantData"');
    expect(source).toContain('const DELETE_PHRASE = "DELETE MY DATA"');
    expect(source).toContain("const armed = phrase === DELETE_PHRASE");
    expect(source).toContain("disabled={!armed");
    expect(source).toContain("Delete my data");
  });

  test("states what erasure removes and what the audit archive retains", () => {
    const source = read("./DataControls.tsx");

    // ADR-044 T1 (47-05): the claim now has ONE definition and the card RENDERS it, rather than
    // carrying a fourth prose copy. Asserting the substring here would have gone on passing while
    // the constant said something else — which is exactly how three surfaces drifted apart.
    expect(source).toContain("AUDIT_ARCHIVE_STATEMENT");
    expect(AUDIT_ARCHIVE_STATEMENT).toContain("references, identifiers, hashes, and counts");
    // The over-claim ADR-044 C2 falsified must not come back on any surface.
    expect(AUDIT_ARCHIVE_STATEMENT).not.toContain("no personal data");
    expect(source).not.toContain("no personal data");
    expect(source).toContain("cannot be undone");
    expect(source).toMatch(/revok|disconnect/i);
  });

  // GOVN-03 is "the policy is the specification, not the marketing". The Microsoft grant is the one
  // place the product CANNOT deliver what a reader might assume from the Google paragraph, so both
  // the card and the published policy must name the gap AND hand over the real control. Without the
  // links this is an honest dead end; with them it is an exercisable right.
  // ADR-044 C2 falsified "no personal data" on THREE user-facing surfaces, and it took writing the
  // argument down to notice, because each surface carried its own prose copy. One definition plus
  // this scan is what stops a fourth copy reintroducing it: the constant is asserted above, and
  // every surface that repeats the claim is asserted here to no longer make the retired one.
  test("the retired 'no personal data' over-claim is gone from EVERY surface that made it", () => {
    for (const rel of [
      "./DataControls.tsx",
      "../../../privacy/page.tsx",
      "../../../terms/page.tsx",
    ]) {
      expect(read(rel), `${rel} still makes the retired claim`).not.toContain("no personal data");
      expect(read(rel), `${rel} still calls the records non-personal`).not.toContain(
        "non-personal",
      );
    }
    // POSITIVE CONTROL: the scan can see these files at all. Without it, a typo'd path would make
    // every assertion above vacuously true — the defect this repo shipped once as a toHaveCount(0)
    // that passed with all six packs active.
    expect(read("../../../privacy/page.tsx")).toContain("audit");
    expect(read("../../../terms/page.tsx")).toContain("licence");
  });

  test("hands the user Microsoft's own consent control instead of implying parity with Google", () => {
    const card = read("./DataControls.tsx");
    const policy = read("../../../privacy/page.tsx");

    for (const source of [card, policy]) {
      expect(source).toContain("account.microsoft.com/privacy/app-access");
      expect(source).toContain("myapps.microsoft.com");
    }

    // the policy must say plainly that we do NOT revoke at Microsoft — never a bare "you can
    // disconnect" that reads as Google-equivalent
    expect(policy).toMatch(/cannot revoke the grant at Microsoft/i);
    // and it must not have quietly dropped the Google route it already promised
    expect(policy).toContain("myaccount.google.com/permissions");
  });
});

test("download retains files across same-table and later-table pages, including unavailable bytes", async () => {
  const files = [
    {
      table: "vaultDocuments",
      rowId: "doc-a",
      storageId: "blob-a",
      url: "https://files.invalid/a",
    },
    { table: "vaultDocuments", rowId: "doc-b", storageId: "blob-b", url: null },
    { table: "mediaAssets", rowId: "media-c", storageId: "blob-c", url: "https://files.invalid/c" },
  ];
  const header = { schemaVersion: 1, generatedAt: "2026-10-16T00:00:00.000Z", tenantId: "fixture" };
  const cursors = [
    { tableIndex: 0, cursor: "next-vault" },
    { tableIndex: 1, cursor: null },
  ];
  query.mockReset();
  for (const [index, file] of files.entries()) {
    query.mockResolvedValueOnce({
      header,
      table: { name: file.table, rows: [{ _id: file.rowId }] },
      files: [file],
      omitted: { authAccounts: "credentials omitted" },
      nextCursor: cursors[index] ?? null,
      limits: { pageSize: 100, totalRows: index + 1, truncated: true },
    });
  }
  let downloaded: Blob | undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn((blob: Blob) => {
        downloaded = blob;
        return "blob:fixture";
      }),
      revokeObjectURL: vi.fn(),
    }),
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DataControls)));
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Download my data",
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      {},
      { cursor: cursors[0] },
      { cursor: cursors[1] },
    ]);
    expect(downloaded).toBeDefined();
    const serialized = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(downloaded as Blob);
    });
    const exported = JSON.parse(serialized);
    expect(exported.files).toEqual(files);
    expect(exported.tables).toEqual({
      vaultDocuments: [{ _id: "doc-a" }, { _id: "doc-b" }],
      mediaAssets: [{ _id: "media-c" }],
    });
    expect(exported.omitted).toEqual({ authAccounts: "credentials omitted" });
    expect(exported.limits).toEqual({ pageSize: 100, totalRows: 3, truncated: true });
    expect(container.textContent).toContain("this file is partial");
    expect(container.textContent).toContain("anyone with a file link can access it");
    expect(container.textContent).toContain("Save your files before erasing your data");
    expect(container.textContent).not.toMatch(/time-limited|links\s+expire/i);
    expect(click).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
