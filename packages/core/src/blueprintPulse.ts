// The blueprint's ACTIVITY layer (living-map spec §3, D1 as amended 2026-08-08). Pure aggregation
// over narrowed agent-step rows — Convex hands in counts-and-timestamps rows, never content.
//
// Attribution is the dispatch trace: a step whose `tool` is a specialist's `stepTool` literal IS
// that specialist having run. `requests.route` is deliberately not consulted — it holds the
// Executive Router's direct_llm|sub_agent|direct_tool decision, never a specialist name.

import { BLUEPRINT_SEGMENTS, type BlueprintSegment } from "./blueprintSegments";
import { SPECIALISTS } from "./specialists";

export type PulseStep = {
  readonly tool: string;
  readonly phase: "running" | "done" | "error";
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
};

export type SegmentPulse = {
  readonly inFlight: number;
  readonly lastActivityAt: number | null;
  readonly runs30d: number;
  readonly medianRunMs: number | null;
};

export type PulseGlobals = {
  readonly sent30d: number;
  readonly plansDone30d: number;
  readonly plansInFlight: number;
};

export const PULSE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** A `running` step older than this stops "breathing": a swallowed end-patch must not pulse
 *  forever (the agentSteps end-write lives inside an AI-SDK callback that swallows throws). */
export const STALE_RUN_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The dispatch-trace literal that attributes a step to this segment, or null where no agent
 *  owns the segment (Foundation, Direction) — those have no run pulse by design (D1/D2). */
export function dispatchToolFor(segment: BlueprintSegment): string | null {
  return segment.specialist === null ? null : SPECIALISTS[segment.specialist].stepTool;
}

export function aggregatePulse(
  steps: readonly PulseStep[],
  now: number,
): Record<string, SegmentPulse> {
  const out: Record<string, SegmentPulse> = {};
  for (const segment of BLUEPRINT_SEGMENTS) {
    const tool = dispatchToolFor(segment);
    if (tool === null) continue;
    const mine = steps.filter((s) => s.tool === tool && s.startedAt > now - PULSE_WINDOW_MS);
    let lastActivityAt: number | null = null;
    for (const s of mine) {
      const at = s.endedAt ?? s.startedAt;
      if (lastActivityAt === null || at > lastActivityAt) lastActivityAt = at;
    }
    const durations = mine
      .filter((s) => s.phase === "done" && s.durationMs !== undefined)
      .map((s) => s.durationMs as number)
      .sort((a, b) => a - b);
    out[segment.id] = {
      inFlight: mine.filter((s) => s.phase === "running" && now - s.startedAt < STALE_RUN_MS)
        .length,
      lastActivityAt,
      runs30d: mine.filter((s) => s.phase !== "running").length,
      medianRunMs:
        durations.length === 0 ? null : (durations[Math.floor((durations.length - 1) / 2)] ?? null),
    };
  }
  return out;
}

export type RecencyLevel = "fresh" | "recent" | "quiet";

/** Stepped, not continuous, so the same data always renders the same (spec §3.2). */
export function recencyLevel(lastActivityAt: number | null, now: number): RecencyLevel | null {
  if (lastActivityAt === null) return null;
  const age = now - lastActivityAt;
  if (age <= 7 * DAY_MS) return "fresh";
  if (age <= 30 * DAY_MS) return "recent";
  return "quiet";
}

const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The one-sentence readout above the sheet. Deterministic composition, in this order: in-flight
 * runs (segment order), plans in motion, emails sent, then the single quietest specialist section
 * (≥7 days idle). Null when nothing has ever moved — the quiet state is the absence of the line,
 * never a fake sentence (D2).
 */
export function composeReadout(
  pulse: Record<string, SegmentPulse>,
  globals: PulseGlobals,
  now: number,
): string | null {
  const parts: string[] = [];
  for (const segment of BLUEPRINT_SEGMENTS) {
    if ((pulse[segment.id]?.inFlight ?? 0) > 0) parts.push(`${segment.label} run in flight`);
  }
  if (globals.plansInFlight > 0) parts.push(`${n(globals.plansInFlight, "plan")} in motion`);
  if (globals.plansDone30d > 0)
    parts.push(`${n(globals.plansDone30d, "plan")} completed in 30 days`);
  if (globals.sent30d > 0) parts.push(`${n(globals.sent30d, "email")} sent in 30 days`);
  let quietest: { label: string; days: number } | null = null;
  for (const segment of BLUEPRINT_SEGMENTS) {
    const p = pulse[segment.id];
    if (p === undefined || p.lastActivityAt === null || p.inFlight > 0) continue;
    const days = Math.floor((now - p.lastActivityAt) / DAY_MS);
    if (days >= 7 && days > (quietest?.days ?? -1)) quietest = { label: segment.label, days };
  }
  if (quietest !== null) parts.push(`${quietest.label} quiet ${quietest.days} days`);
  return parts.length === 0 ? null : parts.join(" · ");
}
