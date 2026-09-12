// Materialize controlled inputs only. Expected outcomes never become source facts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { utils, write } from "xlsx";

export function compileSources(verticalId, fixture) {
  const input = typeof fixture.input === "string" ? { request: fixture.input } : fixture.input;
  const sources = input.sources ?? [];
  assert(sources.length <= 5, "fixture source count exceeds native bound");
  const seen = new Set();
  // Deliberate missing-image fixtures supply metadata, which is never upgraded into a source.
  return sources
    .filter((source) => source.kind !== "metadata")
    .map((source) => {
      assert(
        new RegExp(`^fixture:${verticalId}:[a-z0-9-]{1,64}$`).test(source.ref),
        "invalid source ref",
      );
      assert(!seen.has(source.ref), "duplicate source ref");
      seen.add(source.ref);
      let bytes, mimeType;
      if (source.kind === "vault-text") {
        assert(
          typeof source.content === "string" && source.content.trim(),
          "actual source text required",
        );
        bytes = Buffer.from(source.content, "utf8");
        mimeType = "text/plain";
        assert(bytes.byteLength <= 32 * 1024, "source text limit");
      } else if (source.kind === "vault-image") {
        assert(
          verticalId === "design" && ["image/png", "image/jpeg"].includes(source.mimeType),
          "unsupported visual source",
        );
        assert(
          typeof source.base64 === "string" && source.base64.length <= 1400000,
          "actual image bytes required",
        );
        bytes = Buffer.from(source.base64, "base64");
        assert(bytes.toString("base64") === source.base64, "noncanonical image bytes");
        mimeType = source.mimeType;
      } else if (source.kind === "vault-workbook") {
        assert(
          verticalId === "data" && source.sheets?.length > 0 && source.sheets.length <= 6,
          "actual bounded workbook required",
        );
        const workbook = utils.book_new();
        // SheetJS otherwise copies its mutable process-global number format table. A prior
        // currency workbook would change these fixture bytes and invalidate exact source pins.
        workbook.SSF = { 0: "General" };
        for (const spec of source.sheets) {
          assert(
            spec.rows.length <= 510 && spec.rows.every((row) => row.length <= 31),
            "fixture workbook limits",
          );
          const sheet = utils.aoa_to_sheet(spec.rows);
          for (const [address, cell] of Object.entries(spec.cells ?? {})) {
            assert(/^[A-Z]{1,2}[1-9][0-9]{0,2}$/.test(address), "fixture cell address limit");
            // SheetJS writes nested hyperlink display metadata during serialization. Keep
            // recipe cells private so compilation cannot change the caller's case hash.
            sheet[address] = structuredClone(cell);
            const range = utils.decode_range(sheet["!ref"] ?? address),
              position = utils.decode_cell(address);
            range.e.r = Math.max(range.e.r, position.r);
            range.e.c = Math.max(range.e.c, position.c);
            sheet["!ref"] = utils.encode_range(range);
          }
          utils.book_append_sheet(workbook, sheet, spec.name);
        }
        // A synthetic inert marker exercises active-content disclosure; it is never executed.
        if (source.syntheticMacroMarker)
          workbook.vbaraw = Buffer.from("Synthetic inert macro fixture marker");
        bytes = Buffer.from(
          write(workbook, {
            type: "array",
            bookType: source.syntheticMacroMarker ? "xlsm" : "xlsx",
            compression: true,
          }),
        );
        mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else
        throw new Error(
          "SOURCE_FIXTURE_UNAVAILABLE: metadata or image descriptions are not source bytes",
        );
      assert(bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024, "fixture byte limit");
      return {
        ref: source.ref,
        mimeType,
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    });
}

export function sourceManifest(sources) {
  return sources.map((source) => ({
    ref: source.ref,
    mimeType: source.mimeType,
    byteLength: source.bytes.byteLength,
    sha256: createHash("sha256").update(new Uint8Array(source.bytes)).digest("hex"),
  }));
}
