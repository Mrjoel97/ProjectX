"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// The Drive picker, rendered by US (15.3-09, VALT-13).
//
// WHY NOT GOOGLE'S PICKER SDK: it exists to make the NARROW `drive.file` scope usable — that scope
// only grants access to files the user hands over through the Picker itself. We took
// `drive.readonly`, so we can ask `files.list` for the folders directly and draw them with our own
// tokens. Mounting Google's would mean an external `apis.google.com` script plus an API key and an
// app id, for a list we can already read. Tokens only, no component library (§10).
//
// GATED ON `driveReady`, NEVER ON `connected`. The two are different facts: `include_granted_scopes`
// is forward-only, so a tenant who connected before this phase is fully connected AND cannot call
// Drive. A picker that trusted `connected` would open, fire a request, and 403 on the first click.

type Node = { id: string; name: string; kind: "folder" | "shared_drive" };
type Entry = { id: string; name: string; readable: boolean; code?: string };
type Crumb = { id: string | null; name: string };

/** Why a file cannot be read, in the user's words. The codes are the server's; these are not.
 *  An unmapped code falls back to the honest generic rather than printing an identifier. */
const WHY: Record<string, string> = {
  no_download_permission: "you do not have permission to download it",
  shortcut_unresolved: "it is a shortcut, not a file",
  no_text_export: "this Google file type has no text to extract",
  over_file_cap: "it is over the 200 MB limit",
  over_video_cap: "video is capped at 25 MB",
};

/** What the import returned, as one sentence. */
type Note = { tone: "ok" | "warn"; text: string };

