// The shared extraction-kind classifier contract (Phase 3.8 Wave 0). Every Wave-2 lane codes
// against this behavior table — the classifier is deliberately DUMB (video/quicktime classifies
// as "transcribe"; container REJECTION is Lane 4's check via TRANSCRIBABLE_CONTAINER_MIME).
import { describe, expect, test } from "vitest";
import {
  extractionKindFor,
  MIN_CHARS_PER_PAGE,
  schedulingRailFor,
  TRANSCRIBABLE_CONTAINER_MIME,
  VAULT_EXTRACT_CHAR_CAP,
  VAULT_EXTRACT_PAGE_CAP,
} from "./extractKind";

describe("extractionKindFor", () => {
  test("pdf", () => {
    expect(extractionKindFor("application/pdf")).toBe("pdf");
  });

  test("image/*", () => {
    expect(extractionKindFor("image/png")).toBe("image");
    expect(extractionKindFor("image/jpeg")).toBe("image");
  });

  test("the 3 OOXML MIMEs → office", () => {
    expect(
      extractionKindFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("office");
    expect(
      extractionKindFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("office");
    expect(
      extractionKindFor(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("office");
  });

  test("octet-stream + Office extension → office (filename fallback, case-insensitive)", () => {
    expect(extractionKindFor("application/octet-stream", "report.docx")).toBe("office");
    expect(extractionKindFor("application/octet-stream", "BUDGET.XLSX")).toBe("office");
    expect(extractionKindFor("application/octet-stream", "deck.pptx")).toBe("office");
    // No matching extension → still null.
    expect(extractionKindFor("application/octet-stream", "archive.bin")).toBe(null);
  });

  test("video/* and audio/* → transcribe (classifier stays dumb — rejection is Lane 4's job)", () => {
    expect(extractionKindFor("video/mp4")).toBe("transcribe");
    expect(extractionKindFor("audio/wav")).toBe("transcribe");
    expect(extractionKindFor("video/quicktime")).toBe("transcribe");
  });

  test("not extractable → null", () => {
    expect(extractionKindFor("text/plain")).toBe(null);
    expect(extractionKindFor("application/zip")).toBe(null);
  });
});

// Phase 15.2 (SC#4): the SCHEDULING decision, in one place for all three callers. The root cause
// of the 2026-07-26 .xlsm stranding was `extractionKindFor(...) === null → schedule nothing`.
describe("schedulingRailFor — TOTAL: there is no 'do not schedule'", () => {
  test("media still rides the transcribe rail (routing UNCHANGED)", () => {
    expect(schedulingRailFor("video/mp4")).toBe("transcribe");
    expect(schedulingRailFor("audio/mpeg")).toBe("transcribe");
    expect(schedulingRailFor("video/quicktime")).toBe("transcribe");
  });

  test("everything the old allow-list recognised still rides extract", () => {
    expect(schedulingRailFor("application/pdf")).toBe("extract");
    expect(schedulingRailFor("image/png")).toBe("extract");
    expect(
      schedulingRailFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("extract");
    expect(
      schedulingRailFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("extract");
    expect(
      schedulingRailFor(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("extract");
  });

  test("THE OWNER'S STUCK .xlsm → extract (extractionKindFor returns null for it)", () => {
    const XLSM = "application/vnd.ms-excel.sheet.macroEnabled.12";
    expect(extractionKindFor(XLSM, "budget.xlsm")).toBe(null); // the defect, observed
    expect(schedulingRailFor(XLSM, "budget.xlsm")).toBe("extract"); // and no longer decisive
  });

  test("the Windows empty-MIME class and assorted opaque types → extract", () => {
    expect(schedulingRailFor("")).toBe("extract");
    expect(schedulingRailFor("", "notes.md")).toBe("extract");
    expect(schedulingRailFor("application/zip")).toBe("extract");
    expect(schedulingRailFor("application/octet-stream")).toBe("extract");
    expect(schedulingRailFor("application/x-nonsense")).toBe("extract");
  });

  test("PROPERTY: total over ~20 assorted MIME strings — never null/undefined", () => {
    const MIMES = [
      "application/pdf",
      "image/png",
      "image/webp",
      "image/heic",
      "text/plain",
      "text/markdown",
      "text/html",
      "text/csv",
      "application/json",
      "application/xml",
      "application/zip",
      "application/octet-stream",
      "application/rtf",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "video/mp4",
      "audio/mpeg",
      "application/x-nonsense",
      "",
      "   ",
      "not/a/real/mime",
    ];
    for (const mime of MIMES) {
      const rail = schedulingRailFor(mime, "file.bin");
      expect(rail).not.toBe(null);
      expect(rail).not.toBe(undefined);
      expect(["transcribe", "extract"]).toContain(rail);
    }
  });

  test("extractionKindFor is BYTE-UNCHANGED — its null survives as the MIME fallback only", () => {
    expect(extractionKindFor("application/zip")).toBe(null);
    expect(extractionKindFor("text/plain")).toBe(null);
  });
});

describe("caps consts + transcodable container set", () => {
  test("caps hold the Wave-0 contract values", () => {
    expect(VAULT_EXTRACT_CHAR_CAP).toBe(400_000);
    expect(VAULT_EXTRACT_PAGE_CAP).toBe(50);
    expect(MIN_CHARS_PER_PAGE).toBe(25);
  });

  test("TRANSCRIBABLE_CONTAINER_MIME accepts mp4/webm/mpeg video but NOT quicktime", () => {
    expect(TRANSCRIBABLE_CONTAINER_MIME.has("video/mp4")).toBe(true);
    expect(TRANSCRIBABLE_CONTAINER_MIME.has("video/webm")).toBe(true);
    expect(TRANSCRIBABLE_CONTAINER_MIME.has("video/mpeg")).toBe(true);
    expect(TRANSCRIBABLE_CONTAINER_MIME.has("video/quicktime")).toBe(false);
    expect(TRANSCRIBABLE_CONTAINER_MIME.has("audio/wav")).toBe(true);
  });
});
