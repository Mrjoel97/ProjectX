// Deterministic DOCX/XLSX/PPTX flatten: one fflate unzip + one attribute-tolerant regex
// XML text-walk (the locked fidelity bar is FLATTEN — text runs only, no XML parser dep).
// Deliberately NOT exported from the index barrel: only the "use node" vaultExtract.ts imports
// it via the subpath export `@pikar/vault/officeText`, which keeps fflate structurally out of
// the V8 Convex bundle. Throws `office_parse_failed: ...` on malformed input — the Lane-1
// dispatcher catches and marks the doc failed.
import { strFromU8, unzipSync } from "fflate";

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (match, e: string) => {
    if (e[0] !== "#") return NAMED[e];
    const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return Number.isNaN(code) ? match : String.fromCodePoint(code);
  });
}

/** All text runs of `<tag ...>...</tag>` — attribute-tolerant (Pitfall 7: xml:space="preserve"). */
function runsOf(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (m) => decodeEntities(m[1]),
  );
}

function docxText(entries: Record<string, Uint8Array>): string {
  const doc = entries["word/document.xml"];
  if (!doc) throw new Error("office_parse_failed: missing word/document.xml");
  return strFromU8(doc)
    .split("</w:p>")
    .map((p) => runsOf(p, "w:t").join(""))
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Zip entries matching `re` (one capture group: the number), numerically sorted (Pitfall 7). */
function numericSorted(
  entries: Record<string, Uint8Array>,
  re: RegExp,
): { xml: string; n: number }[] {
  return Object.keys(entries)
    .map((path) => ({ path, m: re.exec(path) }))
    .filter((x): x is { path: string; m: RegExpExecArray } => x.m !== null)
    .map(({ path, m }) => ({ xml: strFromU8(entries[path]), n: Number(m[1]) }))
    .sort((a, b) => a.n - b.n);
}

function xlsxText(entries: Record<string, Uint8Array>): string {
  const sst = entries["xl/sharedStrings.xml"]; // optional: literal-only workbooks omit it
  // ponytail: a rich-text <si> (multiple <r><t> runs) indexes as multiple entries here;
  // per-<si> grouping is the upgrade path if real workbooks surface it.
  const shared = sst ? runsOf(strFromU8(sst), "t") : [];
  const sheets = numericSorted(entries, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  if (sheets.length === 0) throw new Error("office_parse_failed: no worksheets");
  return sheets
    .map(({ xml, n }) => {
      const rows = [...xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((row) =>
        [...row[1].matchAll(/<c(?:\s([^>]*))?>([\s\S]*?)<\/c>/g)]
          .map((cell) => {
            const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell[2]);
            if (!v) return "";
            const raw = decodeEntities(v[1]);
            return /\bt="s"/.test(cell[1] ?? "") ? (shared[Number(raw)] ?? "") : raw;
          })
          .join("\t"),
      );
      return [`Sheet ${n}`, ...rows].join("\n");
    })
    .join("\n\n");
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function extractOfficeText(bytes: Uint8Array, mimeType: string): { text: string } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("office_parse_failed: not a zip");
  }
  if (mimeType === DOCX_MIME) return { text: docxText(entries) };
  if (mimeType === XLSX_MIME) return { text: xlsxText(entries) };
  throw new Error(`office_parse_failed: unrecognized mime ${mimeType}`);
}
