"use client";

import { api } from "@pikar/backend/api";
import {
  BLUEPRINT_FIELDS,
  BLUEPRINT_SEGMENTS,
  type BlueprintSegment,
  type BusinessBlueprint,
  composeReadout,
  firstGap,
  type PulseGlobals,
  type SegmentPulse,
  segmentFill,
  segmentHeadline,
} from "@pikar/core";
import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { BlueprintCanvas } from "./BlueprintCanvas";
import { BlueprintDiff } from "./BlueprintDiff";
import { AskSpecialist, SegmentAnatomy } from "./SegmentAnatomy";
import { joinPhrases, SEGMENT_COPY } from "./segmentCopy";
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

/**
 * Every field blank. Lets the segment grid render BEFORE a blueprint exists, so the shape of the
 * thing is visible without spending a model call to find out what it looks like. Built off
 * BLUEPRINT_FIELDS rather than written out, so a twelfth field cannot leave a hole here.
 */
const EMPTY_BLUEPRINT = Object.fromEntries(
  BLUEPRINT_FIELDS.map((blueprintField) => [blueprintField, null]),
) as unknown as BusinessBlueprint;

export function BlueprintPanel() {
  const blueprintState = useQuery(api.blueprint.blueprintState);
  const buildDraft = useAction(api.blueprint.buildBlueprintDraft);
  const [building, setBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);

  // One clock per TICK, not per render: a per-render arg would resubscribe the query constantly,
  // but a mount-frozen clock is worse — the STALE_RUN_MS guard compares against it, so an orphaned
  // `running` step (the swallowed end-patch case the guard exists for) would breathe forever.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  const pulse = useQuery(api.blueprint.blueprintPulse, { now });

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
    <section style={card} aria-label="Business blueprint">
      {/* The masthead inside BlueprintReport carries the title for the built and empty states, so a
          card header here would say it twice. The draft review has no masthead and still needs one. */}
      {blueprintState.state === "draft" ? (
        <>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <span style={label}>Business blueprint</span>
            <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "1.2rem" }}>
              Review what changed
            </h2>
          </div>
          <BlueprintDiff diff={blueprintState.diff} draft={blueprintState.draft} />
        </>
      ) : blueprintState.state === "none" || liveBlueprint === null ? (
        /* Renders EMPTY rather than being hidden until the first build: showing the shape of the
           thing is how the page explains what a blueprint is. The build CTA is passed IN rather
           than rendered above, because the masthead bleeds to the card edge and must be the
           card's first child — anything above it gets overlapped. */
        <BlueprintReport
          blueprint={EMPTY_BLUEPRINT}
          confirmedAt={null}
          unincorporatedCount={0}
          rebuild={null}
          built={false}
          action={buildButton("Build blueprint", true)}
          pulse={pulse}
        />
      ) : (
        <BlueprintReport
          blueprint={liveBlueprint}
          confirmedAt={blueprintState.confirmedAt}
          unincorporatedCount={
            blueprintState.state === "live_stale" ? blueprintState.unincorporatedCount : 0
          }
          rebuild={buildButton("Rebuild", blueprintState.state === "live_stale")}
          built={true}
          pulse={pulse}
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

/**
 * The overview, shaped as a STANDING BRIEF rather than a list of counters (BRAND §5: "when a card
 * summarizes many items, shape it as a standing brief, not a list"). Four parts, in this order:
 * masthead (scope + hard counts) → lede in the agent's voice → the chain and its break → the
 * ledger, where every fact carries where it came from.
 *
 * The chain is the signature element and it earns that by encoding something true: the segments are
 * the growth engine's own sequence, so the FIRST incomplete link is the one worth acting on, and
 * everything after it rests on facts the system does not have. That is why the stations after the
 * break are dimmed rather than merely uncoloured.
 */
function BlueprintReport({
  blueprint,
  confirmedAt,
  unincorporatedCount,
  rebuild,
  built,
  action,
  pulse,
}: {
  blueprint: BusinessBlueprint;
  confirmedAt: number | null;
  unincorporatedCount: number;
  /** null before the first build — there is no confirmation date or rebuild to offer yet. */
  rebuild: React.ReactNode | null;
  /** false = nothing built yet; the brief explains the machine instead of reporting on it. */
  built: boolean;
  /** The primary call to action for this state, rendered under the lede. */
  action?: React.ReactNode;
  pulse?: { segments: Record<string, SegmentPulse>; globals: PulseGlobals };
}) {
  const [open, setOpen] = useState<string | null>(null);
  const openSegment = BLUEPRINT_SEGMENTS.find((s) => s.id === open) ?? null;

  const known = BLUEPRINT_SEGMENTS.filter((s) => {
    const { filled, total } = segmentFill(blueprint, s);
    return total > 0 && filled === total;
  });
  const gap = firstGap(blueprint);
  const captured = BLUEPRINT_FIELDS.filter((f) => blueprint[f] !== null).length;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* Bleeds to the card edge. The -1.25rem matches `card`'s padding in styles.ts. */}
      <div
        style={{
          margin: "-1.25rem -1.25rem 0",
          padding: "1.05rem 1.25rem",
          background: "var(--teal-900)",
          color: "#fff",
          borderRadius: "1.1rem 1.1rem 0 0",
        }}
      >
        <div
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.11em",
            textTransform: "uppercase",
            color: "var(--teal-400)",
          }}
        >
          Business blueprint
          {built
            ? confirmedAt === null
              ? " · confirmed"
              : ` · confirmed ${formatConfirmedAt(confirmedAt)}`
            : " · not built yet"}
        </div>
        <h2 style={{ margin: "0.3rem 0 0.75rem", fontSize: "1.15rem", fontWeight: 700 }}>
          {!built
            ? "I haven't formed a picture of your business yet"
            : gap === null
              ? "Everything I can record about this business is captured"
              : `The gap is ${SEGMENT_COPY[gap.id]?.short ?? gap.label.toLowerCase()}`}
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.6rem" }}>
          <Kpi n={captured} k="facts captured" />
          <Kpi
            n={BLUEPRINT_FIELDS.length - captured}
            k={built ? "still unknown" : "I could know"}
          />
          {unincorporatedCount > 0 && <Kpi n={unincorporatedCount} k="documents added since" />}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.5 }}>
        {built ? (
          <>
            {known.length > 0 && (
              <>
                I know{" "}
                <strong>
                  {joinPhrases(known.map((s) => SEGMENT_COPY[s.id]?.known ?? s.label))}
                </strong>
                .{" "}
              </>
            )}
            <span style={{ color: "var(--ink-soft)" }}>
              {gap === null
                ? "Nothing fillable is missing."
                : `I don't know ${SEGMENT_COPY[gap.id]?.gap ?? gap.label.toLowerCase()}.`}
            </span>
          </>
        ) : (
          <>
            Building it reads your profile and your vault documents and turns them into the standing
            context every agent works from, split into the parts of your business below.{" "}
            <strong>One model call.</strong>
          </>
        )}
      </p>

      {action !== undefined && <div>{action}</div>}

      {pulse !== undefined &&
        (() => {
          const readout = composeReadout(pulse.segments, pulse.globals, Date.now());
          return readout === null ? null : (
            <p
              role="status"
              style={{
                margin: 0,
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--teal-900)",
              }}
            >
              {readout}
            </p>
          );
        })()}

      <BlueprintCanvas
        blueprint={blueprint}
        built={built}
        gapId={gap?.id ?? null}
        selectedId={open}
        onSelect={(id) => setOpen(open === id ? null : id)}
        pulse={pulse?.segments}
      />

      {built && gap !== null && <NeedsYou segment={gap} />}

      {built && (
        <SegmentLedger
          blueprint={blueprint}
          open={open}
          onToggle={(id) => setOpen(open === id ? null : id)}
        />
      )}

      {openSegment && (
        <SegmentAnatomy
          segment={openSegment}
          blueprint={blueprint}
          pulse={pulse?.segments[openSegment.id]}
        />
      )}

      {rebuild !== null && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>{rebuild}</div>
      )}
    </div>
  );
}

