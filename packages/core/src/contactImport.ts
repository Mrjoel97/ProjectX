// Bulk contact import — the whole import brain, pure (Phase 19.1, ACTN-05).
//
// No Convex, no DOM, no new dependency: CLAUDE.md §1 puts domain logic in `packages/*` and leaves
// `convex/` a thin adapter. Everything downstream — the Convex write path, the browser panel and
// the e2e fixture — consumes what this file exports rather than re-deriving it.
//
// THE FILE IS NEVER UPLOADED AND NEVER STORED. Parsing happens in the user's browser and only the
// mapped rows cross the wire, which is why this feature has no PII at rest, no retention policy and
// no cleanup path (19.1-CONTEXT, LOCKED).

// `normalizeAddress` is the repo's contact identity function and `isValidEmail` its ONE email
// regex. Importing both is what makes "import cannot disagree with the send path about who a row is
// or whether the address is real" true by construction. Do NOT re-derive either here.
import { normalizeAddress } from "./contacts";
import { isValidEmail } from "./validateSubmit";

/** One parsed record and the PHYSICAL file line it starts on (1-based, header included).
 *  Physical, not record index: a quoted newline makes the two diverge and the file line is what
 *  the user sees when they open the CSV. LOCKED decision (19.1-CONTEXT). */
export type CsvRecord = { fields: string[]; line: number };

/**
 * Hand-rolled RFC-4180. Handles quoted fields, commas and newlines inside quotes, a doubled quote
 * as one escaped quote, a leading BOM, and CRLF or LF (a CRLF inside a quoted field normalizes to
 * LF, so the same file saved either way parses identically).
 *
 * Blank lines are dropped and a trailing newline does not invent a final empty record — but a
 * quoted empty field (`""`) on its own line IS a record, which is why `sawQuote` exists.
 */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let sawQuote = false;
  let line = 1; // physical line the cursor is on
  let recordLine = 1; // physical line the record in progress started on

  const endRecord = () => {
    fields.push(field);
    field = "";
    // A genuinely blank line is one empty unquoted field and nothing else.
    if (sawQuote || fields.length > 1 || fields[0] !== "") out.push({ fields, line: recordLine });
    fields = [];
    sawQuote = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else if (c === "\r" && src[i + 1] === "\n") {
        // normalize an in-field CRLF to LF; the \n below does the line accounting
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      sawQuote = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else if (c === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || fields.length > 0 || sawQuote) endRecord();
  return out;
}

/** The whole-file ceiling. A larger file is refused outright, naming this number.
 *  ponytail: a hard cap instead of a job queue. The ceiling is one browser tab's memory and one
 *  user's patience; the upgrade path when someone brings 50k rows is a server-side chunked job with
 *  a reservation row and a resumable cursor — deliberately NOT built, because upsert-by-address +
 *  fill-empty-only makes re-running the whole file a complete recovery strategy at this size. */
export const IMPORT_ROW_MAX = 1_000;
/** Rows per `importContacts` call. Not a Convex limit — every limit would permit all 1,000 in one
 *  call. The reasons are retry blast radius, progress granularity and a shorter OCC window. */
export const IMPORT_BATCH_ROWS = 100;
/** Addresses per `matchExisting` call. Same reasoning. */
export const IMPORT_MATCH_CHUNK = 500;

/** The attestation the user ticks, stored VERBATIM on every contact it covers. It is the evidence,
 *  so it is versioned here beside the parser and never paraphrased or keyed into a message table.
 *  Changing it applies to FUTURE imports only. */
export const IMPORT_ATTESTATION =
  "I have a lawful basis to contact these people — they are business contacts of mine, and I am not importing a purchased or scraped list.";

export type ImportField = "email" | "name" | "company" | "phone" | "title";
/** Column indexes per field. An ARRAY so `first`+`last` needs no special case: the values are
 *  trimmed and joined with a single space. Empty array = unmapped. Every field is overridable from
 *  the preview by handing `mapRows` a different mapping. */
export type ColumnMapping = Record<ImportField, number[]>;
export type ImportRow = {
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  title?: string;
};
export type RejectedRow = { line: number; reason: string };

/** Header cell -> field, keyed on the header stripped to lower-case alphanumerics (so "E-Mail",
 *  "e mail" and "EMail" are all `email`). Literal aliases only — no fuzzy matching, because a
 *  wrong guess silently writes the wrong column and the preview is the override. */
const HEADER_ALIASES: Record<string, ImportField> = {
  email: "email",
  emailaddress: "email",
  name: "name",
  fullname: "name",
  first: "name",
  firstname: "name",
  last: "name",
  lastname: "name",
  company: "company",
  organization: "company",
  organisation: "company",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  title: "title",
  jobtitle: "title",
};

/** Auto-map a header row. A column matching no alias is dropped and never reaches an `ImportRow`. */
export function detectMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = { email: [], name: [], company: [], phone: [], title: [] };
  header.forEach((cell, i) => {
    const field =
      HEADER_ALIASES[
        cell
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      ];
    if (field) mapping[field].push(i);
  });
  return mapping;
}

/**
 * Turn parsed records (INCLUDING the header record, which is skipped) into rows to send plus the
 * rows refused, each carrying its physical file line.
 *
 * Duplicates within the file collapse here, before anything is sent, under the SAME
 * fill-empty-only rule the write path uses: the first non-blank value for a field wins and later
 * rows fill only what is still empty. Two rows sharing an address would otherwise race on one
 * contact inside a single batch.
 */
export function mapRows(
  records: CsvRecord[],
  mapping: ColumnMapping,
): { rows: ImportRow[]; rejected: RejectedRow[] } {
  if (!mapping.email?.length) throw new Error("IMPORT_NO_EMAIL_COLUMN");
  const data = records.slice(1);
  if (data.length > IMPORT_ROW_MAX) throw new Error("IMPORT_TOO_MANY_ROWS");

  const rows: ImportRow[] = [];
  const byEmail = new Map<string, ImportRow>();
  const rejected: RejectedRow[] = [];

  for (const record of data) {
    const pick = (indexes: number[] | undefined) =>
      (indexes ?? [])
        .map((i) => (record.fields[i] ?? "").trim())
        .filter(Boolean)
        .join(" ");

    const email = normalizeAddress(pick(mapping.email));
    if (!email) {
      rejected.push({ line: record.line, reason: "no email address in this row" });
      continue;
    }
    if (!isValidEmail(email)) {
      rejected.push({ line: record.line, reason: "not a usable email address" });
      continue;
    }

    const existing = byEmail.get(email);
    const row: ImportRow = existing ?? { email };
    for (const field of ["name", "company", "phone", "title"] as const) {
      const value = pick(mapping[field]);
      if (value && !row[field]) row[field] = value;
    }
    if (!existing) {
      byEmail.set(email, row);
      rows.push(row);
    }
  }
  return { rows, rejected };
}
