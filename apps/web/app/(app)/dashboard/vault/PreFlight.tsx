"use client";

// THE PRE-FLIGHT — AN INLINE `clay-card` PANEL IN THE DROPZONE'S SLOT, DELIBERATELY NOT A MODAL.
//
// This is an a11y decision, not a layout preference. The app has exactly two `aria-modal` blocks,
// neither is shared, `PreviewModal` ships Esc + scroll-lock but NO FOCUS TRAP, and
// `DisconnectGoogle.tsx:25-27` documents that missing dialog pattern as deliberate. A modal here
// would inherit that gap and owe a focus trap, a scroll lock and a portal to close it. An INLINE
// step owes none of them: focus order is the document's, Esc has nothing to close, and the page
// scrolls normally (BRAND §6 — keyboard operability is a requirement, not a suggestion). It is also
// why this renders inside `.vault-scroll`: `.clay-card`'s backdrop-filter only frosts correctly on
// the `.pane-canvas` aura, so a portal would look wrong even before the a11y argument.
//
// Amber never appears on this panel. The approval-amber tokens are the approval gate's alone
// (BRAND §2); a refusal uses the failure palette already shipped in `PreviewModal.tsx:345-371`.
// The token name is deliberately not spelled here — a surface-wide amber guard greps for it.

import { api } from "@pikar/backend/api";
import { VAULT_INGEST_PARALLELISM } from "@pikar/vault/constants"; // SUBPATH, never the barrel
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRef, useState } from "react";
import { fmtSize } from "./DocGrid";
import { type FileOutcome, type PickedFolder, pillPrimary, pillSecondary } from "./Dropzone";
import { refusalCopy, skipCopy } from "./preflightCopy";

// Convex id brands derived from the mutation args (no dataModel import — repo convention,
// `Dropzone.tsx:28`).
type FolderId = FunctionArgs<typeof api.vaultFolders.cancelFolder>["folderId"];
type StorageId = FunctionArgs<typeof api.vault.vaultUploadFolderFile>["storageId"];

/** The Start loop's phase. Declared here, HELD BY `VaultPage`: a refusal or an in-flight upload has
 *  to survive Refresh, and `page.tsx`'s `key={nonce}` destroys everything `VaultBody` owns. */
export type StartPhase =
  | { kind: "idle" }
  | { kind: "uploading"; folderId: FolderId; done: number; total: number }
  | { kind: "refused"; reason: string; estimateCents: number; remainingCents: number }
  | { kind: "failed"; note: string }
  | { kind: "started"; docCount: number };

// ── The two READY IN calibration constants ───────────────────────────────────
//
// ponytail: hand-picked calibration, not derived on paper. Nothing in the repo expresses a typical
// per-document duration or a link speed — every time-shaped constant is a CEILING
// (EXTRACTION_WATCHDOG_MS 15 min, CALL_TIMEOUT_MS 480 s, PAGE_TIMEOUT_MS 60 s, FANOUT_BUDGET_MS
// 420 s), and using one as a duration gives ~16 hours for 400 documents. ~12 Mbit/s is the link
// `constants.ts:10-13` says the per-file cap needs to be reachable at all; 20 s is a mixed folder
// (mostly free_extract text/office, some OCR) well under the 60 s/page and 420 s fan-out ceilings.
// They live beside their only consumer for the same reason `fmtSize` does. Upgrade path: measure
// real elapsed markExtracting → terminal and move both into `packages/vault/src/constants.ts`.
const UPSTREAM_BYTES_PER_SEC = 1_500_000; // ASSUMPTION
const SECONDS_PER_DOC = 20; // ASSUMPTION

/** TWO TERMS, and PROCESSING DOMINATES. Transfer alone is the dishonest number: 400 documents at
 *  concurrency 6 is ~22 minutes of reading after the bytes have landed, not the ~4 minutes it takes
 *  to send them (BRAND §1 — honest about limits). */
function readySeconds(bytes: number, docCount: number): number {
  const transferSec = bytes / UPSTREAM_BYTES_PER_SEC;
  const processSec = Math.ceil(docCount / VAULT_INGEST_PARALLELISM) * SECONDS_PER_DOC;
  return transferSec + processSec;
}

