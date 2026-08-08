"use client";

import { api } from "@pikar/backend/api";
import { type BlueprintSegment, type BusinessBlueprint, FIELD_SPEC, SPECIALISTS } from "@pikar/core";
import { useAction, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEGMENT_BLOCKED, SEGMENT_COPY, joinPhrases } from "./segmentCopy";
import { label } from "./styles";
import { BLOCKED } from "./connections";

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

/** User-facing names for the capability grant's tool ids. Only user-meaningful tools appear;
 *  an id with no entry here (e.g. `declareUnsupported`, an internal refusal channel) renders
 *  nothing rather than leaking an internal name. */
const TOOL_LABELS: Record<string, string> = {
  searchVault: "your vault documents",
  webResearch: "live web research",
};

function ToolRow({ name, state, detail }: { name: string; state: string; detail?: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        alignItems: "baseline",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: "0.88rem", color: "var(--ink)", fontWeight: 600 }}>{name}</span>
        {detail !== undefined && (
          <span style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-soft)" }}>
            {detail}
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
          whiteSpace: "nowrap",
        }}
      >
        {state}
      </span>
    </div>
  );
}

function ToolsBand({ segment }: { segment: BlueprintSegment }) {
  // `undefined` = still loading. "Checking…" — never "Not connected" — while undefined: the
  // false-negative would invite reconnecting an already-connected account (ConnectionsPanel's
  // flash-of-wrong-state discipline).
  const gmail = useQuery(api.gmailAuth.gmailStatus);
  const blocked = BLOCKED.filter((b) => (SEGMENT_BLOCKED[segment.id] ?? []).includes(b.id));

  if (segment.specialist === null) {
    return <ToolRow name="Your profile & vault documents" state="Built in" />;
  }

  const grant = SPECIALISTS[segment.specialist];
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {grant.tools.map((t) => {
        const name = TOOL_LABELS[t];
        return name === undefined ? null : <ToolRow key={t} name={name} state="Built in" />;
      })}
      <ToolRow
        name="Google — Gmail, Calendar & Drive"
        state={gmail === undefined ? "Checking…" : gmail.connected ? "Connected" : "Not connected"}
        detail="How approved work leaves the building."
      />
      {blocked.map((b) => (
        <ToolRow key={b.id} name={b.label} state="Not available" detail={b.blocker} />
      ))}
    </div>
  );
}

function ProcessBand({ segment }: { segment: BlueprintSegment }) {
  if (segment.specialist === null) {
    return (
      <p style={soft}>
        No agent owns this section — it's yours. Facts here come from your profile and your
        documents.
      </p>
    );
  }
  const grant = SPECIALISTS[segment.specialist];
  const tools = grant.tools
    .map((t) => TOOL_LABELS[t])
    .filter((t): t is string => t !== undefined);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.9rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: "block", fontSize: "0.9rem", color: "var(--ink)" }}>
          {segment.specialist}
        </strong>
        <span style={{ ...soft, fontSize: "0.83rem" }}>
          {tools.length > 0
            ? `Works from ${joinPhrases(tools)}; anything it sends stops at your approval.`
            : "Anything it sends stops at your approval."}
        </span>
      </span>
      <AskSpecialist segment={segment} />
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

      <Band title="Process">
        <ProcessBand segment={segment} />
      </Band>

      <Band title="Tools">
        <ToolsBand segment={segment} />
      </Band>

      <Band title="Outcomes">
        {/* Slice 2 (pulse layer) replaces this with real aggregates: emails delivered, plans
            completed, and how recently — spec §3.1. Honest deferral until then, never a fake count. */}
        <p style={{ ...soft, fontSize: "0.83rem" }}>
          Not measured yet. When outcome tracking lands, what this section actually shipped —
          emails delivered, plans completed — appears here with how recent it is.
        </p>
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
