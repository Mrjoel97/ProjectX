// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./PdfDocumentViewer", () => ({
  PdfDocumentViewer: ({ url }: { url: string }) => (
    <div data-pdf-source={url}>Actual PDF canvas</div>
  ),
}));

import { ArtifactViewerBody, type ArtifactViewerData } from "./ArtifactViewer";

let element: HTMLDivElement;
let root: Root;
const base: ArtifactViewerData = {
  id: "selected",
  title: "Quarterly report",
  mimeType: "text/markdown",
  markdown: true,
  text: "# Quarterly report\n\nRevenue grew.",
  hasOriginal: true,
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
});
async function show(artifact: ArtifactViewerData = base, onDownload = vi.fn()) {
  await act(async () =>
    root.render(<ArtifactViewerBody artifact={artifact} onDownload={onDownload} />),
  );
}
async function click(label: string) {
  const button = Array.from(element.querySelectorAll("button")).find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => button?.click());
}

describe("artifact reading canvas", () => {
  it("opens generated PDF as a readable document and offers its actual original", async () => {
    await show({ ...base, mimeType: "application/pdf", url: "https://owned.example/first" });
    expect(element.querySelector("h1")?.textContent).toBe("Quarterly report");
    expect(element.querySelector("[data-pdf-source]")).toBeNull();
    await click("Original PDF");
    expect(element.querySelector("[data-pdf-source]")?.getAttribute("data-pdf-source")).toBe(
      "https://owned.example/first",
    );
    await click("Reading");
    expect(element.querySelector("h1")?.textContent).toBe("Quarterly report");
  });

  it("uses real PDF bytes for uploads even when extracted text exists", async () => {
    await show({
      ...base,
      markdown: false,
      mimeType: "application/pdf",
      url: "https://owned.example/upload",
    });
    expect(element.querySelector("[data-pdf-source]")?.getAttribute("data-pdf-source")).toBe(
      "https://owned.example/upload",
    );
    expect(element.textContent).not.toContain("Revenue grew.");
  });

  it("changes a scriptless slide preview and keeps hostile text inert", async () => {
    await show({
      ...base,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      presentation: {
        title: "Review",
        theme: "teal",
        sources: [],
        slides: [
          { kind: "cover", title: "First slide" },
          { kind: "bullets", title: "Second slide", bullets: ["<img src=x onerror=alert(1)>"] },
        ],
      },
    });
    expect(element.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
    expect(element.querySelector("iframe")?.getAttribute("srcdoc")).toContain("First slide");
    await click("Next slide");
    expect(element.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Second slide");
    expect(element.querySelector("iframe")?.getAttribute("srcdoc")).toContain("&lt;img");
    expect(element.textContent).toContain("Slide 2 of 2");
    expect(element.textContent).toContain("Fonts and spacing may vary");
  });

  it("switches worksheets and honestly caps a read-only grid", async () => {
    await show({
      ...base,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sheets: {
        sheetCount: 3,
        sheets: [
          { name: "Overview", rows: [["Revenue", "TZS 20,000"]], totalRows: 1 },
          {
            name: "Details",
            rows: Array.from({ length: 201 }, (_, row) =>
              Array.from({ length: 31 }, (_, column) => `${row}:${column}`),
            ),
            totalRows: 251,
            totalCols: 40,
          },
        ],
      },
    });
    expect(element.querySelector("caption")?.textContent).toContain("Overview");
    const select = element.querySelector("select");
    await act(async () => {
      if (select) {
        select.value = "1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(element.querySelectorAll("tbody tr")).toHaveLength(200);
    expect(element.querySelectorAll("tbody tr:first-child td")).toHaveLength(30);
    expect(element.textContent).toContain("200 of 251 rows and 30 of 40 columns");
    expect(element.textContent).toContain("1 additional worksheets");
    expect(element.querySelector("[contenteditable]")).toBeNull();
  });

  it("replaces the selected source and resets controls when another artifact opens", async () => {
    await show({ ...base, mimeType: "image/png", url: "https://owned.example/first" });
    await click("Zoom in");
    expect(element.textContent).toContain("125%");
    await show({ ...base, id: "next", mimeType: "image/png", url: "https://owned.example/second" });
    expect(element.querySelector("img")?.getAttribute("src")).toBe("https://owned.example/second");
    expect(element.innerHTML).not.toContain("https://owned.example/first");
    expect(element.textContent).toContain("100%");
  });

  it("reports a failed original request and allows retry", async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce(undefined);
    await show(base, download);
    await click("Download original");
    expect(element.querySelector("[role=alert]")?.textContent).toContain("Please try again");
    await click("Download original");
    expect(element.querySelector("[role=alert]")).toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("provides an honest Office fallback without an external document viewer", async () => {
    await show({
      ...base,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      text: null,
    });
    expect(element.textContent).toContain("Slide preview unavailable");
    expect(element.querySelector("iframe")).toBeNull();
    expect(element.innerHTML).not.toMatch(/officeapps|docs.google|localStorage/);
  });

  it("opens the selected video with native playback controls and no empty document toolbar", async () => {
    await show({ ...base, mimeType: "video/mp4", url: "https://owned.example/video" });
    const video = element.querySelector("video");
    expect(video?.getAttribute("src")).toBe("https://owned.example/video");
    expect(video?.controls).toBe(true);
    expect(video?.autoplay).toBe(false);
    expect(element.querySelector('[aria-label="Artifact controls"]')).toBeNull();
  });
});
