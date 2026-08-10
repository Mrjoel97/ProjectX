"use client";

// The CSV import panel (ACTN-05, phase 19.1) — three screens in ONE component, mounted as the
// fourth connected section of the Pipeline page.
//
// THE FILE NEVER LEAVES THE BROWSER. `file.text()` → `parseCsv` → `detectMapping` → `mapRows`, all
// from `@pikar/core/contactImport`, and only the MAPPED ROWS cross the wire. That is why this
// feature has no upload, no storage id, no retention rule and no cleanup job — there is no CSV at
// rest to clean up. `generateUploadUrl` appears nowhere here on purpose, and a test scans for it.
//
// Everything before this file was unreachable from the product: `matchExisting` and
// `importContacts` shipped tested in 19.1-04 with ZERO callers. Phase 19's clock plane is the
// precedent — a capability that unit tests, SMOKE and a paid eval gate all certified while no user
// could reach it. So every parameter here is traced end to end: picker → state → Convex arg → writer.
//
// Styles are IMPORTED from `PipelineView.tsx` rather than re-declared, so the two halves of one page
// cannot drift apart. That makes the import cycle PipelineView ⇄ ImportPanel deliberate: it is safe
// only because every imported binding is read inside a component body, never at module scope. Do
// not hoist an imported style into a top-level `const` here.
import { api } from "@pikar/backend/api";
// The SUBPATH, never the barrel (the `Dropzone.tsx` rule): the barrel pulls unrelated weight into
// the client bundle.
import {
  type ColumnMapping,
  type CsvRecord,
  detectMapping,
  IMPORT_ATTESTATION,
  IMPORT_BATCH_ROWS,
  IMPORT_MATCH_CHUNK,
  IMPORT_ROW_MAX,
  type ImportField,
  type ImportRow,
  mapRows,
  parseCsv,
  type RejectedRow,
} from "@pikar/core/contactImport";
import { resolveMimeType } from "@pikar/core/validateSubmit";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useRef, useState } from "react";
import {
  button,
  caps,
  cardTitle,
  muted,
  PipelineStateNotice,
  primary,
  scroller,
  stack,
  td,
  th,
} from "./PipelineView";

type ExistingMatch = FunctionReturnType<typeof api.contacts.matchExisting>[number];
type ImportResult = FunctionReturnType<typeof api.contacts.importContacts>;

/** The four fields an import can fill, as a value. The counts, the preview copy and the
 *  enrichment test are all defined over exactly these — a contact that gained only a consent
 *  record is `unchanged` (19.1-04), or `unchanged` would be structurally always 0. */
const FILLABLE = ["name", "company", "phone", "title"] as const;

/** Every field the panel maps, with the words the user sees. `email` first: it is the identity and
 *  the only one without which nothing can be imported. */
const FIELD_LABELS: Array<{ field: ImportField; label: string }> = [
  { field: "email", label: "Email address" },
  { field: "name", label: "Name" },
  { field: "company", label: "Company" },
  { field: "phone", label: "Phone" },
  { field: "title", label: "Job title" },
];

/** `mapRows`' two named refusals, in the user's words. Both NAME the thing to do next: a refusal is
 *  information, not failure (the Phase-19 rule), so neither is amber and neither is a dead end. */
const REFUSAL_COPY: Record<string, string> = {
  IMPORT_TOO_MANY_ROWS: `This file has more than ${IMPORT_ROW_MAX.toLocaleString("en-US")} rows. Split it and import the parts — re-running an import is safe.`,
  IMPORT_NO_EMAIL_COLUMN: "No email column detected. Pick which column holds the address.",
};

export type ImportCounts = {
  newCount: number;
  enriched: number;
  unchanged: number;
  rejected: number;
};

/** `mapRows`, with its two throws turned into state. The panel re-runs this on every mapping change,
 *  so a refusal has to be a value the preview can render beside the selects that fix it. */
