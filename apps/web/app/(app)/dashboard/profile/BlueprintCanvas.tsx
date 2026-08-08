"use client";

import { api } from "@pikar/backend/api";
import {
  BLUEPRINT_SEGMENTS,
  type BlueprintDiffRow,
  type BlueprintField,
  type BlueprintSegment,
  type BusinessBlueprint,
  recencyLevel,
  SEGMENT_FLOW,
  type SegmentPulse,
  segmentFill,
} from "@pikar/core";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

// The blueprint drawn as a blueprint: segments are nodes on a pannable, zoomable sheet and the
// wiring between them is the growth engine's own flow (`SEGMENT_FLOW` in core).
//
// Geometry is model-space, never DOM-measured. Every node is exactly NODE_W x NODE_H, so an edge's
// endpoints are pure arithmetic on {x,y} — which is what lets the wires stay correct under a CSS
// transform. Measuring `getBoundingClientRect` inside a scaled container is the classic way this
// kind of canvas ends up with wires that drift as you zoom.
//
// Positions persist per browser (the AbnormalBriefBanner localStorage idiom). Arrangement is the
// user's; the CONNECTIONS are not — dragging never rewires anything, because the wiring is a claim
// about the business, not a preference.

const NODE_W = 208;
const NODE_H = 86;
const LAYOUT_KEY = "pikar:blueprintLayout";

/** Home positions in model space. Left-to-right reads as the engine's order. */
const HOME: Record<string, { x: number; y: number }> = {
  foundation: { x: 40, y: 150 },
  offer: { x: 270, y: 150 },
  "money-model": { x: 500, y: 55 },
  leads: { x: 500, y: 245 },
  direction: { x: 730, y: 150 },
  evidence: { x: 40, y: 320 },
};

// ── document provenance ─────────────────────────────────────────────────────────────────────────
// Vault documents are listed INSIDE the node whose facts they produced, not in a lane of their own:
// a document only means something next to the fact it produced. What a list could never show is
// which document is actually load-bearing and which one you uploaded and learned nothing from — so
// a doc feeding three segments appears in all three, and everything the blueprint never cited is
// reported as a count under the sheet.
//
// The join key is the document TITLE, because that is what a derived entry stores (`blueprint.ts`
// keeps `source: source.title`, never a docId). Consequence, and it is deliberate to surface it: a
// renamed or deleted document leaves a fact whose source matches nothing, which renders as an
// uncited document rather than a silent hole.
const DOC_ROW = 15; // one document line inside a node
const DOC_MAX = 3; // more than this collapses to "+N more"

/** A node is as tall as its content: base, plus a row per document it carries, plus the "+N" row.
 *  Deterministic from the model, so edge endpoints stay pure arithmetic and never need measuring. */
function nodeHeight(docCount: number): number {
  if (docCount === 0) return NODE_H;
  return NODE_H + 12 + Math.min(docCount, DOC_MAX) * DOC_ROW + (docCount > DOC_MAX ? DOC_ROW : 0);
}

type Point = { x: number; y: number };
type Layout = Record<string, Point>;
type VaultDoc = { _id: string; title: string; status: string };

const clampScale = (s: number) => Math.min(1.6, Math.max(0.45, s));

function readLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as Layout) : {};
  } catch {
    return {};
  }
}

