// Wave-0 stub — Lane 2 (lane-2/office-parsers) replaces this body with the fflate + XML
// text-walk flatten (DOCX/XLSX/PPTX). Deliberately NOT exported from the index barrel: only the
// "use node" vaultExtract.ts imports it via the subpath export `@pikar/vault/officeText`, which
// keeps fflate structurally out of the V8 Convex bundle.
export function extractOfficeText(_bytes: Uint8Array, _mimeType: string): { text: string } {
  throw new Error("office_parse_not_implemented");
}
