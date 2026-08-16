"use client";

import type {
  TenantDataExport,
  TenantDataExportPage,
  TenantExportCursor,
} from "@pikar/core/tenantData";
import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { type CSSProperties, useState } from "react";

const exportTenantData = makeFunctionReference<
  "query",
  { cursor?: TenantExportCursor },
  TenantDataExportPage
>("tenantExport:exportTenantData");

/** The server takes `v.literal("DELETE MY DATA")`; this surface arms on the SAME exact phrase, so a
 *  mis-typed confirmation is refused here before it can ever reach an irreversible action. */
const DELETE_PHRASE = "DELETE MY DATA";

/** Mirrors `tenantDelete.ts`'s local result shape. Per-provider truth is reported, never averaged
 *  into one boolean — Google revokes at the provider, Microsoft does not (GOVN-03). */
type ProviderDeletionResult = {
  provider: "google" | "microsoft";
  localRowDeleted: boolean;
  revokedAtProvider: boolean;
  failure: boolean;
};

const deleteTenantData = makeFunctionReference<
  "action",
  { confirmation: typeof DELETE_PHRASE },
  { deletedByTable: Record<string, number>; providers: ProviderDeletionResult[] }
>("tenantDelete:deleteTenantData");

type ExportState = "idle" | "exporting" | "error";
type DeleteState = "idle" | "deleting" | "done" | "error";

const card: CSSProperties = {
  display: "grid",
  gap: "1rem",
  padding: "clamp(1rem, 2vw, 1.5rem)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  background: "var(--card)",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 8%, transparent)",
};

const sectionLabel: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.75rem",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const body: CSSProperties = { margin: 0, color: "var(--ink-soft)", lineHeight: 1.6 };