export function BlueprintCanvas({
  blueprint,
  built,
  gapId,
  selectedId,
  onSelect,
  draftRows,
  acceptedContradictions,
  pulse,
}: {
  blueprint: BusinessBlueprint;
  built: boolean;
  gapId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Draft mode. When present, the sheet stops reporting the confirmed picture and starts showing
   * what a rebuild is PROPOSING — which segments a document disagrees with, and which have new
   * facts waiting. The canvas never resolves anything itself: `BlueprintDiff` owns the accept
   * state and the one confirm mutation, and this only reflects it.
   */
  draftRows?: readonly BlueprintDiffRow[];
  acceptedContradictions?: ReadonlySet<BlueprintField>;
  pulse?: Record<string, SegmentPulse>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(() =>
    Object.fromEntries(BLUEPRINT_SEGMENTS.map((s) => [s.id, HOME[s.id] ?? { x: 40, y: 40 }])),
  );
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverDoc, setHoverDoc] = useState<string | null>(null);

  // Cheap metadata read — the same query the vault page and the brief banner already use, so
  // Convex dedupes the subscription rather than opening a second one.
  const vaultDocs = useQuery(api.vault.listVaultDocs, {}) as VaultDoc[] | undefined;

  // title -> the segments it produced a fact for. Built from the blueprint, so a document that
  // contributed nothing simply never appears as a key and its chip draws no wires.
  const sourceToSegments = new Map<string, Set<string>>();
  for (const segment of BLUEPRINT_SEGMENTS) {
    for (const field of segment.fields) {
      const entry = blueprint[field];
      if (entry === null || entry.origin !== "derived" || entry.source === undefined) continue;
      const set = sourceToSegments.get(entry.source) ?? new Set<string>();
      set.add(segment.id);
      sourceToSegments.set(entry.source, set);
    }
  }

  // Segment -> the documents that produced a fact in it. A document feeding three segments appears
  // in all three: it really is doing three jobs, and hiding that would flatter the picture.
  const docsForSegment = new Map<string, string[]>();
  for (const [title, segments] of sourceToSegments) {
    for (const id of segments) docsForSegment.set(id, [...(docsForSegment.get(id) ?? []), title]);
  }

  // Everything the blueprint never cited. Reported as a count under the sheet, not as a lane —
  // a document that contributed nothing has no node to live in, and that IS the finding.
  const uncited = (vaultDocs ?? [])
    .map((d) => d.title)
    .filter((title) => !sourceToSegments.has(title));

  // Saved arrangement loads after mount — localStorage does not exist during SSR.
  useEffect(() => {
    const saved = readLayout();
    if (Object.keys(saved).length > 0) setLayout((base) => ({ ...base, ...saved }));
  }, []);

  const persist = useCallback((next: Layout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the arrangement is per-session then, never an error the user must handle */
    }
  }, []);

  // ── pointer handling ───────────────────────────────────────────────────────────────────────
  // One handler set covers mouse, pen and touch. `pointers` tracks live contacts so a second
  // finger turns a pan into a pinch without a separate touch code path.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    | { kind: "node"; id: string; startX: number; startY: number; origin: Point; moved: boolean }
    | { kind: "pan"; startX: number; startY: number; origin: Point }
    | { kind: "pinch"; startDist: number; startScale: number }
    | null
  >(null);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        gesture.current = {
          kind: "pinch",
          startDist: Math.hypot(a.x - b.x, a.y - b.y),
          startScale: view.scale,
        };
      }
      return;
    }

    const node = (e.target as HTMLElement).closest("[data-segment]");
    const id = node?.getAttribute("data-segment") ?? null;
    gesture.current =
      id !== null
        ? {
            kind: "node",
            id,
            startX: e.clientX,
            startY: e.clientY,
            origin: layout[id] ?? { x: 0, y: 0 },
            moved: false,
          }
        : { kind: "pan", startX: e.clientX, startY: e.clientY, origin: { x: view.x, y: view.y } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g === null) return;

    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setView((v) => ({ ...v, scale: clampScale((dist / g.startDist) * g.startScale) }));
      return;
    }

    if (g.kind === "pan") {
      setView((v) => ({
        ...v,
        x: g.origin.x + (e.clientX - g.startX),
        y: g.origin.y + (e.clientY - g.startY),
      }));
      return;
    }

    // Node drag. Movement is divided by scale so a node tracks the finger at any zoom level.
    const dx = (e.clientX - g.startX) / view.scale;
    const dy = (e.clientY - g.startY) / view.scale;
    if (!g.moved && Math.hypot(dx, dy) < 4 / view.scale) return; // below threshold: still a tap
    if (!g.moved) {
      g.moved = true;
      setDragId(g.id);
    }
    setLayout((l) => ({ ...l, [g.id]: { x: g.origin.x + dx, y: g.origin.y + dy } }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "node") {
      // A tap that never crossed the threshold selects; a real drag saves the arrangement.
      // `layout` is current here — every move re-rendered — so this persists outside the state
      // updater. Writing localStorage inside one would run twice under StrictMode.
      if (!g.moved) onSelect(g.id);
      else persist(layout);
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragId(null);
    }
  };

  const zoomBy = (factor: number) =>
    setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }));

  const resetLayout = () => {
    const home = Object.fromEntries(
      BLUEPRINT_SEGMENTS.map((s) => [s.id, HOME[s.id] ?? { x: 40, y: 40 }]),
    );
    setLayout(home);
    persist(home);
    setView({ x: 0, y: 0, scale: 1 });
  };

  const nudge = (id: string, dx: number, dy: number) =>
    setLayout((l) => {
      const next = { ...l, [id]: { x: (l[id]?.x ?? 0) + dx, y: (l[id]?.y ?? 0) + dy } };
      persist(next);
      return next;
    });

  /** Contradictions and additions this segment carries in the pending draft. */
  const draftFor = (segment: BlueprintSegment) => {
    if (draftRows === undefined) return null;
    const fields = new Set<string>(segment.fields);
    const rows = draftRows.filter((r) => fields.has(r.field));
    const contradictions = rows.filter((r) => r.kind === "contradiction");
    return {
      contradictions,
      additions: rows.filter((r) => r.kind === "addition").length,
      // "Taking the document's word" only once EVERY contradiction here is ticked — a segment
      // half-resolved must not read as settled.
      allAccepted:
        contradictions.length > 0 &&
        contradictions.every((r) => acceptedContradictions?.has(r.field) === true),
    };
  };

  const isDone = (segment: BlueprintSegment) => {
    const { filled, total } = segmentFill(blueprint, segment);
    return built && total > 0 && filled === total;
  };

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "relative",
          height: "clamp(19rem, 52vw, 27rem)",
          borderRadius: "0.9rem",
          overflow: "hidden",
          background: "var(--teal-900)",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(64 202 208 / 16%) 1px, transparent 0)",
          backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          // Without this the browser scrolls the page instead of letting us pan/pinch on touch.
          touchAction: "none",
          cursor: dragId !== null ? "grabbing" : "grab",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
          >
            <title>Segment wiring</title>
            {SEGMENT_FLOW.map((edge) => {
              const a = layout[edge.from];
              const b = layout[edge.to];
              if (!a || !b) return null;
              const source = BLUEPRINT_SEGMENTS.find((s) => s.id === edge.from);
              const sx = a.x + NODE_W;
              const sy = a.y + nodeHeight((docsForSegment.get(edge.from) ?? []).length) / 2;
              const tx = b.x;
              const ty = b.y + nodeHeight((docsForSegment.get(edge.to) ?? []).length) / 2;
              const bend = Math.max(40, Math.abs(tx - sx) * 0.55);
              // A wire only "flows" when its source is fully captured, so the animation stops
              // exactly where the facts run out. Motion that reports state, not decoration.
              const flowing = edge.kind === "feeds" && source !== undefined && isDone(source);
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  d={`M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`}
                  fill="none"
                  strokeWidth={1.6}
                  stroke={
                    edge.kind === "informs"
                      ? "rgb(64 202 208 / 26%)"
                      : flowing
                        ? "var(--teal-400)"
                        : "rgb(255 255 255 / 28%)"
                  }
                  strokeDasharray={edge.kind === "informs" ? "3 5" : flowing ? "5 7" : "2 4"}
                  className={flowing ? "bp-wire-flow" : undefined}
                />
              );
            })}
          </svg>

          {BLUEPRINT_SEGMENTS.map((segment) => {
            const at = layout[segment.id];
            if (!at) return null;
            const { filled, total } = segmentFill(blueprint, segment);
            const done = isDone(segment);
            const segDocs = docsForSegment.get(segment.id) ?? [];
            const draft = draftFor(segment);
            const contradicted = draft !== null && draft.contradictions.length > 0;
            const isGap = built && segment.id === gapId;
            const selected = segment.id === selectedId;

            const segPulse = pulse?.[segment.id];
            const breathing = (segPulse?.inFlight ?? 0) > 0;
            const recency = recencyLevel(segPulse?.lastActivityAt ?? null, Date.now());
            const flight = breathing ? " · run in flight" : "";

            return (
              <button
                key={segment.id}
                type="button"
                data-segment={segment.id}
                aria-pressed={selected}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 16 : 4;
                  const moves: Record<string, [number, number]> = {
                    ArrowLeft: [-step, 0],
                    ArrowRight: [step, 0],
                    ArrowUp: [0, -step],
                    ArrowDown: [0, step],
                  };
                  const move = moves[e.key];
                  if (move) {
                    e.preventDefault();
                    nudge(segment.id, move[0], move[1]);
                  }
                }}
                style={{
                  position: "absolute",
                  left: at.x,
                  top: at.y,
                  width: NODE_W,
                  height: nodeHeight(segDocs.length),
                  display: "grid",
                  gridTemplateRows: "auto 1fr",
                  textAlign: "left",
                  font: "inherit",
                  padding: 0,
                  borderRadius: "0.55rem",
                  cursor: dragId === segment.id ? "grabbing" : "grab",
                  background: selected ? "#fff" : "rgb(255 255 255 / 7%)",
                  color: selected ? "var(--teal-900)" : "#fff",
                  border: `${contradicted ? 2 : 1}px ${isGap && !selected && !contradicted ? "dashed" : "solid"} ${
                    selected
                      ? "#fff"
                      : contradicted
                        ? "#fff"
                        : isGap
                          ? "#fff"
                          : done
                            ? "rgb(64 202 208 / 70%)"
                            : "rgb(64 202 208 / 34%)"
                  }`,
                  opacity:
                    hoverDoc !== null &&
                    !(sourceToSegments.get(hoverDoc) ?? new Set()).has(segment.id)
                      ? 0.3
                      : total === 0 && !selected
                        ? 0.62
                        : recency === "quiet"
                          ? 0.7
                          : recency === "recent"
                            ? 0.85
                            : 1,
                  boxShadow:
                    dragId === segment.id
                      ? "0 22px 40px -18px rgb(0 0 0 / 85%)"
                      : "0 6px 18px -12px rgb(0 0 0 / 70%)",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.35rem 0.5rem",
                    borderBottom: `1px solid ${selected ? "rgb(11 79 74 / 15%)" : "rgb(64 202 208 / 22%)"}`,
                    fontSize: "0.56rem",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    color: selected ? "var(--teal-600)" : "rgb(64 202 208 / 92%)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={breathing ? "bp-node-pulse" : undefined}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flex: "none",
                      background: breathing
                        ? "var(--teal-400)"
                        : done
                          ? "var(--teal-400)"
                          : isGap
                            ? selected
                              ? "var(--teal-600)"
                              : "#fff"
                            : "rgb(255 255 255 / 30%)",
                    }}
                  />
                  {segment.label.toUpperCase()}
                </span>
                <span
                  style={{
                    padding: "0.4rem 0.5rem",
                    display: "grid",
                    alignContent: "start",
                    gap: "0.2rem",
                  }}
                >
                  <span style={{ fontSize: "0.78rem", opacity: selected ? 0.75 : 0.62 }}>
                    {draft !== null && (draft.contradictions.length > 0 || draft.additions > 0)
                      ? [
                          draft.contradictions.length > 0
                            ? `${draft.contradictions.length} disagreement${draft.contradictions.length === 1 ? "" : "s"}`
                            : null,
                          draft.additions > 0 ? `${draft.additions} new` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : total === 0
                        ? `not tracked yet${flight}`
                        : !built
                          ? `not built yet${flight}`
                          : `${filled} of ${total}${isGap ? " · needs you" : ""}${flight}`}
                  </span>

                  {/* A contradicted node splits: your side and the document's side, with the ticked
                      one lit. The tick itself lives in the review below — this reports the choice,
                      it does not make it. */}
                  {draft !== null && draft.contradictions.length > 0 && (
                    <span
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 2,
                        marginTop: "0.1rem",
                        fontSize: "0.56rem",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span
                        style={{
                          padding: "0.15rem 0.25rem",
                          borderRadius: "0.2rem 0 0 0.2rem",
                          textAlign: "center",
                          background: draft.allAccepted
                            ? "rgb(255 255 255 / 10%)"
                            : selected
                              ? "var(--teal-600)"
                              : "var(--teal-400)",
                          color: draft.allAccepted
                            ? "inherit"
                            : selected
                              ? "#fff"
                              : "var(--teal-900)",
                          opacity: draft.allAccepted ? 0.5 : 1,
                        }}
                      >
                        YOURS
                      </span>
                      <span
                        style={{
                          padding: "0.15rem 0.25rem",
                          borderRadius: "0 0.2rem 0.2rem 0",
                          textAlign: "center",
                          background: draft.allAccepted
                            ? selected
                              ? "var(--teal-600)"
                              : "var(--teal-400)"
                            : "rgb(255 255 255 / 10%)",
                          color: draft.allAccepted
                            ? selected
                              ? "#fff"
                              : "var(--teal-900)"
                            : "inherit",
                          opacity: draft.allAccepted ? 1 : 0.5,
                        }}
                      >
                        DOC
                      </span>
                    </span>
                  )}
                  {/* The documents that produced this segment's facts, IN the node. Provenance is
                      local — a document only means something next to the fact it produced. Before a
                      build there is nothing to attach, so the node says so rather than lying. */}
                  {built && segDocs.length > 0 && (
                    <span
                      style={{
                        display: "grid",
                        gap: 2,
                        marginTop: "0.3rem",
                        paddingTop: "0.3rem",
                        borderTop: `1px solid ${selected ? "rgb(11 79 74 / 12%)" : "rgb(64 202 208 / 20%)"}`,
                      }}
                    >
                      {segDocs.slice(0, DOC_MAX).map((title) => (
                        <span
                          key={title}
                          onPointerEnter={() => setHoverDoc(title)}
                          onPointerLeave={() => setHoverDoc((h) => (h === title ? null : h))}
                          title={title}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            fontSize: "0.6rem",
                            lineHeight: `${DOC_ROW - 3}px`,
                            color: selected ? "var(--teal-900)" : "rgb(255 255 255 / 78%)",
                            opacity: hoverDoc === null || hoverDoc === title ? 1 : 0.45,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 4,
                              height: 4,
                              flex: "none",
                              borderRadius: 1,
                              background: selected ? "var(--teal-600)" : "var(--teal-400)",
                            }}
                          />
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {title}
                          </span>
                        </span>
                      ))}
                      {segDocs.length > DOC_MAX && (
                        <span
                          style={{
                            fontSize: "0.58rem",
                            lineHeight: `${DOC_ROW - 3}px`,
                            opacity: 0.6,
                            paddingLeft: "0.55rem",
                          }}
                        >
                          +{segDocs.length - DOC_MAX} more
                        </span>
                      )}
                    </span>
                  )}

                  {total > 0 && (
                    <span
                      aria-hidden="true"
                      style={{
                        height: 3,
                        borderRadius: 2,
                        background: selected ? "rgb(11 79 74 / 15%)" : "rgb(255 255 255 / 15%)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${built ? (filled / total) * 100 : 0}%`,
                          background: selected ? "var(--teal-600)" : "var(--teal-400)",
                        }}
                      />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Controls sit OUTSIDE the transformed layer so they stay put and stay the same size. */}
        <div
          style={{
            position: "absolute",
            right: "0.6rem",
            bottom: "0.6rem",
            display: "flex",
            gap: "0.3rem",
          }}
        >
          {[
            { t: "−", f: () => zoomBy(1 / 1.2), l: "Zoom out" },
            { t: "+", f: () => zoomBy(1.2), l: "Zoom in" },
            { t: "⤾", f: resetLayout, l: "Reset layout" },
          ].map((b) => (
            <button
              key={b.l}
              type="button"
              aria-label={b.l}
              title={b.l}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={b.f}
              style={{
                width: 30,
                height: 30,
                borderRadius: "0.45rem",
                border: "1px solid rgb(64 202 208 / 35%)",
                background: "rgb(11 79 74 / 65%)",
                color: "#fff",
                fontSize: "0.9rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              {b.t}
            </button>
          ))}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: "0.76rem", color: "var(--ink-soft)" }}>
        Drag a section to arrange it, drag the sheet to pan, pinch or use −/+ to zoom. Your
        arrangement is remembered; the connections are fixed.
      </p>

      {/* Documents with no home on the sheet. Reported, never hidden: a file you uploaded that the
          blueprint never cited is a finding, not an empty state. */}
      {uncited.length > 0 && (
        <p
          style={{ margin: 0, fontSize: "0.76rem", color: "var(--ink-soft)" }}
          title={uncited.join(", ")}
        >
          {built
            ? `${uncited.length} document${uncited.length === 1 ? "" : "s"} in your vault ${uncited.length === 1 ? "hasn't" : "haven't"} contributed anything to this blueprint yet.`
            : `${uncited.length} document${uncited.length === 1 ? "" : "s"} waiting — build the blueprint and whatever they say about your business attaches to the sections below.`}
        </p>
      )}
    </div>
  );
}
