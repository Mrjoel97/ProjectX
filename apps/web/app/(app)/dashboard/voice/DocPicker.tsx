"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PaperclipIcon } from "../../../(auth)/icons";
import { FileTextIcon, SearchIcon, XIcon } from "../vault/icons";

// 14-10 — the pre-flight document picker.
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
// The chip branch below covers the two cases where a `?doc=` id arrives WITHOUT going through this
// list (a stale link, or one followed before extraction finished) — it must never claim readiness
// the server hasn't confirmed.
//
// Reads `voiceDoc.pickableDocs` (id + title) and `voiceDoc.docContext` (title, status and truncated
// for the current selection, which also covers the `?doc=` arrival where this component never saw
// the row — the chip logic below keys off `status` so it never asserts a readiness it never
// checked). It does NOT read `vault.listVaultDocs`, which `.collect()`s whole rows including `text`
// — same rule <DocStrip> documents.
//
// BRAND: tokens only, no component library (§10). §6: real <button>s never nested inside another
// interactive element, a labelled search input, visible focus (deliberately moved by hand on the
// list<->chip transitions below, since the focused element unmounts either way), and the selected
// state is structurally distinct (a chip with a clear control, never the toggle button) with
// explanatory hint text beneath it, so nothing is encoded by colour alone.

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

  // Picking a row or clearing the chip unmounts the very control that had focus (the row `<button>`,
  // or the chip's ✕), which would otherwise drop a keyboard user onto `<body>` (BRAND §6: visible
  // focus). `pendingFocusRef` records the INTENT at click time; the effect below has no dependency
  // array on purpose, so it re-checks after every render (including the extra one `selected` causes
  // when `docContext` resolves a tick after a pick) and fires the instant its target actually exists
  // in the DOM, then clears itself. A dep-array effect keyed on `selectedId` would miss the chip
  // entirely on the common case where it isn't mounted yet on the render right after the pick.
  const clearBtnRef = useRef<HTMLButtonElement | null>(null);
  const attachBtnRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<"chip" | "toggle" | null>(null);
  useEffect(() => {
    if (pendingFocusRef.current === "chip" && clearBtnRef.current) {
      clearBtnRef.current.focus();
      pendingFocusRef.current = null;
    } else if (pendingFocusRef.current === "toggle" && attachBtnRef.current) {
      attachBtnRef.current.focus();
      pendingFocusRef.current = null;
    }
  });

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

  // A document is selected: show the chip instead of the list. There is no "Change" control — only
  // the ✕, which clears the selection and returns to the attach button below.
  if (selectedId) {
    // `undefined` = `docContext` hasn't resolved yet. Render nothing rather than a chip that would
    // have to guess readiness before the server has answered — the same "nothing to show yet" rule
    // <DocStrip> follows for `undefined`/`null`, now applied to `selected` here too (previously it
    // was applied only to `data`, which is the bug this fixes).
    if (selected === undefined) return null;

    // `null` = a cross-tenant, deleted, or otherwise malformed `?doc=` id — there is no document to
    // attach at all. `status !== "ready"` = a link followed while extraction is still running. Both
    // are cases `startSession` would refuse (`voicedoc: document not found` / `not ready`), so the
    // chip must never claim "attached and readable" here — that was the false claim this fixes.
    const unavailable = selected === null;
    const notReady = !unavailable && selected.status !== "ready";

    return (
      <div style={panelWrap}>
        <div style={chip}>
          <span aria-hidden="true" style={leadingIcon}>
            <FileTextIcon size={16} />
          </span>
          <span style={chipTitle} title={unavailable ? undefined : selected.title}>
            {unavailable ? "Document unavailable" : selected.title}
          </span>
          <button
            ref={clearBtnRef}
            type="button"
            onClick={() => {
              pendingFocusRef.current = "toggle";
              onPick(undefined);
              setOpen(false);
            }}
            aria-label="Remove the attached document"
            style={iconBtn}
          >
            <XIcon size={14} />
          </button>
        </div>
        <p style={hintText}>
          {unavailable
            ? "This document is no longer available. Remove it and pick another below."
            : notReady
              ? "This document is still being read — the assistant won't be able to reference it until it's ready."
              : "The assistant can read this document during the session."}
        </p>
      </div>
    );
  }

  // `undefined` = still loading. Render nothing rather than flashing an empty panel — the same rule
  // <DocStrip> follows for treating `undefined` and `null` as one "nothing to show yet" state.
  if (!data) return null;

  return (
    <div style={panelWrap}>
      <button
        ref={attachBtnRef}
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
                          pendingFocusRef.current = "chip";
                          onPick(d.docId);
                          setOpen(false);
                        }}
                        style={rowBtn}
                      >
                        <span aria-hidden="true" style={leadingIcon}>
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

const leadingIcon: React.CSSProperties = {
  display: "inline-flex",
  color: "var(--ink-soft)",
};