export function DataControls() {
  const convex = useConvex();
  const [state, setState] = useState<ExportState>("idle");
  const [message, setMessage] = useState("");
  const [phrase, setPhrase] = useState("");
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [providers, setProviders] = useState<readonly ProviderDeletionResult[]>([]);

  const armed = phrase === DELETE_PHRASE;

  async function downloadData() {
    setState("exporting");
    setMessage("Preparing your structured export. Larger accounts may take a moment.");

    try {
      let cursor: TenantExportCursor | undefined;
      let header: TenantDataExport["header"] | undefined;
      let limits: TenantDataExport["limits"] | undefined;
      const tables: Record<string, readonly unknown[]> = {};
      const omitted: Record<string, string> = {};

      do {
        const page = await convex.query(exportTenantData, cursor ? { cursor } : {});
        header ??= page.header;
        tables[page.table.name] = [...(tables[page.table.name] ?? []), ...page.table.rows];
        Object.assign(omitted, page.omitted);
        limits = page.limits;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      if (!header || !limits) throw new Error("The export returned no data envelope.");
      const completedExport: TenantDataExport = { header, tables, omitted, limits };
      const blob = new Blob([JSON.stringify(completedExport, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pikar-data-export-${header.generatedAt.slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);

      setState("idle");
      const rowCount = `${limits.totalRows.toLocaleString()} ${limits.totalRows === 1 ? "row" : "rows"}`;
      setMessage(
        limits.truncated
          ? `Download ready — ${rowCount}. Some tables held more rows than one export can carry, so this file is partial. Contact support for a complete archive.`
          : `Download ready — ${rowCount}. This is your complete record.`,
      );
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "The export could not be prepared.");
    }
  }

  async function eraseData() {
    if (!armed) return;
    setDeleteState("deleting");
    setDeleteMessage("Disconnecting your accounts, then erasing your data. Do not close this tab.");
    setProviders([]);

    try {
      const result = await convex.action(deleteTenantData, { confirmation: DELETE_PHRASE });
      const rows = Object.values(result.deletedByTable).reduce((sum, n) => sum + n, 0);
      setProviders(result.providers);
      setDeleteState("done");
      setPhrase("");
      setDeleteMessage(
        `Erased — ${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"} across ${
          Object.keys(result.deletedByTable).length
        } tables. Your account data and content are gone.`,
      );
    } catch (error) {
      setDeleteState("error");
      setDeleteMessage(
        error instanceof Error ? error.message : "The deletion could not be completed.",
      );
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <section aria-labelledby="data-controls-heading" style={card}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={sectionLabel}>Data controls</span>
          <h2 id="data-controls-heading" style={{ margin: 0, color: "var(--ink)" }}>
            Download your data
          </h2>
          <p style={body}>
            Receive your account and business data as structured JSON. Connection grants include
            only whether they are connected, when they changed, and the shape of their scopes.
            Access and refresh tokens are never included.
          </p>
          <p style={body}>
            The immutable audit archive and refs-only compliance records are omitted. The archive
            contains references, identifiers, hashes, and counts only — never message content or
            personal data.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.8rem" }}>
          <button
            type="button"
            disabled={state === "exporting"}
            onClick={downloadData}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: "0.75rem",
              padding: "0.72rem 1rem",
              minHeight: "2.75rem",
              background: "var(--teal-600)",
              color: "white",
              font: "inherit",
              fontWeight: 700,
              cursor: state === "exporting" ? "wait" : "pointer",
              opacity: state === "exporting" ? 0.7 : 1,
            }}
          >
            {state === "exporting" ? "Preparing download…" : "Download my data"}
          </button>
          <span
            role="status"
            aria-live="polite"
            style={{ color: state === "error" ? "var(--held-text)" : "var(--ink-soft)" }}
          >
            {message}
          </span>
        </div>
      </section>

      <section aria-labelledby="erase-heading" style={card}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={sectionLabel}>Erasure</span>
          <h2 id="erase-heading" style={{ margin: 0, color: "var(--ink)" }}>
            Delete your data
          </h2>
          <p style={body}>
            This removes your account data and content — your profile, vault documents, contacts,
            plans, approvals, generated media and stored connection grants. It{" "}
            <strong style={{ color: "var(--ink)" }}>cannot be undone</strong>. Download your data
            first if you want a copy.
          </p>
          <p style={body}>
            Connected accounts are disconnected before anything is erased. A Google grant is revoked
            at Google. A Microsoft grant is removed here only — Microsoft exposes no delegated-token
            revocation endpoint, so that grant stands until it expires or you remove it from your
            Microsoft account. You are told which happened.
          </p>
          <p style={body}>
            The audit archive is retained. It holds references, identifiers, hashes, and counts —
            never the content of your messages, and no personal data. There is nothing in it to
            erase.
          </p>
        </div>

        <div style={{ display: "grid", gap: "0.5rem", maxWidth: "26rem" }}>
          <label htmlFor="erase-confirm" style={{ ...body, color: "var(--ink)" }}>
            Type <strong>{DELETE_PHRASE}</strong> to confirm.
          </label>
          <input
            id="erase-confirm"
            type="text"
            value={phrase}
            autoComplete="off"
            spellCheck={false}
            disabled={deleteState === "deleting"}
            onChange={(event) => setPhrase(event.target.value)}
            style={{
              borderRadius: "0.6rem",
              border: "1px solid var(--rule)",
              padding: "0.6rem 0.75rem",
              minHeight: "2.75rem",
              background: "var(--card)",
              color: "var(--ink)",
              font: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.8rem" }}>
          <button
            type="button"
            disabled={!armed || deleteState === "deleting"}
            onClick={eraseData}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: "0.75rem",
              padding: "0.72rem 1rem",
              minHeight: "2.75rem",
              background: "var(--vault-danger)",
              color: "white",
              font: "inherit",
              fontWeight: 700,
              cursor: deleteState === "deleting" ? "wait" : armed ? "pointer" : "not-allowed",
              opacity: armed && deleteState !== "deleting" ? 1 : 0.5,
            }}
          >
            {deleteState === "deleting" ? "Erasing…" : "Delete my data"}
          </button>
          <span
            role="status"
            aria-live="polite"
            style={{
              color: deleteState === "error" ? "var(--vault-danger)" : "var(--ink-soft)",
            }}
          >
            {deleteMessage}
          </span>
        </div>

        {providers.length > 0 && (
          <ul style={{ ...body, margin: 0, paddingLeft: "1.1rem" }}>
            {providers.map((entry) => (
              <li key={entry.provider}>
                {entry.provider === "google" ? "Google" : "Microsoft"}:{" "}
                {!entry.localRowDeleted
                  ? "was not connected."
                  : entry.failure
                    ? "disconnect failed; the stored grant was removed here anyway."
                    : entry.revokedAtProvider
                      ? "revoked at the provider."
                      : "removed here only — not revoked at the provider."}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default DataControls;
