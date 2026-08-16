"use client";

import {
  type TenantDataExport,
  type TenantDataExportPage,
  type TenantExportCursor,
} from "@pikar/core/tenantData";
import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";

const exportTenantData = makeFunctionReference<
  "query",
  { cursor?: TenantExportCursor },
  TenantDataExportPage
>("tenantExport:exportTenantData");

type ExportState = "idle" | "exporting" | "error";

export function DataControls() {
  const convex = useConvex();
  const [state, setState] = useState<ExportState>("idle");
  const [message, setMessage] = useState("");

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

  return (
    <section
      aria-labelledby="data-controls-heading"
      style={{
        display: "grid",
        gap: "1rem",
        padding: "clamp(1rem, 2vw, 1.5rem)",
        border: "1px solid var(--rule)",
        borderRadius: "1rem",
        background: "var(--card)",
        boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 8%, transparent)",
      }}
    >
      <div style={{ display: "grid", gap: "0.4rem" }}>
        <span
          style={{
            color: "var(--ink-soft)",
            fontSize: "0.75rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Data controls
        </span>
        <h2 id="data-controls-heading" style={{ margin: 0, color: "var(--ink)" }}>
          Download your data
        </h2>
        <p style={{ margin: 0, color: "var(--ink-soft)", lineHeight: 1.6 }}>
          Receive your account and business data as structured JSON. Connection grants include only
          whether they are connected, when they changed, and the shape of their scopes. Access and
          refresh tokens are never included.
        </p>
        <p style={{ margin: 0, color: "var(--ink-soft)", lineHeight: 1.6 }}>
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
  );
}

export default DataControls;