function mapSafely(
  records: CsvRecord[],
  mapping: ColumnMapping,
): { rows: ImportRow[]; rejected: RejectedRow[]; refusal: string | null } {
  try {
    const { rows, rejected } = mapRows(records, mapping);
    return { rows, rejected, refusal: null };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return {
      rows: [],
      rejected: [],
      refusal: REFUSAL_COPY[code] ?? "That file could not be read as a CSV.",
    };
  }
}

// ── the two PURE screens ──────────────────────────────────────────────────────
// Prop-driven and hook-free, because `pipelineView.test.ts` renders to a STRING with
// `renderToStaticMarkup` — anything holding a hook is untestable there.

/**
 * What the file will do BEFORE it does it: the mapping (every column overridable), the four counts,
 * and every refused row by its PHYSICAL FILE LINE.
 */
export function ImportPreview({
  header,
  mapping,
  counts,
  rejected,
  matching,
  refusal,
  onField,
  onBack,
}: {
  header: string[];
  mapping: ColumnMapping;
  counts: ImportCounts;
  rejected: RejectedRow[];
  /** The `matchExisting` round-trip is still in flight, so the counts are not yet knowable. */
  matching: boolean;
  refusal: string | null;
  onField: (field: ImportField, indexes: number[]) => void;
  onBack: () => void;
}) {
  return (
    <div style={stack} data-testid="import-preview">
      {refusal ? (
        <PipelineStateNotice state="refusal">
          <span data-testid="import-refusal">{refusal}</span>
        </PipelineStateNotice>
      ) : null}

      <div style={stack} data-testid="import-mapping">
        <p style={caps}>Which column is which</p>
        {/* Wrapped, because a wide header row must never make the PAGE scroll sideways. */}
        <div style={scroller}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr>
                <th style={th}>Contact field</th>
                <th style={th}>Column in your file</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_LABELS.map(({ field, label }) => {
                const value = mapping[field].join(",");
                // The header cells, plus — when auto-detection combined two columns (first + last) —
                // that combination itself, so the select can SHOW what is actually being used
                // instead of silently reporting half of it.
                const options = header.map((_, index) => String(index));
                if (value && !options.includes(value)) options.unshift(value);
                return (
                  <tr key={field}>
                    <td style={td}>{label}</td>
                    <td style={td}>
                      <select
                        aria-label={`Column for ${label}`}
                        data-testid={`import-map-${field}`}
                        value={value}
                        style={{ ...button, cursor: "pointer", fontWeight: 400 }}
                        onChange={(event) =>
                          onField(
                            field,
                            event.target.value === ""
                              ? []
                              : event.target.value.split(",").map(Number),
                          )
                        }
                      >
                        <option value="">— not imported —</option>
                        {options.map((option) => (
                          <option key={option} value={option}>
                            {option
                              .split(",")
                              .map(
                                (index) => header[Number(index)] || `Column ${Number(index) + 1}`,
                              )
                              .join(" + ")}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={stack}>
        <p style={caps}>What will happen</p>
        {matching ? (
          <PipelineStateNotice state="loading">
            Checking these addresses against your contacts…
          </PipelineStateNotice>
        ) : (
          <p style={{ ...muted, color: "var(--ink)" }} data-testid="import-counts">
            <strong>{counts.newCount}</strong> new · <strong>{counts.enriched}</strong> enriched ·{" "}
            <strong>{counts.unchanged}</strong> unchanged · <strong>{counts.rejected}</strong>{" "}
            rejected
          </p>
        )}
        <p style={{ ...muted, fontSize: "0.82rem" }}>
          Counts cover the four fields an import can fill: name, company, phone and job title. A
          contact you already have is <em>enriched</em> only where this file fills one of those that
          is empty — nothing you have already typed is overwritten.
        </p>
      </div>

      {rejected.length > 0 ? (
        <div style={stack}>
          <p style={caps}>Rows this file cannot import</p>
          <div style={{ ...scroller, maxHeight: "12rem", overflowY: "auto" }}>
            <ul
              data-testid="import-rejected"
              style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.3rem" }}
            >
              {rejected.map((row) => (
                <li key={`${row.line}-${row.reason}`} style={{ ...muted, fontSize: "0.85rem" }}>
                  Line {row.line}: {row.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div>
        <button type="button" style={button} data-testid="import-back" onClick={onBack}>
          Choose a different file
        </button>
      </div>
    </div>
  );
}

/**
 * The attestation, and the only control that can write anything.
 *
 * THE BOX STARTS UNTICKED AND CONFIRM IS DISABLED UNTIL IT IS TICKED. A pre-ticked box would make
 * the stored wording — kept byte-for-byte on every contact as the evidence — a false statement
 * about what the user did.
 */
export function ImportAttest({
  wording,
  ticked,
  busy,
  context,
  onTick,
  onContext,
  onConfirm,
}: {
  wording: string;
  ticked: boolean;
  busy: boolean;
  context: string;
  onTick: (ticked: boolean) => void;
  onContext: (context: string) => void;
  onConfirm: () => void;
}) {
  return (
    <div style={stack} data-testid="import-attest">
      <label
        style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={ticked}
          disabled={busy}
          data-testid="import-attest-box"
          onChange={(event) => onTick(event.target.checked)}
          style={{ marginTop: "0.25rem", width: "1.1rem", height: "1.1rem" }}
        />
        {/* Rendered VERBATIM from the constant — never re-typed here, or the sentence on screen and
            the sentence stored on the contact could differ. */}
        <span style={{ color: "var(--ink)", lineHeight: 1.5 }}>{wording}</span>
      </label>
      <label style={{ ...stack, gap: "0.3rem" }}>
        <span style={caps}>Where did these come from?</span>
        <input
          value={context}
          disabled={busy}
          placeholder="Export from my old CRM, June 2026"
          onChange={(event) => onContext(event.target.value)}
          style={{ ...button, cursor: "text", fontWeight: 400, maxWidth: "26rem" }}
        />
      </label>
      <div>
        <button
          type="button"
          style={primary}
          disabled={!ticked || busy}
          data-testid="import-confirm"
          onClick={onConfirm}
        >
          {busy ? "Importing…" : "Import these contacts"}
        </button>
      </div>
    </div>
  );
}

// ── the stateful panel ────────────────────────────────────────────────────────

/**
 * choose → preview → done. The ONLY export here holding a hook.
 *
 * `matchExisting` is a ONE-SHOT `useConvex().query`, not `useQuery`: a 500-element array argument
 * re-subscribes on every render unless memoized, and the preview is a one-time question
 * (`vault/PreviewModal.tsx` and `voice/AbnormalBriefBanner.tsx` are the precedents).
 */
export function ImportPanel() {
  const convex = useConvex();
  const importContacts = useMutation(api.contacts.importContacts);
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"choose" | "preview" | "done">("choose");
  const [fileName, setFileName] = useState("");
  const [records, setRecords] = useState<CsvRecord[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    email: [],
    name: [],
    company: [],
    phone: [],
    title: [],
  });
  const [matches, setMatches] = useState<Record<string, ExistingMatch>>({});
  const [matching, setMatching] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const header = records[0]?.fields ?? [];
  const mapped = useMemo(() => mapSafely(records, mapping), [records, mapping]);

  const counts = useMemo<ImportCounts>(() => {
    let newCount = 0;
    let enriched = 0;
    let unchanged = 0;
    for (const row of mapped.rows) {
      const match = matches[row.email];
      if (!match?.exists) {
        newCount += 1;
        continue;
      }
      // Enriched = this row carries a value for a field the match reports EMPTY. Anything else on
      // an existing contact is `unchanged`, because the write fills empties and overwrites nothing.
      const fills = FILLABLE.some((field) => Boolean(row[field]) && match.empty.includes(field));
      if (fills) enriched += 1;
      else unchanged += 1;
    }
    return { newCount, enriched, unchanged, rejected: mapped.rejected.length };
  }, [mapped, matches]);

  function reset(next: "choose" | "preview") {
    setStep(next);
    setRecords([]);
    setMatches({});
    setTicked(false);
    setResult(null);
    setProgress(null);
    setRefusal(null);
    setFileName("");
  }

  /** Ask the backend about the addresses we do not already know, `IMPORT_MATCH_CHUNK` at a time.
   *  The boundary REFUSES a longer array rather than slicing it, so the chunking is not optional. */
  async function loadMatches(rows: ImportRow[], known: Record<string, ExistingMatch>) {
    const wanted = [...new Set(rows.map((row) => row.email))].filter((email) => !known[email]);
    if (wanted.length === 0) return;
    setMatching(true);
    try {
      const found: Record<string, ExistingMatch> = {};
      for (let at = 0; at < wanted.length; at += IMPORT_MATCH_CHUNK) {
        const chunk = wanted.slice(at, at + IMPORT_MATCH_CHUNK);
        for (const match of await convex.query(api.contacts.matchExisting, { emails: chunk })) {
          found[match.email] = match;
        }
      }
      setMatches((current) => ({ ...current, ...found }));
    } catch {
      // The counts stay unknown rather than wrong: an unanswered address is counted as new, and the
      // notice says the check could not run so the numbers are not read as a promise.
      setRefusal("Your existing contacts could not be checked, so these counts may be off.");
    } finally {
      setMatching(false);
    }
  }

  async function handleFile(file: File) {
    setBusy(true);
    setRefusal(null);
    try {
      // The extension is what the user sees; `file.type` is unreliable for .csv (Chrome on Windows
      // reports "" — or `application/vnd.ms-excel` when Excel owns the extension), which is exactly
      // why `resolveMimeType` exists. Either signal being CSV is enough.
      const mimeType = resolveMimeType(file.name, file.type);
      if (!/\.csv$/i.test(file.name) && mimeType !== "text/csv") {
        setRefusal("That is not a CSV file. Export your contacts as CSV and pick that file.");
        return;
      }
      // `file.text()`, not arrayBuffer + TextDecoder: `Dropzone` only uses the two-step form
      // because it hashes the bytes, and nothing here is hashed. A leading BOM is `parseCsv`'s job.
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) {
        setRefusal("That file has no contact rows — the first line is the header.");
        return;
      }
      if (parsed.length - 1 > IMPORT_ROW_MAX) {
        // Refused HERE rather than in the preview: with no importable rows there is nothing to
        // preview, and the message has to name the limit and the way out.
        setRefusal(REFUSAL_COPY.IMPORT_TOO_MANY_ROWS ?? null);
        return;
      }
      const detected = detectMapping(parsed[0]?.fields ?? []);
      setFileName(file.name);
      setRecords(parsed);
      setMapping(detected);
      setMatches({});
      setTicked(false);
      setResult(null);
      setStep("preview");
      await loadMatches(mapSafely(parsed, detected).rows, {});
    } catch {
      setRefusal("That file could not be read. Check it opens in a spreadsheet and try again.");
    } finally {
      setBusy(false);
      // So re-picking the SAME filename re-fires `change`: "fix my file and try again" is the
      // expected retry loop here.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** A column override. Re-maps from the records already in memory — the file is never re-read. */
  function setField(field: ImportField, indexes: number[]) {
    const next = { ...mapping, [field]: indexes };
    setMapping(next);
    setRefusal(null);
    if (field === "email") void loadMatches(mapSafely(records, next).rows, matches);
  }

  async function runImport() {
    const rows = mapped.rows;
    if (rows.length === 0) {
      setRefusal("There is nothing to import from this file.");
      return;
    }
    setBusy(true);
    setRefusal(null);
    const totals: ImportResult = { created: 0, enriched: 0, unchanged: 0, rejected: [] };
    const batches = Math.ceil(rows.length / IMPORT_BATCH_ROWS);
    let batch = 0;
    try {
      for (; batch < batches; batch += 1) {
        setProgress(`Importing batch ${batch + 1} of ${batches}…`);
        const answer = await importContacts({
          rows: rows.slice(batch * IMPORT_BATCH_ROWS, (batch + 1) * IMPORT_BATCH_ROWS),
          // The wording is passed from the CONSTANT, so what is stored on every contact is the
          // sentence the user ticked, byte-for-byte.
          attestation: {
            wording: IMPORT_ATTESTATION,
            ...(context.trim() ? { context: context.trim() } : {}),
          },
        });
        totals.created += answer.created;
        totals.enriched += answer.enriched;
        totals.unchanged += answer.unchanged;
        totals.rejected.push(...answer.rejected);
        setResult({ ...totals, rejected: [...totals.rejected] });
      }
      setStep("done");
    } catch {
      // Stop, and say what LANDED. Re-running is the recovery strategy, so say that too.
      setRefusal(
        `Batch ${batch + 1} of ${batches} could not be saved. ${totals.created} contacts were created and ${totals.enriched} filled in before it stopped. Re-running the same file is safe — it fills blanks and overwrites nothing.`,
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div style={stack} data-testid="import-panel">
      {step === "choose" ? (
        <>
          <p style={muted}>
            Pick a CSV exported from your old CRM or address book. It is read here in your browser
            and never uploaded, and you will see exactly what will change before anything is saved.
          </p>
          <div>
            <button
              type="button"
              style={primary}
              disabled={busy}
              data-testid="import-choose"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
            >
              {busy ? "Reading your file…" : "Choose a CSV file"}
            </button>
          </div>
          <p style={{ ...muted, fontSize: "0.82rem" }}>
            Up to {IMPORT_ROW_MAX.toLocaleString("en-US")} rows per file. Email address is the only
            column that must be there; name, company, phone and job title are filled in when your
            file has them.
          </p>
        </>
      ) : null}

      {step === "preview" ? (
        <>
          <p style={caps}>{fileName}</p>
          <ImportPreview
            header={header}
            mapping={mapping}
            counts={counts}
            rejected={mapped.rejected}
            matching={matching}
            refusal={mapped.refusal}
            onField={setField}
            onBack={() => reset("choose")}
          />
          <ImportAttest
            wording={IMPORT_ATTESTATION}
            ticked={ticked}
            busy={busy || matching}
            context={context}
            onTick={setTicked}
            onContext={setContext}
            onConfirm={() => void runImport()}
          />
          {progress ? <PipelineStateNotice state="busy">{progress}</PipelineStateNotice> : null}
        </>
      ) : null}

      {step === "done" && result ? (
        <div style={stack} data-testid="import-done">
          <h3 style={cardTitle}>Imported</h3>
          <p style={{ ...muted, color: "var(--ink)" }}>
            <strong>{result.created}</strong> added · <strong>{result.enriched}</strong> filled in ·{" "}
            <strong>{result.unchanged}</strong> already up to date ·{" "}
            <strong>{result.rejected.length}</strong> rejected
          </p>
          <p style={muted}>The table below is now up to date.</p>
          <div>
            <button
              type="button"
              style={button}
              data-testid="import-again"
              onClick={() => reset("choose")}
            >
              Import another file
            </button>
          </div>
        </div>
      ) : null}

      {/* Every refusal is INLINE and grey. Never a `window.alert`, never a `window.confirm`, never
          a `<dialog>`: a browser modal blocks the page, cannot be driven by the Playwright spec that
          proves this surface, and reads as failure when a refusal is information. */}
      {refusal ? (
        <PipelineStateNotice state="refusal">
          <span data-testid="import-refusal">{refusal}</span>
        </PipelineStateNotice>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label="Choose a CSV file of contacts"
        data-testid="import-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
