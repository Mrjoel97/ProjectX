// The shared extraction-kind classifier contract (Phase 3.8 Wave 0). Every Wave-2 lane codes
// against this behavior table — the classifier is deliberately DUMB (video/quicktime classifies
// as "transcribe"; container REJECTION is Lane 4's check via TRANSCRIBABLE_CONTAINER_MIME).
import { describe, expect, test } from "vitest";
import {
  extractionKindFor,
  MIN_CHARS_PER_PAGE,
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
      extractionKindFor("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
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
