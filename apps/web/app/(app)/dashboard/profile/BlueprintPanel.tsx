"use client";

import { api } from "@pikar/backend/api";
import {
  BLUEPRINT_SEGMENTS,
  type BlueprintSegment,
  type BusinessBlueprint,
  FIELD_SPEC,
  segmentFill,
  segmentHeadline,
} from "@pikar/core";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { BlueprintDiff } from "./BlueprintDiff";
import { card, label, primaryButton } from "./styles";

const secondaryButton = (disabled: boolean): React.CSSProperties => ({
  padding: "0.6rem 1.1rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

const formatConfirmedAt = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));

export function BlueprintPanel() {
  const blueprintState = useQuery(api.blueprint.blueprintState);
  const buildDraft = useAction(api.blueprint.buildBlueprintDraft);
  const [building, setBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);

  async function onBuild() {
    setBuilding(true);
    setBuildStatus("Reading your profile and vault documents…");
    try {
      const result = await buildDraft({});
      if (!result.ok) {
        setBuildStatus(
          result.reason === "kill_switch"
            ? "Blueprint building is paused right now. Nothing has changed; try again later."
            : "Today's model-call allowance has been used. Nothing has changed; try again tomorrow.",
        );
        return;
      }
      setBuildStatus(
        `Draft ready with ${result.additions} additions and ${result.contradictions} contradictions from ${result.sourceDocCount} source documents.`,
      );
    } catch {
      setBuildStatus(
        "I couldn't build the blueprint just now. Nothing has changed; please try again.",
      );
    } finally {
      setBuilding(false);
    }
  }

  if (blueprintState === undefined) {
    return (
      <section style={card} aria-busy="true">
        <span style={label}>Business blueprint</span>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>Loading your blueprint…</p>
      </section>
    );
  }

  const buildButton = (text: string, primary: boolean) => (
    <button
      type="button"
      disabled={building}
      onClick={() => void onBuild()}
      style={primary ? primaryButton(building) : secondaryButton(building)}
    >
      {building ? "Building…" : text}
    </button>
  );

  const liveBlueprint = blueprintState.live;

  return (
    <section style={card}>
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span style={label}>Business blueprint</span>
        <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "1.2rem" }}>
          The standing context every agent reads
        </h2>
      </div>

      {blueprintState.state === "draft" ? (
        <BlueprintDiff diff={blueprintState.diff} />
      ) : blueprintState.state === "none" || liveBlueprint === null ? (
        <>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
            A blueprint brings your profile and useful facts from your vault documents into one
            confirmed business picture. Building it reads both and costs one model call.
          </p>
          <div>{buildButton("Build blueprint", true)}</div>
        </>
      ) : (
        <BlueprintReport
          blueprint={liveBlueprint}
          confirmedAt={blueprintState.confirmedAt}
          unincorporatedCount={
            blueprintState.state === "live_stale" ? blueprintState.unincorporatedCount : 0
          }
          rebuild={buildButton("Rebuild", blueprintState.state === "live_stale")}
        />
      )}

      {buildStatus && (
        <p
          role="status"
          aria-live="polite"
          style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.88rem" }}
        >
          {buildStatus}
        </p>
      )}
    </section>
  );
}

