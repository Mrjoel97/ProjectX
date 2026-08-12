# Blueprint Goals & Milestones (Living-Map Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business can record what it is driving toward and by when; the canvas shows the nearest deadline per section, the anatomy lets you add/achieve/drop goals and reports how long achieved ones took, and every agent surface reads the three nearest deadlines through the spine.

**Architecture:** One new table (`goals`), two mutations + one query (thin Convex adapters), and a pure core module (`packages/core/src/goals.ts`) owning selection, countdown, cycle time, and the spine section. `renderSpine` gains ONE optional input; the block is budgeted inside the spine's **measured** remaining headroom so its existing overflow tripwire stays provable. UI is two additions to shipped surfaces: a milestone flag on the canvas node and a Direction band in the anatomy.

**Tech Stack:** `@pikar/core` pure TS + vitest, Convex `tenantQuery`/`tenantMutation` + `internal.audit.log`, React client components with inline styles + `globals.css` variables.

**Spec:** `docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md` §5 (as amended by Task 1), §6, §7, D3.

## Global Constraints

- Domain logic in `packages/core`; Convex functions are thin adapters (CLAUDE.md §1). Import `tenantQuery`/`tenantMutation` from `./lib/functions` — raw `query`/`mutation` imports are banned (CLAUDE.md §2).
- Read `packages/backend/convex/_generated/ai/guidelines.md` before writing any Convex code.
- **Audit payloads carry ids/counts/enums ONLY — never goal text** (CLAUDE.md §4). A goal's text is user content and lives only in the `goals` row.
- **The 11-field blueprint set stays CLOSED** (D3): goals are a separate table and never become `BLUEPRINT_FIELDS`. `serializeBlueprint` (the stored doc) is untouched, so the `- **Persona:**` detector constraint is never at risk.
- **The spine budget is arithmetic, not hope.** `renderSpine` throws above `SPINE_CHAR_CAP` (2500) and that throw would break every cockpit turn and every vault-grounding call. Measured worst case today: 11 field lines (caps sum 1960) + framing/intro/warning (314) + newlines (16) = **2290, leaving 210**. The goals block must provably fit inside that 210 — see Task 1's amendment for the constants.
- Never `Date.now()` inside a Convex query handler; `now` is an arg or the client's job.
- Colors via `globals.css` variables only; no component library. Honest zeros: no goals renders as words, never a fake count. Overdue is text ("3d over"), never colour-alone (BRAND §6).
- **Run `npx biome check --write` on every file you create or edit BEFORE committing** (the repo's CI lint gate is invisible to typecheck and build).
- Shared working tree: stage by exact path; NEVER `git add -A`; `git status --short` first; leave foreign files alone (a concurrent lane is active in `guardrails.*`, `voice.*`, `spendLedger.*`, `graphify-out/`). If a Stop hook flags a playbook for files you did not touch, do NOT edit it — say so and stop.
- `docs/playbooks/onboarding.md` watches `packages/core/src/blueprint*`, `packages/backend/convex/blueprint.ts` and the profile directory; new core/backend files must be registered in `docs/playbooks/watch.json` in the commit that creates them, or the Stop hook blocks.
- End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Uv9Jbj6YCdMrS5Gig4Gvz6`

---

### Task 1: Amend the spec — the spine goals block is budgeted, and parentage is UI-only

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md` (§5.3 only)

**Interfaces:** Produces the corrected contract Tasks 2 and 4 implement. No code.

**Why (context for the editor):** §5.3 promises "3 nearest-deadline active goals, each line capped like a field line" plus a `part of: <parent>` clause. Field-line caps are 200–240 chars each, so that block would cost ~600–720 chars. The measured worst-case spine is 2290 of 2500 — **210 chars of headroom**. The promised block overflows by ~400–500 and `renderSpine` would THROW at runtime for any tenant with a full blueprint and three goals, taking down the cockpit turn prompt and vault grounding with it. The fix keeps the cap unchanged (no prompt-budget increase, no owner decision) and shrinks the block to fit.

- [ ] **Step 1: Replace §5.3's body**

Keep the heading `### 5.3 Spine — the agent half`. Replace everything under it, up to (not including) `## 6. Accessibility`, with:

```
**Amended 2026-08-08 (pre-implementation).** The original text ("3 goals, each line capped like a
field line", with a `part of: <parent>` clause) is unimplementable: it costs ~600–720 chars against
a MEASURED headroom of 210. The spine's worst case today is 2290 of `SPINE_CHAR_CAP` = 2500 —
11 field lines (caps sum 1960) + framing and the staleness warning (314) + newlines (16) — and
`renderSpine` THROWS above the cap, so an overflow is a live outage on every cockpit turn and every
vault-grounding call, not a cosmetic bug.

`renderSpine` gains one optional trailing section, budgeted to fit the existing headroom with the
cap unchanged:

Goals:
- Reach 10 paying customers [due 2026-09-15]
- Ship the landing page [due 2026-08-20]

Constants (pure core, `packages/core/src/goals.ts`):

- `GOALS_SPINE_MAX = 3` — the three nearest deadlines among ACTIVE goals.
- `GOAL_LINE_CAP = 64` — the cap on the WHOLE rendered line, the `FIELD_SPEC` idiom. The date
  suffix costs 17 (` [due YYYY-MM-DD]`) and the bullet 2, so a goal's text shows ~45 chars and is
  clipped visibly with `…` (the existing `clip` helper), never silently.
- Worst case therefore costs `6 ("Goals:") + 3 × 64 + 5 newlines = 203 ≤ 210`. The arithmetic is
  asserted by a test that renders a FULL blueprint plus three max-length goals plus the staleness
  warning and checks the total against `SPINE_CHAR_CAP` — the same mutation-verified tripwire
  discipline as the field caps.

**Parentage is UI-only.** `part of: <parent>` cannot fit a 64-char line and is dropped from the
spine; `parentId` still exists on the row and still groups goals in the Direction band. An agent
needs to know what is due and when, not the tree shape.

A goal with no `targetDate` never reaches the spine: the section is about deadlines, and an
undated intention would displace a dated one from the three slots.

`serializeBlueprint` (the stored doc) is untouched — goals live in their own table, not the
blueprint markdown, so the `- **Persona:**` detector constraint is never at risk.
```

- [ ] **Step 2: Commit**

```bash
git status --short
git add docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md
git commit -m "docs(blueprint): amend the goals spine section to a provable char budget"
```

---

### Task 2: Core goals module (TDD)

**Files:**
- Create: `packages/core/src/goals.ts`
- Create: `packages/core/src/goals.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./goals";`)

