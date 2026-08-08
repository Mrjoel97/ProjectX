// Goals & milestones (living-map spec §5, §5.3 as amended 2026-08-08). Pure: selection, the
// spine's rendered block, countdowns and cycle time. The Convex adapter owns storage and scoping.
//
// The spine block's size is ARITHMETIC, not hope: `renderSpine` throws above SPINE_CHAR_CAP, and
// that throw would break every cockpit turn and every vault-grounding call. GOALS_BLOCK_CAP is the
// worst case this module can emit, and `blueprint.test.ts` asserts a full spine plus that worst
// case still fits.

export type GoalStatus = "active" | "achieved" | "dropped";

export type Goal = {
  readonly id: string;
  /** A `BLUEPRINT_SEGMENTS` id. Validated at WRITE time; a stale id still renders (see
   *  `goalsForSegment`) rather than making the goal disappear. */
  readonly segmentId: string;
  readonly text: string;
  /** ms. Absent = a direction without a deadline; never reaches the spine. */
  readonly targetDate?: number;
  /** One level only, enforced at write time. UI-only — the spine has no room for parentage. */
  readonly parentId?: string;
  readonly status: GoalStatus;
  readonly createdAt: number;
  readonly statusChangedAt: number;
};

/** The three nearest deadlines. More would not fit the spine's remaining headroom. */
export const GOALS_SPINE_MAX = 3;

/**
 * The cap on the WHOLE rendered line (`- <text> [due YYYY-MM-DD]`), the `FIELD_SPEC` idiom.
 * ` [due YYYY-MM-DD]` costs 17 and `- ` costs 2, so the text shows ~45 chars before clipping.
 */
export const GOAL_LINE_CAP = 64;

/** Worst case this module contributes to the spine: the header, MAX capped lines, and the
 *  newlines that join them plus the blank line above. Measured headroom today is 210. */
export const GOALS_BLOCK_CAP = "Goals:".length + GOALS_SPINE_MAX * GOAL_LINE_CAP + 5; // 203

/** Truncate VISIBLY. Mirrors `blueprint.ts`'s private `clip` — four lines beats widening that
 *  module's public surface for a helper this small. */
const clip = (s: string, n: number): string =>
  n <= 0 ? "" : s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC — deterministic, unlike a locale format, because this text is BYTES in a
 *  prompt and must not vary by the server's timezone. */
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The soonest-due ACTIVE goals, up to `limit`. Undated goals are excluded: the section is about
 * deadlines, and an undated intention would displace a dated one from a scarce slot.
 */
export function nearestActive(goals: readonly Goal[], limit: number): Goal[] {
  return goals
    .filter((g) => g.status === "active" && g.targetDate !== undefined)
    .sort(
      (a, b) => (a.targetDate as number) - (b.targetDate as number) || a.createdAt - b.createdAt,
    )
    .slice(0, limit);
}

/** One `- <text> [due YYYY-MM-DD]` per goal, each within GOAL_LINE_CAP. The date never yields
 *  budget to the text — a deadline the agent cannot read is the one thing this block is for. */
export function renderGoalLines(goals: readonly Goal[]): string[] {
  return goals.map((g) => {
    const due = g.targetDate === undefined ? "" : ` [due ${isoDay(g.targetDate)}]`;
    return `- ${clip(g.text, GOAL_LINE_CAP - 2 - due.length)}${due}`;
  });
}

/** "12d" / "today" / "3d over". Text, never colour-alone (BRAND §6). */
export function countdown(targetDate: number, now: number): string {
  const days = Math.round((targetDate - now) / DAY_MS);
  if (days === 0) return "today";
  return days > 0 ? `${days}d` : `${-days}d over`;
}

/** How long it took, set to achieved. Null unless achieved — a dropped goal took no time, it
 *  stopped, and an active one is still running. */
export function cycleTimeDays(goal: Goal): number | null {
  if (goal.status !== "achieved") return null;
  return Math.max(0, Math.round((goal.statusChangedAt - goal.createdAt) / DAY_MS));
}

/**
 * A segment's goals for the UI. A goal whose `segmentId` no longer matches any known segment
 * surfaces under Direction rather than vanishing — a goal the user typed must never become
 * unreachable because a segment id changed.
 */
export function goalsForSegment(
  goals: readonly Goal[],
  segmentId: string,
  knownSegmentIds: readonly string[],
): Goal[] {
  const known = new Set(knownSegmentIds);
  return goals.filter(
    (g) => g.segmentId === segmentId || (segmentId === "direction" && !known.has(g.segmentId)),
  );
}
