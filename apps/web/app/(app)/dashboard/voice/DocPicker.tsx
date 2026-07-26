"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PaperclipIcon } from "../../../(auth)/icons";
import { FileTextIcon, SearchIcon, XIcon } from "../vault/icons";

// 14-07 — the pre-flight document picker.
//
// A voice session only becomes doc-scoped when `startSession` receives a `docRef`. Before this
// existed the ONLY way to get one was arriving from the vault with `?doc=`, so a session started
// from this page left the agent with no vault reach at all and it correctly asked the user to
// supply the document. This closes that gap WITHOUT touching the trust boundary: the server still
// re-validates ownership and readiness in both `voiceToken.mintClientSecret` and
// `voice.startSession`. Nothing this component sends is trusted.
//
// PRE-FLIGHT ONLY. There is deliberately no mid-call attach or swap: `docRef` is written at
// row-insert in `startSession` and the id is validated again at token-mint time, so swapping
// mid-call would mean patching a live session and re-instructing the realtime model mid-stream.
//
// READY DOCUMENTS ONLY, because `startSession` refuses anything else — a row the server will reject
// must not be offered. Documents still being read are surfaced as ONE quiet count line so a
// just-uploaded file does not look like it vanished (the confusion that motivated this feature).
//
// Reads `voiceDoc.pickableDocs` (id + title) and `voiceDoc.docContext` (title of the current
// selection, which also covers the `?doc=` arrival where this component never saw the row). It does
// NOT read `vault.listVaultDocs`, which `.collect()`s whole rows including `text` — same rule
// <DocStrip> documents.
//
// BRAND: tokens only, no component library (§10). §6: real <button>s never nested inside another
// interactive element, a labelled search input, visible focus, and the selected state carries the
// word "Selected" rather than colour alone.

type DocIdArg = FunctionArgs<typeof api.voiceDoc.docContext>["docId"];

export function DocPicker({
  selectedId,
  onPick,
}: {
  selectedId?: string;
  onPick: (docId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const data = useQuery(api.voiceDoc.pickableDocs, {});
  // "skip" is the established idiom on this route (PostCall.tsx) for a query that needs an argument
  // the page may not have yet. Resolving the title through docContext rather than the list means the
  // chip is correct for a `?doc=` arrival too, where the id may sit outside the scanned window.
  const selected = useQuery(
    api.voiceDoc.docContext,
    selectedId ? { docId: selectedId as DocIdArg } : "skip",
  );

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const docs = data?.docs ?? [];
    return needle ? docs.filter((d) => d.title.toLowerCase().includes(needle)) : docs;
  }, [data, term]);

  // `undefined` = still loading. Render nothing rather than flashing an empty panel — the same rule
  // <DocStrip> follows for treating `undefined` and `null` as one "nothing to show yet" state.
  if (!data) return null;

  // A document is attached: show the chip instead of the list. "Change" reopens the picker.
  if (selectedId) {
    return (
      <div style={panelWrap}>
        <div style={chip}>
          <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--ink-soft)" }}>
            <FileTextIcon size={16} />
          </span>
          <span style={chipTitle} title={selected?.title ?? undefined}>
            {selected?.title ?? "Attached document"}
          </span>
          <button
            type="button"
            onClick={() => {
              onPick(undefined);
              setOpen(false);
            }}
            aria-label="Remove the attached document"
            style={iconBtn}
          >
            <XIcon size={14} />
          </button>
        </div>
        <p style={hintText}>The assistant can read this document during the session.</p>
      </div>
    );
  }

  return (
    <div style={panelWrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="voice-doc-picker-panel"
        style={attachBtn}
      >
        <PaperclipIcon size={16} /> Discuss a document (optional)
      </button>

      {open && (
        <div id="voice-doc-picker-panel" style={panel}>
          {data.docs.length === 0 ? (
            <p style={hintText}>
              No documents are ready yet.{" "}
              <Link href="/dashboard/vault" style={{ color: "var(--ink)", fontWeight: 600 }}>
                Open your vault
              </Link>
            </p>
          ) : (
            <>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span aria-hidden="true" style={searchIconWrap}>
                  <SearchIcon size={16} />
                </span>
                <input
                  type="search"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  aria-label="Search your documents by name"
                  placeholder="Search documents…"
                  style={searchInput}
                />
              </div>

              {filtered.length === 0 ? (
                <p style={hintText}>No documents match that search.</p>
              ) : (
                <ul style={list}>
                  {filtered.map((d) => (
                    <li key={d.docId}>
                      <button
                        type="button"
                        onClick={() => {
                          onPick(d.docId);
                          setOpen(false);
                        }}
                        style={rowBtn}
                      >
                        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--ink-soft)" }}>
                          <FileTextIcon size={16} />
                        </span>
                        <span style={rowTitle} title={d.title}>
                          {d.title}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {data.processingCount > 0 && (
            <p style={hintText}>
              {data.processingCount === 1
                ? "1 document is still being read."
                : `${data.processingCount} documents are still being read.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const panelWrap: React.CSSProperties = {
  display: "grid",
  gap: "0.5rem",
  width: "100%",
  justifyItems: "center",
};

const panel: React.CSSProperties = {
  display: "grid",
  gap: "0.5rem",
  width: "100%",
  textAlign: "left",
  padding: "0.75rem",
  background: "var(--canvas)",
  border: "1px solid var(--rule)",
  borderRadius: "0.75rem",
};

const attachBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.55rem 1.2rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  cursor: "pointer",
  background: "var(--card)",
  color: "var(--ink)",
  fontWeight: 600,
  fontSize: "0.9rem",
};

const chip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  minWidth: 0,
  padding: "0.5rem 0.6rem",
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "0.6rem",
};

const chipTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "var(--ink)",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  padding: "0.25rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink-soft)",
  cursor: "pointer",
};

const searchIconWrap: React.CSSProperties = {
  position: "absolute",
  left: "0.6rem",
  display: "inline-flex",
  color: "var(--ink-soft)",
  pointerEvents: "none",
};

const searchInput: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.6rem 0.5rem 2rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontSize: "0.85rem",
};

const list: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: "0.3rem",
  maxHeight: "12rem",
  overflowY: "auto",
};

const rowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  minWidth: 0,
  padding: "0.5rem 0.6rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  cursor: "pointer",
  textAlign: "left",
};

const rowTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "0.85rem",
};

const hintText: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--ink-soft)",
};