function Kpi({ n, k }: { n: number; k: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "1.45rem",
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontSize: "0.66rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "rgb(255 255 255 / 62%)",
          marginTop: "0.25rem",
        }}
      >
        {k}
      </div>
    </div>
  );
}

function NeedsYou({ segment }: { segment: BlueprintSegment }) {
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: "0.9rem", overflow: "hidden" }}>
      <div
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
          padding: "0.55rem 0.9rem",
          borderBottom: "1px solid var(--rule)",
          background: "var(--canvas)",
        }}
      >
        Needs you
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: "0.9rem", padding: "0.8rem 0.9rem" }}
      >
        {/* A neutral stripe. Priority is weight and rule, never the approval amber — that token is
            the review gate's alone (BRAND §2), and this is a gap, not a thing awaiting approval. */}
        <span
          aria-hidden="true"
          style={{
            width: 3,
            alignSelf: "stretch",
            background: "var(--ink)",
            borderRadius: 2,
            flex: "none",
          }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: "0.94rem" }}>{segment.label}</strong>
          <span
            style={{
              display: "block",
              fontSize: "0.83rem",
              color: "var(--ink-soft)",
              marginTop: "0.1rem",
            }}
          >
            I don't know {SEGMENT_COPY[segment.id]?.gap ?? segment.label.toLowerCase()} — everything
            after this rests on it.
          </span>
        </span>
        {segment.specialist !== null && <AskSpecialist segment={segment} />}
      </div>
    </div>
  );
}