export function DriveBrowser() {
  const status = useQuery(api.gmailAuth.gmailStatus);
  const listFolders = useAction(api.vaultDrive.listDriveFolders);
  const importFolder = useAction(api.vaultDrive.importDriveFolder);

  // The trail, so a user who drills three levels down can climb back out. The first crumb is the
  // root sentinel (`id: null`) — Drive's root is not a folder id we own, it is three merged lists.
  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: "Drive" }]);
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [files, setFiles] = useState<Entry[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  const here = trail[trail.length - 1] ?? { id: null, name: "Drive" };
  const driveReady = status?.driveReady === true;

  const load = useCallback(
    async (parentId: string | null) => {
      setNodes(null);
      setFiles([]);
      const r = await listFolders(parentId === null ? {} : { parentId });
      if (!r.ok) {
        setNodes([]);
        setNote({
          tone: "warn",
          text:
            r.reason === "reauth" || r.reason === "refresh_failed"
              ? "Your Google connection needs reconnecting."
              : "Could not read that folder.",
        });
        return;
      }
      setNodes(r.folders);
      setFiles(r.files);
    },
    [listFolders],
  );

  // Load the root once the grant is known to cover Drive — never before, or the first paint fires a
  // request that can only 403.
  useEffect(() => {
    if (driveReady) void load(null);
  }, [driveReady, load]);

  if (status === undefined) return null;

  const box: React.CSSProperties = {
    marginTop: "1rem",
    padding: "clamp(1rem, 2.5vw, 1.5rem)",
    borderRadius: "1rem",
    border: "1px solid var(--vault-border)",
    background: "var(--vault-paper)",
    boxShadow: "var(--vault-shadow)",
    color: "var(--ink)",
    fontSize: "0.9rem",
  };

  if (!driveReady) {
    return (
      <section className="clay-card" style={box} aria-labelledby="vault-drive-heading">
        <p className="caps-label">Connected import</p>
        <h2 id="vault-drive-heading" style={{ margin: "0.25rem 0 0", fontSize: "1.1rem" }}>
          Import from Google Drive
        </h2>
        <p style={{ margin: "0.35rem 0 0.7rem", color: "var(--ink-soft)" }}>
          {status.connected
            ? "Your Google connection was made before Drive access existed. Reconnect to add it — nothing else changes."
            : "Connect your Google account to bring a Drive folder into your vault."}
        </p>
        <Link
          href="/connect-gmail"
          className="vault-button vault-button-primary"
          style={{
            display: "inline-block",
            padding: "0.5rem 1rem",
            borderRadius: "999px",
            background: "var(--teal-600)",
            color: "#fff",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {status.connected ? "Reconnect Google" : "Connect Google"}
        </Link>
      </section>
    );
  }

  const open = (n: Node) => {
    setNote(null);
    setTrail((t) => [...t, { id: n.id, name: n.name }]);
    void load(n.id);
  };

  const climbTo = (index: number) => {
    setNote(null);
    const next = trail.slice(0, index + 1);
    setTrail(next);
    void load(next[next.length - 1]?.id ?? null);
  };

  const runImport = async () => {
    if (here.id === null) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await importFolder({ driveFolderId: here.id, name: here.name });
      if (r.ok) {
        const parts = [`Importing ${r.added} new`];
        if (r.updated) parts.push(`${r.updated} changed`);
        if (r.unchanged) parts.push(`${r.unchanged} already up to date`);
        if (r.skipped.length) parts.push(`${r.skipped.length} could not be read`);
        setNote({ tone: "ok", text: `${parts.join(", ")}. It appears below as a folder.` });
      } else if (r.reason === "unchanged") {
        setNote({
          tone: "ok",
          text: `Nothing has changed — all ${r.unchanged} files are current.`,
        });
      } else if (r.reason === "empty_folder") {
        setNote({ tone: "warn", text: "That folder has no files in it." });
      } else if (r.reason === "refused") {
        setNote({
          tone: "warn",
          text: `That folder needs ${r.shortfallCents}¢ more than today's ingest budget allows. Nothing was imported.`,
        });
      } else {
        setNote({ tone: "warn", text: "Your Google connection needs reconnecting." });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="clay-card" style={box} aria-labelledby="vault-drive-heading">
      <p className="caps-label">Connected import</p>
      <h2 id="vault-drive-heading" style={{ margin: "0.25rem 0 0", fontSize: "1.1rem" }}>
        Import from Google Drive
      </h2>

      {/* The trail. Every crumb is a button, including the current one — climbing back to where you
          already are is a harmless re-read, and disabling it costs an explanation. */}
      <nav
        aria-label="Drive location"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.25rem",
          margin: "0.5rem 0 0.6rem",
          color: "var(--ink-soft)",
        }}
      >
        {trail.map((c, i) => (
          // Keyed on the PATH PREFIX, not the index and not the id alone: a Drive shortcut can put
          // the same folder in the trail twice, so the id is not unique within a trail — the route
          // taken to reach this crumb is.
          <span
            key={trail
              .slice(0, i + 1)
              .map((x) => x.id ?? "root")
              .join("/")}
            style={{ display: "inline-flex", gap: "0.25rem" }}
          >
            {i > 0 && <span aria-hidden>›</span>}
            <button
              type="button"
              className="vault-button"
              onClick={() => climbTo(i)}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                font: "inherit",
                color: i === trail.length - 1 ? "var(--ink)" : "var(--ink-soft)",
                fontWeight: i === trail.length - 1 ? 600 : 400,
                cursor: "pointer",
                textDecoration: i === trail.length - 1 ? "none" : "underline",
              }}
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxHeight: "14rem",
          overflowY: "auto",
          border: "1px solid var(--rule)",
          borderRadius: "8px",
          background: "var(--canvas)",
        }}
      >
        {nodes === null && (
          <li style={{ padding: "0.7rem 0.85rem", color: "var(--ink-soft)" }}>Reading Drive…</li>
        )}
        {/* "No folders here" ONLY when there are no files either. Saying it beside a list of
            twelve documents reads as "this folder is empty" and it is not — that ambiguity is
            what sent two perfectly good imports down the empty_folder path before files were
            listed at all. */}
        {nodes?.length === 0 && files.length === 0 && (
          <li style={{ padding: "0.7rem 0.85rem", color: "var(--ink-soft)" }}>
            Nothing here — no folders and no files.
          </li>
        )}
        {nodes?.map((n) => (
          <li key={n.id} style={{ borderTop: "1px solid var(--rule)" }}>
            <button
              type="button"
              className="vault-button"
              onClick={() => open(n)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                width: "100%",
                padding: "0.55rem 0.85rem",
                border: "none",
                background: "transparent",
                font: "inherit",
                color: "var(--ink)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span aria-hidden>{n.kind === "shared_drive" ? "🗄" : "📁"}</span>
              <span style={{ flex: 1 }}>{n.name}</span>
              {/* The label carries the meaning, not the icon — a glyph alone encodes it invisibly
                  to a screen reader and to anyone who does not know the convention (BRAND §6). */}
              {n.kind === "shared_drive" && (
                <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>shared drive</span>
              )}
              <span aria-hidden style={{ color: "var(--ink-soft)" }}>
                ›
              </span>
            </button>
          </li>
        ))}

        {/* Files are SHOWN, never clickable: the unit of import is the folder, so a file row that
            looked pressable would promise a selection this rail does not have. Their only job is to
            answer "is there anything in here, and will it come across?" before the button is
            pressed. */}
        {files.map((f) => (
          <li
            key={f.id}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.5rem",
              padding: "0.55rem 0.85rem",
              borderTop: "1px solid var(--rule)",
              color: f.readable ? "var(--ink)" : "var(--ink-soft)",
            }}
          >
            <span aria-hidden>{f.readable ? "📄" : "⃠"}</span>
            <span style={{ flex: 1 }}>{f.name}</span>
            {!f.readable && (
              <span style={{ fontSize: "0.75rem" }}>
                can’t be read — {(f.code && WHY[f.code]) ?? "this file type is not supported"}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* ⚠ THE COUNT IS THIS LEVEL; THE IMPORT IS THE WHOLE TREE. Enumeration recurses, so a
          folder with subfolders takes across more than what is listed above. Saying only "N files
          here" beside a button that pulls in five subfolders would be a quiet lie. */}
      {nodes !== null && (files.length > 0 || (nodes.length > 0 && here.id !== null)) && (
        <p style={{ margin: "0.5rem 0 0", color: "var(--ink-soft)", fontSize: "0.82rem" }}>
          {files.length > 0
            ? `${files.length} file${files.length === 1 ? "" : "s"} here`
            : "No files at this level"}
          {files.some((f) => !f.readable) &&
            ` (${files.filter((f) => !f.readable).length} can’t be read)`}
          {nodes.length > 0 &&
            `, plus everything inside ${nodes.length} subfolder${nodes.length === 1 ? "" : "s"} — importing takes all of it`}
          .
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "0.7rem",
        }}
      >
        <button
          type="button"
          className="vault-button vault-button-primary"
          onClick={runImport}
          disabled={busy || here.id === null}
          title={here.id === null ? "Open a folder first" : undefined}
          style={{
            padding: "0.5rem 1.1rem",
            borderRadius: "999px",
            border: "none",
            background: "var(--teal-600)",
            color: "#fff",
            fontWeight: 600,
            cursor: busy || here.id === null ? "default" : "pointer",
            opacity: busy || here.id === null ? 0.5 : 1,
          }}
        >
          {busy
            ? "Importing…"
            : here.id === null
              ? "Open a folder to import"
              : `Import “${here.name}”`}
        </button>
        <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
          Re-importing later brings across only what changed.
        </span>
      </div>

      {note && (
        <p
          role="status"
          style={{
            margin: "0.6rem 0 0",
            color: note.tone === "warn" ? "var(--ink)" : "var(--ink)",
          }}
        >
          {note.text}
        </p>
      )}
    </section>
  );
}