function fmtReady(sec: number): string {
  if (sec < 90) return "under 2 minutes";
  if (sec < 5400) return `about ${Math.round(sec / 60)} minutes`;
  return `about ${(sec / 3600).toFixed(1)} hours`;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The `BlueprintPanel.tsx:339` tile, re-coloured for a LIGHT card. Its caption there is
 *  `rgb(255 255 255 / 62%)` because it sits on the `--teal-900` masthead; on a white `clay-card`
 *  that is a contrast failure, so the colours come from `VaultStats.tsx:68-89` instead. */
function Kpi({ v, k }: { v: string; k: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "1.45rem",
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink)",
        }}
      >
        {v}
      </div>
      <div
        style={{
          fontSize: "0.66rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
          marginTop: "0.25rem",
        }}
      >
        {k}
      </div>
    </div>
  );
}

export function PreFlight({
  picked,
  phase,
  onPhase,
  onClear,
}: {
  /** Owned by `VaultPage` — Refresh must not force a re-pick of a 1.5 GB tree. */
  picked: PickedFolder;
  /** Owned by `VaultPage` — a refusal must survive Refresh, or the user presses Start again and
   *  re-uploads the whole folder into a second one. A controlled component. */
  phase: StartPhase;
  onPhase: (p: StartPhase) => void;
  /** Drop the selection and go back to the Dropzone: Cancel, Start over, and success. */
  onClear: () => void;
}) {
  // The ONE query. Re-subscribing on Refresh is correct and desirable — the remaining budget
  // genuinely moves — and `picked.manifest` is built once at pick time, so the args reference (and
  // therefore the query token) is stable across renders.
  const est = useQuery(api.vaultFolders.folderEstimate, { files: picked.manifest });

  const createFolder = useMutation(api.vaultFolders.createFolder);
  const reserveFolder = useMutation(api.vaultFolders.reserveFolder);
  const cancelFolder = useMutation(api.vaultFolders.cancelFolder);
  const generateUploadUrl = useMutation(api.requests.generateUploadUrl);
  const uploadFolderFile = useAction(api.vault.vaultUploadFolderFile);

  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  // A REF, not state: the loop reads it BETWEEN files and a state value would be stale inside the
  // loop's closure. ponytail: abort at a file boundary — the in-flight POST still finishes. Upgrade
  // path: an AbortController on the fetch.
  const cancelRequested = useRef(false);
  // The MIRROR of the ref, purely so the control can say what it is doing. Setting a ref triggers
  // no re-render, so Cancel used to sit there looking inert for as long as the current file takes
  // to finish — well over a minute for a large member — and a user who sees nothing presses again.
  // BRAND §6 wants operability feedback and §1 wants honesty about what is happening.
  const [cancelling, setCancelling] = useState(false);

  // `perFile` is index-aligned with the manifest, EXCEPT on the kill-switch arm where pricing never
  // ran and it comes back empty. Falling back to "everything is ingestible, priced at zero" keeps
  // N FILES honest while the refusal block explains that nothing was priced.
  const perFile =
    est && est.perFile.length === picked.files.length
      ? est.perFile
      : picked.files.map(() => ({ cents: 0, reason: "" }));
  const ingestible: number[] = [];
  const skipped: number[] = [];
  for (let i = 0; i < picked.files.length; i++) {
    (skipCopy(perFile[i]?.reason ?? "") === null ? ingestible : skipped).push(i);
  }
  const ingestBytes = ingestible.reduce((n, i) => n + (picked.manifest[i]?.size ?? 0), 0);

  const uploading = phase.kind === "uploading";
  const refused = phase.kind === "refused";
  // Either refusal blocks Start: the one the card already knows about, and the one the reserve came
  // back with after the transfer.
  const blocked = refused || est?.refusal != null || ingestible.length === 0;

  /** Cancel is the REFUND, so it can never be the thing that throws. A folder left in `reserving`
   *  has no server-side backstop — `vaultSweep` deliberately skips that status and there is no
   *  folder-level cron — so a rejection here would strand the reservation with no way back except a
   *  control the user has to find unaided. Swallowing is correct: the caller is already on a
   *  failure path and has its own message to deliver. */
  async function safeCancel(folderId: FolderId): Promise<void> {
    try {
      await cancelFolder({ folderId });
    } catch {
      /* nothing better to do here — the folder card's own Cancel remains the manual exit */
    }
  }

  async function start() {
    cancelRequested.current = false;
    setCancelling(false);
    setOutcomes([]);
    let folderId: FolderId;
    try {
      ({ folderId } = await createFolder({ name: picked.name, source: "upload" }));
    } catch {
      onPhase({ kind: "failed", note: "We couldn't start this folder. Try again." });
      return;
    }
    onPhase({ kind: "uploading", folderId, done: 0, total: ingestible.length });

    const results: FileOutcome[] = [];
    for (const i of ingestible) {
      const file = picked.files[i];
      const entry = picked.manifest[i];
      if (!file || !entry) continue;
      try {
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": entry.mimeType },
          body: file,
        });
        if (!res.ok) throw new Error("upload failed");
        const { storageId } = (await res.json()) as { storageId: StorageId };
        await uploadFolderFile({
          folderId,
          storageId,
          filename: file.name,
          mimeType: entry.mimeType,
          size: entry.size,
        });
        results.push({ name: file.name, ok: true });
      } catch (e) {
        // The loop CONTINUES — one bad file must not abandon the rest, and every result is kept so
        // the user is told exactly which files landed (BRAND §1).
        results.push({
          name: file.name,
          ok: false,
          note: e instanceof Error ? e.message : "upload failed",
        });
      }
      setOutcomes([...results]);
      onPhase({ kind: "uploading", folderId, done: results.length, total: ingestible.length });
      if (cancelRequested.current) {
        await safeCancel(folderId);
        onClear();
        return;
      }
    }

    if (results.every((r) => !r.ok)) {
      // Nothing landed, so there is nothing to reserve against — refund and drop the empty folder
      // rather than leave it parked in `reserving`.
      await safeCancel(folderId);
      onPhase({ kind: "failed", note: "None of your files reached us. Nothing was read." });
      return;
    }

    // THE MANIFEST VERBATIM, UNFILTERED. It is the array the card priced (so the cents match to the
    // penny) and it is always ≥ `memberCount`, so it can never trip `manifest_short`
    // (vaultFolders.ts:143). Do NOT rebuild it from the upload results.
    // ⚠ GUARDED, AND THE FAILURE IS NOT HYPOTHETICAL. This await is the last step after however
    // long 1.5 GB takes to send — a slept tab, a dropped wifi or one transient websocket error
    // rejects it. Unguarded, the rejection vanished into `void start()`: `onPhase` was never called
    // again, so the panel froze on "Sending 400 of 400…" forever with Start disabled and Cancel a
    // no-op, while 400 members sat at `pending_extraction` under a folder no sweep will touch. That
    // is precisely the silent parking this phase abolished, re-introduced in the browser.
    let r: Awaited<ReturnType<typeof reserveFolder>>;
    try {
      r = await reserveFolder({ folderId, files: picked.manifest });
    } catch {
      onPhase({
        kind: "failed",
        note: "Your files reached us but we couldn't start reading them. Open the folder and press Cancel, then try again.",
      });
      return;
    }
    if (r.ok) {
      const landed = results.filter((x) => x.ok).length;
      onPhase({ kind: "started", docCount: landed });
      // ONLY clear when everything landed. `outcomes` is LOCAL state that dies with the panel, so
      // clearing on a partial success threw away the per-file record the accumulator exists to
      // build — at the exact moment it carries the one thing the user cannot recover anywhere else.
      // The folder card would report "8 documents" for a 10-file pick and never name the other two
      // (BRAND §1). On a clean run there is nothing to say, so the panel still gets out of the way.
      if (landed === results.length) onClear();
      return;
    }
    // THE FRESHER-NUMBERS PATH, and it is not an edge case: the card was read at T and the reserve
    // happens at T + however long 1.5 GB takes to send. The panel HOLDS and re-states the cost from
    // the reserve's own figures. The folder is already `refused` server-side with its members
    // failed, and Start is never re-enabled on this folderId — `reserveFolder` CASes on `reserving`
    // and would only ever answer `not_reserving`.
    onPhase({
      kind: "refused",
      reason: r.reason,
      estimateCents: "estCents" in r ? r.estCents : 0,
      remainingCents: "remainingCents" in r ? r.remainingCents : 0,
    });
  }

  const copy = refused
    ? refusalCopy(phase)
    : est?.refusal
      ? refusalCopy({
          reason: est.refusal.reason,
          estimateCents: est.totalCents,
          remainingCents: est.remainingCents,
        })
      : null;
  // `not_reserving` and `manifest_short` come back with NO `estCents`, so the refusal arm fills 0.
  // `preflightCopy` already suppresses both numbers in the PROSE for those codes; the tile has to
  // agree, or the panel says "your folder didn't match what reached us" beside a confident $0.00
  // for a folder that plainly costs money.
  const costCents = refused ? phase.estimateCents : (est?.totalCents ?? 0);
  const costUnknown = refused && phase.estimateCents === 0;

  return (
    <section
      className="clay-card"
      style={{ borderRadius: "1rem", padding: "1.25rem 1.5rem", display: "grid", gap: "1rem" }}
    >
      <div className="caps-label">FOLDER UPLOAD</div>

      <p style={{ margin: 0, color: "var(--ink)", fontWeight: 700 }}>{picked.name}</p>

      {/* Wraps, unlike VaultStats' fixed 4-across grid — this panel is narrower. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.6rem" }}>
        {/* Captions are UPPERCASE in source as well as in CSS. BlueprintPanel writes them lowercase
            and leans on `textTransform`, but the surface scan reads source text, and a guard that
            asserts the five required elements must not be defeated by a style rule. */}
        <Kpi v={`${ingestible.length}`} k="N FILES" />
        <Kpi v={fmtSize(ingestBytes)} k="TOTAL SIZE" />
        <Kpi v={est === undefined || costUnknown ? "—" : money(costCents)} k="EST. COST" />
        <Kpi
          v={est === undefined ? "—" : fmtReady(readySeconds(ingestBytes, ingestible.length))}
          k="READY IN"
        />
      </div>

      {skipped.length > 0 && (
        <div>
          <div className="caps-label">
            {skipped.length} file{skipped.length === 1 ? "" : "s"} won&rsquo;t be read
          </div>
          <ul
            style={{
              margin: "0.4rem 0 0",
              paddingLeft: "1.1rem",
              color: "var(--ink-soft)",
              fontSize: "0.85rem",
            }}
          >
            {skipped.map((i) => (
              <li key={picked.files[i]?.name ?? i}>
                {picked.files[i]?.name} — {skipCopy(perFile[i]?.reason ?? "")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {copy && (
        // The failure palette, never amber (BRAND §2). Red stays hardcoded because BRAND defines no
        // error token — the same licence `connect-gmail/page.tsx:28-31` records, and `#991b1b`
        // already ships on this surface as the failed-chip foreground (DocGrid.tsx:35).
        <div
          role="alert"
          style={{
            borderRadius: "0.75rem",
            border: "1px solid #fecaca",
            background: "#fef2f2",
            padding: "0.85rem 1rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>
            {copy.title}
          </p>
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#991b1b" }}>
            {copy.remedy}
          </p>
          {refused && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#991b1b" }}>
              Nothing was read.
            </p>
          )}
        </div>
      )}

      {phase.kind === "started" && (
        // The arm that only renders on a PARTIAL success — a clean run has already called
        // `onClear()` and unmounted this panel. Announced, because it is a terminal outcome the
        // user did not watch happen (the per-file counter above is deliberately not announced).
        <p
          role="status"
          aria-live="polite"
          style={{ margin: 0, color: "var(--ink)", fontSize: "0.88rem" }}
        >
          Reading {phase.docCount} file{phase.docCount === 1 ? "" : "s"}. The rest are listed below
          and were not sent.
        </p>
      )}

      {phase.kind === "failed" && (
        <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
          {phase.note}
        </p>
      )}

      {uploading && (
        // No aria-live on a counter that ticks once per file — the workspace ActivityCard sets that
        // precedent (ChatPane.tsx:208). The terminal outcome above is the announced one.
        <p
          style={{
            margin: 0,
            color: "var(--ink-soft)",
            fontSize: "0.88rem",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Sending {phase.done} of {phase.total}…
        </p>
      )}

      {outcomes.some((o) => !o.ok) && (
        <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
          {outcomes.filter((o) => !o.ok).length} file
          {outcomes.filter((o) => !o.ok).length === 1 ? "" : "s"} didn&rsquo;t reach us:{" "}
          {outcomes
            .filter((o) => !o.ok)
            .map((o) => o.name)
            .join(", ")}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        {refused ? (
          <button type="button" onClick={onClear} style={pillSecondary(false)}>
            Start over
          </button>
        ) : phase.kind === "started" ? (
          // Started AND partial: the panel is held open only to name the files that did not make
          // it, so the one control left is an acknowledgement. Start must NOT come back — the
          // folder is past `reserving` and a second press could only ever answer `not_reserving`.
          <button type="button" onClick={onClear} style={pillSecondary(false)}>
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={uploading || blocked || est === undefined}
              onClick={() => void start()}
              style={pillPrimary(uploading || blocked || est === undefined)}
            >
              Start
            </button>
            <button
              type="button"
              disabled={cancelling}
              aria-disabled={cancelling}
              onClick={() => {
                if (uploading) {
                  cancelRequested.current = true;
                  setCancelling(true); // the ref alone re-renders nothing; see its declaration
                } else onClear();
              }}
              style={pillSecondary(cancelling)}
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
