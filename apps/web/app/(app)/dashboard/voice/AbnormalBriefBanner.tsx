"use client";

import { api } from "@pikar/backend/api";
import { planSeedFromBrief } from "@pikar/voice";
import { useAction, useConvex, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// VOIC-03 (dropped-session half): a session whose tab closed is force-ended + auto-stored by the
// server watchdog with NO human present to review it. This banner is the review surface those briefs
// wait for — on the next app open it surfaces the newest voice brief the user has NOT yet seen, with
// a link to the vault and the SAME plan handoff PostCall offers. So a dropped session never loses its
// brief AND never skips the review preference.
//
// "Not yet reviewed" is a client-side seen-set (localStorage): PostCall marks a clean-end brief seen
// the moment it stores (it was JUST reviewed), so only the auto-stored dropped briefs remain unseen
// and surface here. ponytail: reuse the existing listVaultDocs query to FIND the brief; no new
// backend. Its TEXT comes from vault.vaultDocText, one document at a time — listVaultDocs stopped
// carrying `text` in 15.3-02 (returning every row's blob to find one brief is what blew the read
// cap), and the plan seed needs the real words, so a silent `?? ""` here would ship an empty plan.

const SEEN_KEY = "pikar:voiceBriefsSeen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Mark a voice brief reviewed so the dropped-session banner never re-surfaces it. Idempotent. */
export function markVoiceBriefSeen(id: string): void {
  try {
    const seen = readSeen();
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* private mode / no storage — the banner degrades to re-surfacing, never to losing the brief */
  }
}

export function AbnormalBriefBanner() {
  const docs = useQuery(api.vault.listVaultDocs, {});
  const sendCockpitMessage = useAction(api.cockpit.sendCockpitMessage);
  const convex = useConvex();
  const router = useRouter();

  // Load the seen-set AFTER mount (SSR has no localStorage) — until then render nothing so a
  // dismissed brief never flashes.
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSeen(readSeen()), []);

  if (seen === null || docs === undefined) return null;

  // The newest voice brief the user has not yet seen — the dropped-session recovery target.
  // NO CAST: the row type comes from the query itself, so a field this banner reads that the query
  // stops returning is a typecheck failure rather than a silent `undefined` at runtime.
  const brief = docs
    .filter((d) => d.source === "voice" && d.kind === "brief" && !seen.has(d._id))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!brief) return null;

  const dismiss = () => {
    markVoiceBriefSeen(brief._id);
    setSeen((s) => new Set(s).add(brief._id));
  };

  const turnIntoPlan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // On demand, at click, for THIS brief only — the PreviewModal `convex.query` idiom. A brief
      // whose text has not landed yet must not be seeded as an empty plan: leave the banner up.
      const row = await convex.query(api.vault.vaultDocText, { vaultDocId: brief._id });
      const text = row?.text?.trim();
      if (!text) {
        setBusy(false);
        return;
      }
      const { threadId } = await sendCockpitMessage({ text: planSeedFromBrief(text) });
      dismiss();
      router.push(`/dashboard/workspace?thread=${encodeURIComponent(threadId)}`);
    } catch {
      setBusy(false); // leave it surfaced so the user can retry — never silently drop the brief
    }
  };

  return (
    <section
      aria-label="Voice brief ready to review"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
        padding: "0.6rem 1.5rem",
        background: "var(--card)",
        borderBottom: "1px solid var(--rule)",
        color: "var(--ink)",
      }}
    >
      <span style={{ flex: 1, minWidth: "12rem", fontWeight: 600 }}>
        A brief from an interrupted voice session is ready to review.
      </span>
      <Link
        href="/dashboard/vault"
        onClick={dismiss}
        style={{
          padding: "0.4rem 1rem",
          borderRadius: "999px",
          border: "1px solid var(--rule)",
          background: "var(--card)",
          color: "var(--ink)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.85rem",
        }}
      >
        Review in vault
      </Link>
      <button
        type="button"
        onClick={() => void turnIntoPlan()}
        disabled={busy}
        style={{
          padding: "0.4rem 1rem",
          borderRadius: "999px",
          border: "none",
          cursor: busy ? "default" : "pointer",
          background: "var(--teal-600)",
          color: "#fff",
          fontWeight: 600,
          fontSize: "0.85rem",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Starting…" : "Turn into a plan"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this brief"
        style={{
          padding: "0.4rem 0.6rem",
          borderRadius: "999px",
          border: "none",
          background: "transparent",
          color: "var(--ink-soft)",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "0.85rem",
        }}
      >
        Dismiss
      </button>
    </section>
  );
}