**Interfaces:**
- Consumes: `clip` is PRIVATE to `blueprint.ts` — do NOT export it; write the 4-line equivalent in `goals.ts` (duplication of a trivial helper beats widening `blueprint.ts`'s public surface).
- Produces (Tasks 3–6 use these exact names):
  - `type GoalStatus = "active" | "achieved" | "dropped"`
  - `type Goal = { readonly id: string; readonly segmentId: string; readonly text: string; readonly targetDate?: number; readonly parentId?: string; readonly status: GoalStatus; readonly createdAt: number; readonly statusChangedAt: number }`
  - `const GOALS_SPINE_MAX: number` (3), `const GOAL_LINE_CAP: number` (64), `const GOALS_BLOCK_CAP: number` (203 — the computed worst case, exported so the spine test asserts against a named number)
  - `nearestActive(goals: readonly Goal[], limit: number): Goal[]`
  - `renderGoalLines(goals: readonly Goal[]): string[]`
  - `countdown(targetDate: number, now: number): string`
  - `cycleTimeDays(goal: Goal): number | null`
  - `goalsForSegment(goals: readonly Goal[], segmentId: string, knownSegmentIds: readonly string[]): Goal[]`

- [ ] **Step 1: Write the failing test**

`packages/core/src/goals.test.ts`:

```ts
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
    expect(goalsForSegment([mine, goal({ id: "other" })], "offer", known).map((g) => g.id)).toEqual([
      "mine",
    ]);
  });

  it("surfaces goals whose segment no longer exists under Direction, never dropping them", () => {
    const orphan = goal({ id: "orphan", segmentId: "deleted-segment" });
    expect(goalsForSegment([orphan], "direction", known).map((g) => g.id)).toEqual(["orphan"]);
    expect(goalsForSegment([orphan], "offer", known)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pikar/core exec vitest run src/goals.test.ts`
Expected: FAIL — `./goals` does not exist.

- [ ] **Step 3: Implement**

`packages/core/src/goals.ts`:

```ts
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
    .sort((a, b) => (a.targetDate as number) - (b.targetDate as number) || a.createdAt - b.createdAt)
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
    (g) =>
      g.segmentId === segmentId || (segmentId === "direction" && !known.has(g.segmentId)),
  );
}
```

- [ ] **Step 4: Export and run to green**

Add `export * from "./goals";` to `packages/core/src/index.ts` (alphabetical, beside the other blueprint exports).

Run: `pnpm --filter @pikar/core exec vitest run src/goals.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, register, commit**

Add to `docs/playbooks/watch.json`, in the `"onboarding.md"` array: `"packages/core/src/goals.ts"` and `"packages/core/src/goals.test.ts"`.

```bash
npx biome check --write packages/core/src/goals.ts packages/core/src/goals.test.ts
pnpm typecheck
git status --short
git add packages/core/src/goals.ts packages/core/src/goals.test.ts packages/core/src/index.ts docs/playbooks/watch.json
git commit -m "feat(core): goals module — selection, spine lines, countdown, cycle time"
```

---

### Task 3: The spine gains its goals block (TDD, budget-proved)

**Files:**
- Modify: `packages/core/src/blueprint.ts` (`renderSpine` only)
- Modify: `packages/core/src/blueprint.test.ts` (add the budget + rendering cases)

**Interfaces:**
- Consumes: `nearestActive`, `renderGoalLines`, `GOALS_SPINE_MAX`, `GOALS_BLOCK_CAP`, `type Goal` from `./goals`.
- Produces: `renderSpine(blueprint, opts)` where `opts` gains `goals?: readonly Goal[]`. **Omitting it must produce byte-identical output to today** — every existing spine test must pass untouched.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/blueprint.test.ts` (the spine section, after the existing spine tests). Match the file's existing import style; `FULL` is the fully-populated blueprint fixture already defined there:

```ts
  it("omits the goals block entirely when no goals are passed", () => {
    expect(renderSpine(FULL, { unincorporatedCount: 0 })).not.toContain("Goals:");
  });

  it("renders the nearest deadlines under a Goals heading", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 7, 8);
    const g = (id: string, text: string, inDays: number): Goal => ({
      id,
      segmentId: "direction",
      text,
      targetDate: now + inDays * day,
      status: "active",
      createdAt: now,
      statusChangedAt: now,
    });
    const spine = renderSpine(FULL, {
      unincorporatedCount: 0,
      goals: [g("b", "Ship the landing page", 12), g("a", "Reach 10 paying customers", 3)],
    });
    expect(spine).toContain("Goals:");
    // Nearest first, and the block sits inside the fence.
    expect(spine.indexOf("Reach 10 paying customers")).toBeLessThan(
      spine.indexOf("Ship the landing page"),
    );
    expect(spine.trimEnd().endsWith("</business_blueprint>")).toBe(true);
  });

  it("stays under the char cap at the worst case: full blueprint, staleness warning, max goals", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 7, 8);
    const goals: Goal[] = Array.from({ length: GOALS_SPINE_MAX + 2 }, (_, i) => ({
      id: `g${i}`,
      segmentId: "direction",
      text: "z".repeat(400),
      targetDate: now + i * day,
      status: "active" as const,
      createdAt: now,
      statusChangedAt: now,
    }));
    // Does not throw — the tripwire inside renderSpine is the assertion.
    const spine = renderSpine(FULL, { unincorporatedCount: 99, goals });
    expect(spine.length).toBeLessThanOrEqual(SPINE_CHAR_CAP);
    // Only GOALS_SPINE_MAX lines survive, and the block never exceeds its reserved budget.
    expect(spine.split("\n").filter((l) => l.includes("[due "))).toHaveLength(GOALS_SPINE_MAX);
  });
```

Add `GOALS_SPINE_MAX`, `type Goal` (and `GOALS_BLOCK_CAP` if you assert it) to the file's existing import from `./index` or `./goals` — follow whichever the file already uses.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @pikar/core exec vitest run src/blueprint.test.ts`
Expected: the three new cases FAIL (no `goals` option); every pre-existing case still PASSES.

- [ ] **Step 3: Implement**

In `packages/core/src/blueprint.ts`:

- Add to the imports: `import { GOALS_SPINE_MAX, type Goal, nearestActive, renderGoalLines } from "./goals";`
- Extend the signature: `opts: { unincorporatedCount: number; goals?: readonly Goal[] }`
- Build the block before the `out` array and splice it in **after the field lines and before the staleness warning**, so the warning stays the last thing the model reads:

```ts
  // The deadline block (spec §5.3 as amended). Budgeted, not hoped: `renderGoalLines` caps each
  // line and `nearestActive` caps the count, so the worst case is GOALS_BLOCK_CAP — which fits the
  // headroom the field caps leave under SPINE_CHAR_CAP. Absent goals render NOTHING, keeping the
  // no-goals spine byte-identical to before this block existed.
  const goalLines = renderGoalLines(nearestActive(opts.goals ?? [], GOALS_SPINE_MAX));
```

and inside `out`, between the field lines and the warning:

```ts
    ...(goalLines.length > 0 ? ["", "Goals:", ...goalLines] : []),
```

Update `renderSpine`'s doc comment with one line naming the new block and its budget.

- [ ] **Step 4: Run to green**

Run: `pnpm --filter @pikar/core exec vitest run src/blueprint.test.ts src/goals.test.ts`
Expected: ALL pass, including every pre-existing spine case (the byte-identical guarantee).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx biome check --write packages/core/src/blueprint.ts packages/core/src/blueprint.test.ts
pnpm typecheck
git status --short
git add packages/core/src/blueprint.ts packages/core/src/blueprint.test.ts
git commit -m "feat(core): spine carries the three nearest deadlines within its char budget"
```

---

### Task 4: The `goals` table, its writes, and the spine wiring (TDD)

**Files:**
- Modify: `packages/backend/convex/schema.ts` (one table)
- Create: `packages/backend/convex/goals.ts`
- Create: `packages/backend/convex/goals.test.ts`
- Modify: `packages/backend/convex/blueprint.ts` (`spineForTenant` only)

**Interfaces:**
- Consumes: `tenantQuery`/`tenantMutation` from `./lib/functions`; `internal.audit.log`; `BLUEPRINT_SEGMENTS`, `type Goal` from `@pikar/core`.
- Produces: `api.goals.listGoals` (no args → `Goal[]`), `api.goals.addGoal` (`{ segmentId, text, targetDate?, parentId? }` → `{ id }`), `api.goals.setGoalStatus` (`{ id, status }` → `{ ok: true }`). Tasks 5–6 consume `listGoals`.

- [ ] **Step 1: Read the Convex guidelines**

Read `packages/backend/convex/_generated/ai/guidelines.md` first.

- [ ] **Step 2: Add the table**

In `schema.ts`, beside the other tenant tables:

```ts
  // Living-map slice 3 (§5.1). The intention plane: what the business is driving toward and by
  // when. Deliberately NOT blueprint fields — the 11-field set is closed (D3), and a goal is a
  // claim with a lifecycle, not a fact about the business.
  goals: defineTable({
    tenantId: v.string(),
    segmentId: v.string(), // a BLUEPRINT_SEGMENTS id, validated at write
    text: v.string(), // user content — content plane ONLY, never audited (CLAUDE.md §4)
    targetDate: v.optional(v.number()),
    // One level only, enforced at write: a parent may not itself have a parent.
    parentId: v.optional(v.id("goals")),
    status: v.union(v.literal("active"), v.literal("achieved"), v.literal("dropped")),
    createdAt: v.number(),
    // Stamped on every transition. `statusChangedAt - createdAt` on an achieved goal IS the cycle
    // time — no history table until something needs more than the last transition.
    statusChangedAt: v.number(),
  }).index("by_tenant_status", ["tenantId", "status"]),
```

- [ ] **Step 3: Write the failing test**

`packages/backend/convex/goals.test.ts`. **Copy the harness idiom from `blueprintPulse.test.ts`** (the `convexTest` + `import.meta.glob` modules setup and the `withIdentity({ subject: "tenantA|s", issuer: "test" })` convention) — do not invent a different setup:

```ts
describe("goals", () => {
  it("adds a goal, lists it, and never leaks a sibling tenant's", async () => { /* addGoal as tenantA, seed a tenantB row via ctx.db.insert, assert listGoals returns only tenantA's */ });

  it("rejects an unknown segmentId", async () => { /* expect addGoal({ segmentId: "nope" }) to reject */ });

  it("rejects a second level of nesting", async () => { /* add parent, add child with parentId, expect adding a grandchild under the child to reject */ });

  it("stamps statusChangedAt on transition so cycle time is measurable", async () => {
    /* addGoal, setGoalStatus achieved, assert the row's statusChangedAt >= createdAt and status is achieved */
  });

  it("cannot touch another tenant's goal", async () => { /* tenantB's id passed to tenantA's setGoalStatus rejects */ });
});
```

Write the bodies out fully in the real file — the sketch above names the five cases, not the code.

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @pikar/backend exec vitest run convex/goals.test.ts`
Expected: FAIL — `api.goals` does not exist.

- [ ] **Step 5: Implement `goals.ts`**

```ts
// Thin adapter over the `goals` table (CLAUDE.md §1). Selection, rendering and cycle-time
// arithmetic live in `@pikar/core`'s goals module; this file scopes, validates and audits.
```

- `listGoals` — `tenantQuery`, no args; read `by_tenant_status` for each of the three statuses (or index on tenant and filter in memory only if the row count is provably small — prefer the indexed reads), map rows to the core `Goal` shape (`id: row._id`), return them.
- `addGoal` — `tenantMutation`, args `{ segmentId: v.string(), text: v.string(), targetDate: v.optional(v.number()), parentId: v.optional(v.id("goals")) }`. Validate: `segmentId` ∈ `BLUEPRINT_SEGMENTS` ids else `throw new ConvexError({ code: "INVALID_SEGMENT", segmentId })`; `text.trim()` non-empty and ≤ 500 chars else `ConvexError`; if `parentId` given, load it, require `parent.tenantId === ctx.tenantId` and `parent.parentId === undefined` (one level) else `ConvexError`. Insert with `createdAt`/`statusChangedAt` = `Date.now()` and `status: "active"`. Audit `goal.added` with `{ goalId, segmentId, hasTargetDate: boolean, nested: boolean }` — **never `text`**.
- `setGoalStatus` — `tenantMutation`, args `{ id: v.id("goals"), status: v.union(...) }`. Load, require `row.tenantId === ctx.tenantId` (else `ConvexError` — never a silent no-op), patch `{ status, statusChangedAt: Date.now() }`. Audit `goal.status_changed` with `{ goalId, from, to, cycleDays }` where `cycleDays` is a rounded number — ids, enums and counts only.

Follow `blueprint.ts:410`'s `ctx.runMutation(internal.audit.log, { tenantId: ctx.tenantId, correlationId: crypto.randomUUID(), eventType, actor: "user", payload })` shape exactly.

- [ ] **Step 6: Wire the spine**

In `packages/backend/convex/blueprint.ts`'s `spineForTenant`, read the tenant's ACTIVE goals and pass them:

```ts
      const goalRows = await ctx.db
        .query("goals")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", "active"))
        .collect();
      return renderSpine(blueprint, { unincorporatedCount: count, goals: goalRows.map(toGoal) });
```

where `toGoal` maps a row to the core shape (share it with `goals.ts` by exporting it there and importing, or inline it — the implementer picks; say which in the report). The existing `try/catch` returning `null` stays: a goals read failing must degrade the spine, never break a cockpit turn.

- [ ] **Step 7: Run to green**

Run: `pnpm --filter @pikar/backend exec vitest run convex/goals.test.ts convex/blueprintPulse.test.ts`
Expected: all pass.

- [ ] **Step 8: Lint, typecheck, register, commit**

Add `"packages/backend/convex/goals.ts"` and `"packages/backend/convex/goals.test.ts"` to `watch.json`'s `"onboarding.md"` array.

```bash
npx biome check --write packages/backend/convex/goals.ts packages/backend/convex/goals.test.ts packages/backend/convex/blueprint.ts
pnpm typecheck
git status --short
git add packages/backend/convex/schema.ts packages/backend/convex/goals.ts packages/backend/convex/goals.test.ts packages/backend/convex/blueprint.ts docs/playbooks/watch.json
git commit -m "feat(goals): the goals table, its guarded writes, and the spine wiring"
```

---

### Task 5: Direction band — add, achieve, drop, and how long it took

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx` (query + prop threading)

**Interfaces:**
- Consumes: `api.goals.listGoals`, `api.goals.addGoal`, `api.goals.setGoalStatus`; `goalsForSegment`, `countdown`, `cycleTimeDays`, `type Goal` from `@pikar/core`.
- Produces: `SegmentAnatomy` gains `goals?: readonly Goal[]` (the segment's own, already filtered by the panel).

- [ ] **Step 1: Panel — query once, filter per segment**

In `BlueprintPanel.tsx`: `const goals = useQuery(api.goals.listGoals);`, thread it into `BlueprintReport` (new optional prop `goals?: readonly Goal[]`), and at the `SegmentAnatomy` call site pass the segment's slice:

```tsx
          goals={
            goals === undefined
              ? undefined
              : goalsForSegment(goals, openSegment.id, BLUEPRINT_SEGMENTS.map((s) => s.id))
          }
```

- [ ] **Step 2: Anatomy — the fifth band**

Add a `Band title="Direction"` **after Outcomes**, rendering:

- `goals === undefined` → `<p>Checking…</p>` (the loading discipline already used by Tools/Outcomes — never a false "no goals").
- Empty → "No goals set for this section yet." plus the add form.
- Each goal as a row: the text; then a muted line carrying `countdown(targetDate, Date.now())` when dated (or "no deadline"), and for an achieved goal `Achieved in N days` from `cycleTimeDays`. Overdue is the words "Nd over" — never colour-alone (BRAND §6). A goal with a `parentId` renders indented one step under its parent (`padding-left`), which is where parentage lives now that the spine dropped it.
- Active goals get two real `<button>`s with visible labels: **Achieved** and **Drop**, each calling `setGoalStatus`. No optimistic flip: on failure the row is unchanged and a `role="alert"` line says "Couldn't save that. Try again." (spec §7 — reuse the `AskSpecialist` failure-copy pattern already in this file).
- The add form: one text input (`maxLength={500}`), one `<input type="date">` (optional), one **Add goal** button calling `addGoal({ segmentId: segment.id, text, targetDate })`. Convert the date input's `YYYY-MM-DD` with `Date.parse(`${value}T00:00:00Z`)` so the stored ms is UTC midnight and matches the spine's `isoDay` rendering — a local-midnight parse shifts the displayed due date by a day for anyone west of UTC. Clear the inputs on success; leave them filled on failure.
- Buttons are disabled while their mutation is in flight (the `busy` pattern in `AskSpecialist`).

- [ ] **Step 3: Verify**

```bash
npx biome check --write "apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx"
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git status --short
git add "apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx"
git commit -m "feat(blueprint): Direction band — set, achieve and drop goals with cycle time"
```

---

### Task 6: Milestone flag on the canvas

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintCanvas.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx` (pass the map through)

**Interfaces:**
- Consumes: `countdown`, `nearestActive`, `goalsForSegment`, `type Goal` from `@pikar/core`.
- Produces: `BlueprintCanvas` gains `goals?: readonly Goal[]` (all of them; the canvas slices per node using the same `goalsForSegment` rule as the anatomy, so a node and its detail never disagree).

- [ ] **Step 1: Pass the goals through**

In `BlueprintPanel.tsx`, add `goals={goals}` to the `BlueprintCanvas` call (the full list — the canvas filters).

- [ ] **Step 2: Render the flag**

In `BlueprintCanvas.tsx`, inside the node's content span and **below** the existing sub-line, add — only when the segment has a nearest dated active goal:

```tsx
              {nextDue !== null && (
                <span style={{ fontSize: "0.6rem", opacity: selected ? 0.75 : 0.7 }}>
                  ◆ next milestone {countdown(nextDue.targetDate as number, Date.now())}
                </span>
              )}
```

where `nextDue` is `nearestActive(goalsForSegment(goals ?? [], segment.id, BLUEPRINT_SEGMENTS.map(s => s.id)), 1)[0] ?? null`. Node height is model-space arithmetic (`nodeHeight`), so **add the flag's row height to `nodeHeight` when a flag renders** or the wires will attach at the wrong point — read that function's comment before touching it and keep the geometry deterministic.

- [ ] **Step 3: Verify and commit**

```bash
npx biome check --write "apps/web/app/(app)/dashboard/profile/BlueprintCanvas.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx"
pnpm typecheck
git status --short
git add "apps/web/app/(app)/dashboard/profile/BlueprintCanvas.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx"
git commit -m "feat(blueprint): canvas milestone flag — the nearest deadline per section"
```

---

### Task 7: Playbook and full verification

**Files:**
- Modify: `docs/playbooks/onboarding.md`

- [ ] **Step 1: Playbook paragraph**

Add a compact note to the current dated block, in the file's prose style: goals are a SEPARATE table (the 11-field blueprint set stays closed, D3); `packages/core/src/goals.ts` owns selection/countdown/cycle-time and the spine block; the spine block is budgeted (`GOALS_SPINE_MAX` × `GOAL_LINE_CAP` + header ≤ the headroom the field caps leave under `SPINE_CHAR_CAP`) because `renderSpine` THROWS on overflow — anyone adding a field cap or a goal line must redo that arithmetic; parentage is UI-only; goal text is content-plane and never audited. Bump `Last verified` if the date moved.

- [ ] **Step 2: Full verification**

```bash
pnpm typecheck
pnpm --filter @pikar/core exec vitest run src/goals.test.ts src/blueprint.test.ts
pnpm --filter @pikar/backend exec vitest run convex/goals.test.ts
pnpm --filter web build
```

All must pass. Report real results; if any fails, report BLOCKED with the output rather than patching around it.

- [ ] **Step 3: Commit**

```bash
git status --short
git add docs/playbooks/onboarding.md
git commit -m "docs(blueprint): record goals, the spine budget and the closed-field-set boundary"
```

---

## Out of scope

- Goal editing (drop + re-add is the model — a goal is a claim, not a document).
- A status-history table (`ponytail:` the single `statusChangedAt` transition is the ceiling; history is the upgrade path if per-transition timing is ever needed).
- Any cockpit TOOL that lets an agent write goals — the agent READS them via the spine. A write tool needs a new closed-union `agentSteps.tool` literal plus its guard test, and is its own slice.
- The readout's "next milestone in N days" clause (spec §3.2) — `composeReadout` gains that input in a follow-up; this slice puts the flag on the node.