function BlueprintReport({
  blueprint,
  confirmedAt,
  unincorporatedCount,
  rebuild,
}: {
  blueprint: BusinessBlueprint;
  confirmedAt: number | null;
  unincorporatedCount: number;
  rebuild: React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const openSegment = BLUEPRINT_SEGMENTS.find((s) => s.id === open) ?? null;

  return (
    <div style={{ display: "grid", gap: "0.85rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
          gap: "0.75rem",
        }}
      >
        {BLUEPRINT_SEGMENTS.map((segment) => (
          <SegmentTile
            key={segment.id}
            segment={segment}
            blueprint={blueprint}
            open={open === segment.id}
            onToggle={() => setOpen(open === segment.id ? null : segment.id)}
          />
        ))}
        <StatusTile
          confirmedAt={confirmedAt}
          unincorporatedCount={unincorporatedCount}
          rebuild={rebuild}
        />
      </div>

      {openSegment && <SegmentDetail segment={openSegment} blueprint={blueprint} />}
    </div>
  );
}

function SegmentTile({
  segment,
  blueprint,
  open,
  onToggle,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
  open: boolean;
  onToggle: () => void;
}) {
  const { filled, total } = segmentFill(blueprint, segment);
  const headline = segmentHeadline(blueprint, segment);
  const complete = total > 0 && filled === total;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? `segment-detail-${segment.id}` : undefined}
      style={{
        appearance: "none",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        display: "grid",
        gap: "0.5rem",
        alignContent: "start",
        padding: "0.9rem 1rem",
        borderRadius: "1rem",
        background: "var(--card)",
        border: `1px solid ${open ? "var(--teal-600)" : "var(--rule)"}`,
        color: "var(--ink)",
      }}
    >
      <span style={{ ...label, fontSize: "0.68rem" }}>{segment.label}</span>

      {/* BRAND §5 stat tile. `total === 0` shows words, NEVER a ratio — the denominator would be
          invented (spec §4). */}
      <span style={{ fontSize: total === 0 ? "0.95rem" : "1.5rem", fontWeight: 700, lineHeight: 1.1 }}>
        {total === 0 ? "Not tracked yet" : `${filled} / ${total}`}
      </span>

      {/* The meter repeats what the numerals already say — never colour alone (BRAND §6). */}
      <span style={{ display: "block", height: 4, borderRadius: 999, background: "var(--rule)" }}>
        <span
          style={{
            display: "block",
            height: "100%",
            borderRadius: 999,
            width: total === 0 ? "0%" : `${(filled / total) * 100}%`,
            /* NOT approval amber: that token means "held for your approval / spending", and a
               half-filled progress meter is neither. Reusing it here would teach the eye that
               amber means "incomplete", which is exactly the signal the Approve gate needs to
               keep for itself. --ink-soft reads as in-progress against --rule and stays legible
               in both themes. blueprint.test.ts scans this file for the amber token — and it
               scans prose too, so do not name it here either. */
            background: complete ? "var(--teal-600)" : "var(--ink-soft)",
          }}
        />
      </span>

      <span
        style={{
          fontSize: "0.8rem",
          color: "var(--ink-soft)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {headline ?? "Nothing here yet"}
      </span>
    </button>
  );
}

function StatusTile({
  confirmedAt,
  unincorporatedCount,
  rebuild,
}: {
  confirmedAt: number | null;
  unincorporatedCount: number;
  rebuild: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: "0.5rem",
        alignContent: "start",
        padding: "0.9rem 1rem",
        borderRadius: "1rem",
        background: "var(--card)",
        border: "1px solid var(--rule)",
      }}
    >
      <span style={{ ...label, fontSize: "0.68rem" }}>Confirmed</span>
      <span style={{ fontSize: "1.1rem", fontWeight: 700, lineHeight: 1.1 }}>
        {confirmedAt === null ? (
          "—"
        ) : (
          <time dateTime={new Date(confirmedAt).toISOString()}>{formatConfirmedAt(confirmedAt)}</time>
        )}
      </span>
      <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
        {unincorporatedCount === 0
          ? "Up to date with your documents"
          : `${unincorporatedCount} ${unincorporatedCount === 1 ? "document" : "documents"} added since`}
      </span>
      <span>{rebuild}</span>
    </div>
  );
}

function SegmentDetail({
  segment,
  blueprint,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
}) {
  const populated = segment.fields.filter((f) => blueprint[f] !== null);

  return (
    <section id={`segment-detail-${segment.id}`} style={{ display: "grid", gap: "0.65rem", paddingTop: "0.85rem", borderTop: "1px solid var(--rule)" }}>
      <h3 style={{ ...label, margin: 0 }}>{segment.label}</h3>

      {populated.length === 0 && (
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Nothing here yet. Add documents to your vault and rebuild, and anything they say about
          this part of the business will land here.
        </p>
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
                {entry.origin === "stated" ? "Your own words" : `From ${entry.source ?? "a vault document"}`}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
