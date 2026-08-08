"use client";

import { api } from "@pikar/backend/api";
import { type BlueprintSegment, type BusinessBlueprint, FIELD_SPEC } from "@pikar/core";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEGMENT_COPY } from "./segmentCopy";
import { label } from "./styles";

const soft: React.CSSProperties = { margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" };

/** One titled region of the anatomy. Every segment renders the same four, in the same order —
 *  the anatomy is a fixed shape populated by what's real, never a per-segment layout (spec D4). */
function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "0.45rem" }}>
      <span
        style={{
          fontSize: "0.66rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
        }}
      >
        {title}
      </span>
      {children}
    </div>
  );
}

export function SegmentAnatomy({
  segment,
  blueprint,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
}) {
  const populated = segment.fields.filter((f) => blueprint[f] !== null);

  return (
    <section
      id={`segment-detail-${segment.id}`}
      style={{
        display: "grid",
        gap: "0.9rem",
        paddingTop: "0.85rem",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <h3 style={{ ...label, margin: 0 }}>{segment.label}</h3>

      <Band title="Knowledge">
        {segment.fields.length === 0 ? (
          <p style={soft}>
            Not tracked yet. This part of the business isn't wired into the blueprint, so
            rebuilding won't change what's shown here.
          </p>
        ) : (
          populated.length === 0 && (
            <p style={soft}>
              Nothing here yet. Add documents to your vault and rebuild, and anything they say
              about this part of the business will land here.
            </p>
          )
        )}
        {populated.map((blueprintField) => {
          const entry = blueprint[blueprintField];
          if (entry === null) return null;
          return (
            <div
              key={blueprintField}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(8rem, 0.75fr) minmax(0, 1.5fr)",
                gap: "0.75rem",
                alignItems: "start",
              }}
            >
              <span style={{ color: "var(--ink-soft)", fontSize: "0.85rem", fontWeight: 600 }}>
                {FIELD_SPEC[blueprintField].label}
              </span>
              <div style={{ display: "grid", gap: "0.2rem", minWidth: 0 }}>
                <span style={{ color: "var(--ink)", fontSize: "0.92rem" }}>
                  {entry.values.join(" · ")}
                </span>
                <span style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>
                  {entry.origin === "stated"
                    ? "Your own words"
                    : `From ${entry.source ?? "a vault document"}`}
                </span>
              </div>
            </div>
          );
        })}
      </Band>
    </section>
  );
}

/**
 * The segment → specialist handoff. Opens a cockpit thread seeded with the user's own question and
 * routes there — the same two-step `AbnormalBriefBanner` uses for its plan handoff, so this adds no
 * new concept. On failure it stays put and says so rather than navigating to nothing.
 */
export function AskSpecialist({ segment }: { segment: BlueprintSegment }) {
  const sendCockpitMessage = useAction(api.cockpit.sendCockpitMessage);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { threadId } = await sendCockpitMessage({
        text:
          SEGMENT_COPY[segment.id]?.seed ?? `Help me work out my ${segment.label.toLowerCase()}.`,
      });
      router.push(`/dashboard/workspace?thread=${encodeURIComponent(threadId)}`);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <span style={{ flex: "none", display: "grid", gap: "0.2rem", justifyItems: "end" }}>
      <button
        type="button"
        onClick={() => void ask()}
        disabled={busy}
        style={{
          fontSize: "0.76rem",
          fontWeight: 700,
          color: "#fff",
          background: "var(--teal-600)",
          border: "none",
          padding: "0.42rem 0.85rem",
          borderRadius: "999px",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "Opening…" : `Ask ${segment.specialist} →`}
      </button>
      {failed && (
        <span role="alert" style={{ fontSize: "0.72rem", color: "var(--ink-soft)" }}>
          Couldn't open that. Try again.
        </span>
      )}
    </span>
  );
}
