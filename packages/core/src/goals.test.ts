import { describe, expect, it } from "vitest";
import {
  countdown,
  cycleTimeDays,
  GOAL_LINE_CAP,
  GOALS_BLOCK_CAP,
  GOALS_SPINE_MAX,
  type Goal,
  goalsForSegment,
  nearestActive,
  renderGoalLines,
} from "./index";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 8); // 2026-08-08
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g1",
  segmentId: "direction",
  text: "Reach 10 paying customers",
  targetDate: NOW + 30 * DAY,
  status: "active",
  createdAt: NOW - 10 * DAY,
  statusChangedAt: NOW - 10 * DAY,
  ...over,
});

describe("nearestActive", () => {
  it("takes the soonest deadlines, ignores undated and non-active goals", () => {
    const picked = nearestActive(
      [
        goal({ id: "far", targetDate: NOW + 90 * DAY }),
        goal({ id: "soon", targetDate: NOW + 2 * DAY }),
        goal({ id: "undated", targetDate: undefined }),
        goal({ id: "done", targetDate: NOW + DAY, status: "achieved" }),
        goal({ id: "dropped", targetDate: NOW + DAY, status: "dropped" }),
        goal({ id: "mid", targetDate: NOW + 10 * DAY }),
      ],
      GOALS_SPINE_MAX,
    );
    expect(picked.map((g) => g.id)).toEqual(["soon", "mid", "far"]);
  });

  it("never returns more than the limit", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      goal({ id: `g${i}`, targetDate: NOW + i * DAY }),
    );
    expect(nearestActive(many, GOALS_SPINE_MAX)).toHaveLength(3);
  });
});

describe("renderGoalLines", () => {
  it("renders bullet, text and due date within the line cap", () => {
    expect(renderGoalLines([goal()])).toEqual(["- Reach 10 paying customers [due 2026-09-07]"]);
  });

  it("clips a long goal visibly and never exceeds the cap", () => {
    const [line] = renderGoalLines([goal({ text: "x".repeat(300) })]);
    expect(line?.length).toBeLessThanOrEqual(GOAL_LINE_CAP);
    expect(line).toContain("…");
    expect(line?.endsWith("[due 2026-09-07]")).toBe(true);
  });

  it("worst case fits the block budget the spine reserves", () => {
    const lines = renderGoalLines(
      Array.from({ length: GOALS_SPINE_MAX }, (_, i) =>
        goal({ id: `g${i}`, text: "y".repeat(300), targetDate: NOW + i * DAY }),
      ),
    );
    const block = ["Goals:", ...lines].join("\n").length + 1; // +1 = the blank line before it
    expect(block).toBeLessThanOrEqual(GOALS_BLOCK_CAP);
  });
});

describe("countdown", () => {
  it("counts days down, marks today, and says how overdue in words", () => {
    expect(countdown(NOW + 12 * DAY, NOW)).toBe("12d");
    expect(countdown(NOW + 1 * DAY, NOW)).toBe("1d");
    expect(countdown(NOW, NOW)).toBe("today");
    expect(countdown(NOW - 3 * DAY, NOW)).toBe("3d over");
  });
});

describe("cycleTimeDays", () => {
  it("measures set-to-achieved, and is null for anything unfinished", () => {
    expect(
      cycleTimeDays(goal({ status: "achieved", createdAt: NOW - 18 * DAY, statusChangedAt: NOW })),
    ).toBe(18);
    expect(cycleTimeDays(goal({ status: "active" }))).toBeNull();
    expect(cycleTimeDays(goal({ status: "dropped", statusChangedAt: NOW }))).toBeNull();
  });
});

describe("goalsForSegment", () => {
  const known = ["foundation", "offer", "direction"];

  it("returns a segment's own goals", () => {
    const mine = goal({ id: "mine", segmentId: "offer" });
    expect(goalsForSegment([mine, goal({ id: "other" })], "offer", known).map((g) => g.id)).toEqual(
      ["mine"],
    );
  });

  it("surfaces goals whose segment no longer exists under Direction, never dropping them", () => {
    const orphan = goal({ id: "orphan", segmentId: "deleted-segment" });
    expect(goalsForSegment([orphan], "direction", known).map((g) => g.id)).toEqual(["orphan"]);
    expect(goalsForSegment([orphan], "offer", known)).toEqual([]);
  });
});