/**
 * The quiet ledger: one ruled row per segment, each carrying WHERE the fact came from. Provenance
 * is the blueprint's whole point — a fact you stated is settled, a fact inferred from a document is
 * challengeable — so it gets a column rather than a footnote.
 *
 * Rows are buttons: the row IS the disclosure control, so there is no separate affordance to miss.
 */
function SegmentLedger({
  blueprint,
  open,
  onToggle,
}: {
  blueprint: BusinessBlueprint;
  open: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid" }}>
      {BLUEPRINT_SEGMENTS.map((segment) => {
        const { filled, total } = segmentFill(blueprint, segment);
        const headline = segmentHeadline(blueprint, segment);
        const entry = segment.fields.map((f) => blueprint[f]).find((e) => e !== null) ?? null;
        const isOpen = open === segment.id;
        return (
          <button
            key={segment.id}
            type="button"
            onClick={() => onToggle(segment.id)}
            aria-expanded={isOpen}
            aria-controls={isOpen ? `segment-detail-${segment.id}` : undefined}
            style={{
              appearance: "none",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
              background: isOpen ? "var(--canvas)" : "transparent",
              border: "none",
              borderTop: "1px solid var(--rule)",
              color: "var(--ink)",
              display: "grid",
              gridTemplateColumns: "minmax(6.5rem, 0.6fr) minmax(0, 1.6fr) auto",
              gap: "0.75rem",
              alignItems: "start",
              padding: "0.6rem 0.4rem",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{segment.label}</span>
            <span style={{ fontSize: "0.9rem", minWidth: 0 }}>
              {headline ?? (
                <em style={{ fontStyle: "normal", color: "var(--ink-soft)" }}>
                  {total === 0 ? "Not tracked yet" : "Not captured"}
                </em>
              )}
              {total > 0 && filled > 0 && filled < total && (
                <span
                  style={{
                    display: "block",
                    fontSize: "0.76rem",
                    color: "var(--ink-soft)",
                    marginTop: "0.1rem",
                  }}
                >
                  {filled} of {total} captured
                </span>
              )}
            </span>
            <ProvenancePill entry={entry} />
          </button>
        );
      })}
    </div>
  );
}

/** Where a fact came from, in one mark: the user's own words, or the document it was inferred from. */
function ProvenancePill({ entry }: { entry: { origin: string; source?: string } | null }) {
  if (entry === null) {
    return (
      <span
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          color: "var(--ink-soft)",
          border: "1px dashed var(--rule)",
          borderRadius: "0.3rem",
          padding: "0.2rem 0.4rem",
          whiteSpace: "nowrap",
        }}
      >
        —
      </span>
    );
  }
  const stated = entry.origin === "stated";
  return (
    <span
      style={{
        fontSize: "0.68rem",
        fontWeight: 700,
        borderRadius: "0.3rem",
        padding: "0.2rem 0.45rem",
        maxWidth: "10rem",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        background: stated
          ? "color-mix(in srgb, var(--teal-600) 13%, transparent)"
          : "color-mix(in srgb, var(--ink-soft) 13%, transparent)",
        color: stated ? "var(--teal-900)" : "var(--ink-soft)",
      }}
    >
      {stated ? "your words" : (entry.source ?? "a document")}
    </span>
  );
}
