import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useQuery } from "convex/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { FolderBreadcrumb } from "./FolderBreadcrumb";
import {
  DigestRebuildControl,
  FolderOpenControl,
  VaultBrowseControls,
  type VaultBrowseHandlers,
  vaultBrowseActions,
} from "./VaultBrowseControls";

vi.mock("convex/react", () => ({ useQuery: vi.fn(), useMutation: () => vi.fn() }));

test.each([
  "failed",
  "refused",
  "building",
])("folder summary %s stays visible without a digest", (digestStatus) => {
  vi.mocked(useQuery)
    .mockReturnValueOnce({
      name: "Documents",
      memberCount: 2,
      digestStatus,
    })
    .mockReturnValueOnce({ state: "none", unincorporatedCount: 0 });
  const html = renderToStaticMarkup(
    createElement(FolderBreadcrumb, {
      folderId: "folder-test" as never,
      onExit: vi.fn(),
    }),
  );
  if (digestStatus === "building") {
    expect(html).toContain("Rebuilding…");
    expect(html).toContain('disabled=""');
  } else {
    expect(html).toContain("Rebuild digest");
    expect(html).toContain("could not be completed");
    expect(html).not.toContain('disabled=""');
  }
});

const dropzoneSource = readFileSync(join(__dirname, "Dropzone.tsx"), "utf8");

function handlers(): VaultBrowseHandlers {
  return {
    onUpload: vi.fn(),
    onFolderUpload: vi.fn(),
    onDriveImport: vi.fn(),
  };
}

describe("VaultBrowseControls", () => {
  test("renders every retained root import action as an enabled control", () => {
    const html = renderToStaticMarkup(createElement(VaultBrowseControls, { handlers: handlers() }));

    expect(html).toContain("Upload a file");
    expect(html).toContain("Choose a folder");
    expect(html).toContain('webkitdirectory=""');
    expect(html).toContain('directory=""');
    expect(html).toContain("Import from Drive");
    expect(html).not.toContain("disabled");
  });

  test("hides the root import cluster inside a sealed folder", () => {
    expect(
      renderToStaticMarkup(
        createElement(VaultBrowseControls, { handlers: handlers(), visible: false }),
      ),
    ).toBe("");
  });

  test("uses real disabled buttons while an upload is in flight", () => {
    const html = renderToStaticMarkup(
      createElement(VaultBrowseControls, { handlers: handlers(), disabled: true }),
    );

    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });

  test("keeps the in-page folder control native and directory-enabled from first render", () => {
    expect(dropzoneSource).toContain("DIRECTORY_INPUT_ATTRIBUTES");
    expect(dropzoneSource).not.toContain("dirRef.current?.click()");
    expect(dropzoneSource).not.toContain('setAttribute("webkitdirectory"');
  });

  test("maps each descriptor to exactly its existing page handler", () => {
    const callbacks = handlers();
    const actions = vaultBrowseActions(callbacks);

    actions.find((action) => action.id === "upload")?.onSelect();
    expect(callbacks.onUpload).toHaveBeenCalledOnce();
    expect(callbacks.onFolderUpload).not.toHaveBeenCalled();
    expect(callbacks.onDriveImport).not.toHaveBeenCalled();

    actions.find((action) => action.id === "folder-upload")?.onSelect(null);
    expect(callbacks.onFolderUpload).toHaveBeenCalledWith(null);
    expect(callbacks.onDriveImport).not.toHaveBeenCalled();

    actions.find((action) => action.id === "drive-import")?.onSelect();
    expect(callbacks.onDriveImport).toHaveBeenCalledOnce();
  });
});

describe("folder and digest controls", () => {
  test("renders a labelled folder-open control and keeps its callback live", () => {
    const onOpen = vi.fn();
    const html = renderToStaticMarkup(
      createElement(FolderOpenControl, {
        name: "Client contracts",
        onOpen,
        // biome-ignore lint/correctness/noChildrenProp: createElement's TypeScript overload requires the component's declared children prop here.
        children: createElement("span", null, "Client contracts"),
      }),
    );

    expect(html).toContain('aria-label="Open folder: Client contracts"');
    expect(html).not.toContain("disabled");
    // Server rendering proves presence; the exported prop contract proves the adapter is not a
    // decorative string disconnected from the page callback.
    onOpen();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("renders digest rebuild only when a digest exists", () => {
    const onRebuild = vi.fn();
    expect(
      renderToStaticMarkup(
        createElement(DigestRebuildControl, {
          available: false,
          stale: false,
          rebuilding: false,
          onRebuild,
        }),
      ),
    ).toBe("");

    const html = renderToStaticMarkup(
      createElement(DigestRebuildControl, {
        available: true,
        stale: true,
        rebuilding: false,
        onRebuild,
      }),
    );
    expect(html).toContain("Rebuild digest");
    expect(html).not.toContain("disabled");

    onRebuild();
    expect(onRebuild).toHaveBeenCalledOnce();
  });

  test("digest rebuild has an honest disabled rebuilding state", () => {
    const html = renderToStaticMarkup(
      createElement(DigestRebuildControl, {
        available: true,
        stale: true,
        rebuilding: true,
        onRebuild: vi.fn(),
      }),
    );

    expect(html).toContain("Rebuilding…");
    expect(html).toContain("disabled");
  });
});
