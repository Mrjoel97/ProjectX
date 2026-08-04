"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";

// DOCV-01 — the in-call context strip. During a doc-scoped session the screen must NAME the report
// under discussion: the user is talking to an agent about one specific document, and a live voice
// surface gives them nothing else to anchor on. Also carries the "partial" honesty badge.
//
// Reads `voiceDoc.docContext`, a three-field projection ({title, status, truncated}), NOT
// `vault.listVaultDocs` — that query `.collect()`s whole rows including `text`, so rendering a title
// through it would pull a book-sized blob onto this page. There is deliberately no way for this
// component to obtain document content.
//
// DELIBERATELY NOT HERE: a live insights panel. Surfacing findings mid-call is an explicitly
// DEFERRED idea (14-CONTEXT.md) — insights land on the post-call screen, after the discussion, where
// the user decides what to do with them. Do not add one here without re-opening that decision.
//
// BRAND: tokens only. Note §6 — `--teal-600` is ~2.9:1 on white and is for button fills with white
// text, NOT small teal body text; the badge below therefore uses `--ink-soft` on a ruled chip rather
// than teal, and never encodes its meaning in colour alone (it carries the word "partial").

type DocId = FunctionArgs<typeof api.voiceDoc.docContext>["docId"];

export function DocStrip({ docId }: { docId: string }) {
  const ctx = useQuery(api.voiceDoc.docContext, { docId: docId as DocId });

  // `undefined` = still loading, `null` = not this tenant's document (fail-closed). Render nothing
  // for BOTH, and distinguish them nowhere in the UI: a "not found" message would confirm the id
  // exists, and a loading flash on a live call is noise at the worst moment (the Phase-13 lesson
  // about treating `undefined` and `null` as the same "nothing to show yet").
  if (!ctx) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.6rem",
        border: "1px solid var(--rule)",
        background: "var(--card)",
        flex: "none",
        minWidth: 0,
      }}
    >
      <span style={{ fontSize: "0.72rem", color: "var(--ink-soft)", flex: "none" }}>
        Discussing
      </span>

      {/* A link to the vault rather than lifting <PreviewModal> onto this route: the modal owns
          download/delete/retry and a doc-entities subscription, and hoisting it into a live voice
          call would put destructive actions one mis-tap from an in-progress conversation. The
          smaller diff is also the safer product. */}
      <Link
        href="/dashboard/vault"
        title={ctx.title}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "0.85rem",
          fontWeight: 600,
          color: "var(--ink)",
          textDecoration: "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {ctx.title}
      </Link>

      {/* The VISUAL half of the truncation honesty moment. The agent also says it aloud in its
          opening turn (the persona is instructed to) — this badge is the durable reminder, not a
          substitute: audio scrolls past, a badge stays for the whole call. */}
      {ctx.truncated && (
        <span
          title="Only the first part of this document could be read, so the discussion covers a partial report"
          style={{
            flex: "none",
            padding: "0.1rem 0.45rem",
            borderRadius: "999px",
            border: "1px solid var(--rule)",
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--ink-soft)",
          }}
        >
          partial
        </span>
      )}
    </div>
  );
}
