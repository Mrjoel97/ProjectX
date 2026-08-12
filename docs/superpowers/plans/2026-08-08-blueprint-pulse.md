# Blueprint Pulse Layer (Living-Map Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The blueprint canvas reports real activity — a segment's node breathes while its specialist runs right now, dims with inactivity, and a one-line status readout summarizes what is moving — with per-segment run counts and measured durations in the anatomy's Outcomes band.

**Architecture:** Attribution runs through the **agent-step dispatch trace**, not `requests.route` (Task 1 amends the spec: `requests.route` holds the Executive Router's `direct_llm | sub_agent | direct_tool`, never a specialist name — the true specialist trace is `agentSteps` rows whose `tool` is a `dispatch*` literal, carrying `phase`/`startedAt`/`endedAt`/`durationMs`). A pure core module aggregates narrowed step rows into per-segment pulse summaries; one tenant-scoped Convex query feeds it and returns **counts and timestamps only**; the canvas and anatomy render it. One new index on `agentSteps`; no new tables.

**Tech Stack:** `@pikar/core` pure TS + vitest, Convex `tenantQuery` + one schema index, `convex-test` for the backend test, CSS keyframes (following the `bp-wire-flow` precedent in `globals.css`).

**Spec:** `docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md` §3 (as amended by Task 1), §2 D1/D2/D6.

## Global Constraints

- Domain logic lives in `packages/core`; the Convex query is a thin adapter (CLAUDE.md §1). Import `tenantQuery` from `./lib/functions` — raw `query` imports are banned (CLAUDE.md §2).
- Before writing any Convex code, read `packages/backend/convex/_generated/ai/guidelines.md`.
- **Aggregates only cross the wire** (spec D6): the pulse query returns counts, statuses, and timestamps — never goal text, draft text, subjects, or recipients. The `PulseStep` narrowing in the handler is the enforcement point.
- **Pulse is real state only** (spec D2): no ambient/timer animation. Breathing is gated on `phase === "running"` within `STALE_RUN_MS`; every animation honors `prefers-reduced-motion` (the `bp-wire-flow` precedent, `globals.css:1987-1999`).
- Never call `Date.now()` inside a Convex query handler — `now` is a query arg supplied by the client.
- Colors via `globals.css` CSS variables only. No component/diagram library. Honest zeros everywhere: a segment with no runs says so in words, never a fake count.
- **Run `npx biome check --write` on every UI/core file you create or edit BEFORE committing** — slice 1's final review caught a CI-red lint gate that typecheck and build never see.
- Shared working tree: stage files by exact path; NEVER `git add -A`; run `git status --short` first and leave foreign files (including `graphify-out/`) alone.
- `docs/playbooks/onboarding.md` watches `packages/core/src/blueprint*`, `packages/backend/convex/blueprint.ts`, and the profile directory — Task 6 updates it and registers the new core files in `docs/playbooks/watch.json`.
- End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Uv9Jbj6YCdMrS5Gig4Gvz6`

---

### Task 1: Amend the spec — attribution runs through the dispatch trace

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md`

**Interfaces:**
- Produces: the corrected contract every later task implements. No code.

**Why (context for the editor):** implementation research found `requests.route` is persisted from the Executive Router's decision and takes values `direct_llm | sub_agent | direct_tool` (`pipeline.ts:219-221`) — never a specialist route. The real, per-specialist run trace is `agentSteps` rows with `tool ∈ {dispatchOfferArchitect, dispatchMoneyModelDesigner, dispatchLeadEngine, dispatchResearch, dispatchMedia}` (`SPECIALISTS[route].stepTool`), each carrying `phase: running|done|error`, `startedAt`, `endedAt?`, `durationMs?`. Consequently per-segment email/plan counts are not attributable — those become **global** readout numbers, and per-segment Outcomes report the specialist's own runs and durations (which is strictly better: it is the "how long do workflows take" measurement).

- [ ] **Step 1: Amend D1 in §2**

Replace D1's decision cell text with (keep the row, mark the amendment):

```
**Amended 2026-08-08 (pre-implementation):** activity attributes to a segment via the dispatch
trace — an `agentSteps` row whose `tool` equals `SPECIALISTS[segment.specialist].stepTool`.
The original rule (`requests.route === segment.specialist`) is unimplementable: `requests.route`
persists the Executive Router's `direct_llm | sub_agent | direct_tool` decision (`pipeline.ts`),
never a specialist name. Segments with `specialist: null` show no run pulse — no signal exists,
and inventing one would violate D2.
```

- [ ] **Step 2: Amend §3.1**

Replace the returned-shape block and the non-terminal-status paragraph with:

```
{
  segments: Record<segmentId, {
    inFlight: number        // dispatch steps running right now (started < STALE_RUN_MS ago)
    lastActivityAt: number | null  // newest startedAt/endedAt across the segment's dispatch steps
    runs30d: number         // completed (done|error) dispatch steps in the window
    medianRunMs: number | null     // median durationMs of done runs — "how long a workflow takes"
  }>,
  globals: {
    sent30d: number         // requests reaching "sent", tenant-wide (not per segment — see D1)
    plansDone30d: number    // plans reaching "done", tenant-wide
    plansInFlight: number   // plans in collecting|proposed|delivering right now
  }
}
```

Note under it: "Per-segment email counts were dropped with the D1 amendment: a request does not
carry a specialist attribution. Tenant-wide outcome counts feed the status readout instead."

- [ ] **Step 3: Amend §4's Outcomes row**

Change the Outcomes band's content cell to: "the specialist's shipped runs: count in the last 30
days, recency, and typical (median) duration — measured from the dispatch trace. Tenant-wide
delivery counts live in the status readout, not per segment (D1 amendment)."

- [ ] **Step 4: Commit**

```bash
git status --short
git add docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md
git commit -m "docs(blueprint): amend the pulse spec — attribution via the dispatch trace"
```

---

### Task 2: Core pulse module (TDD)

**Files:**
- Create: `packages/core/src/blueprintPulse.ts`
- Create: `packages/core/src/blueprintPulse.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./blueprintPulse";` beside the existing `blueprintSegments` export)

**Interfaces:**
- Consumes: `BLUEPRINT_SEGMENTS`, `BlueprintSegment` from `./blueprintSegments`; `SPECIALISTS` from `./specialists`.
- Produces (Tasks 3-5 rely on these exact names):
  - `type PulseStep = { readonly tool: string; readonly phase: "running" | "done" | "error"; readonly startedAt: number; readonly endedAt?: number; readonly durationMs?: number }`
  - `type SegmentPulse = { readonly inFlight: number; readonly lastActivityAt: number | null; readonly runs30d: number; readonly medianRunMs: number | null }`
  - `type PulseGlobals = { readonly sent30d: number; readonly plansDone30d: number; readonly plansInFlight: number }`
  - `const PULSE_WINDOW_MS: number` (30 days), `const STALE_RUN_MS: number` (15 minutes)
  - `dispatchToolFor(segment: BlueprintSegment): string | null`
  - `aggregatePulse(steps: readonly PulseStep[], now: number): Record<string, SegmentPulse>`
  - `type RecencyLevel = "fresh" | "recent" | "quiet"`, `recencyLevel(lastActivityAt: number | null, now: number): RecencyLevel | null`
  - `composeReadout(pulse: Record<string, SegmentPulse>, globals: PulseGlobals, now: number): string | null`

- [ ] **Step 1: Write the failing test**

`packages/core/src/blueprintPulse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  aggregatePulse,
  BLUEPRINT_SEGMENTS,
  composeReadout,
  dispatchToolFor,
  PULSE_WINDOW_MS,
  type PulseStep,
  recencyLevel,
  STALE_RUN_MS,
} from "./index";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const step = (over: Partial<PulseStep>): PulseStep => ({
  tool: "dispatchOfferArchitect",
  phase: "done",
  startedAt: NOW - 2 * DAY,
  endedAt: NOW - 2 * DAY + 5 * MIN,
  durationMs: 5 * MIN,
  ...over,
});

describe("dispatchToolFor", () => {
  it("maps every specialist segment to a distinct dispatch tool and null-specialist segments to null", () => {
    const tools = new Set<string>();
    for (const segment of BLUEPRINT_SEGMENTS) {
      const tool = dispatchToolFor(segment);
      if (segment.specialist === null) expect(tool).toBeNull();
      else {
        expect(tool).toMatch(/^dispatch/);
        expect(tools.has(tool as string)).toBe(false);
        tools.add(tool as string);
      }
    }
  });
});

describe("aggregatePulse", () => {
  it("counts a fresh running step as in flight, but not a stale one", () => {
    const fresh = step({ phase: "running", startedAt: NOW - MIN, endedAt: undefined, durationMs: undefined });
    const stale = step({ phase: "running", startedAt: NOW - STALE_RUN_MS - MIN, endedAt: undefined, durationMs: undefined });
    const out = aggregatePulse([fresh, stale], NOW);
    expect(out.offer?.inFlight).toBe(1);
    // The stale step still counts as activity — it happened — just not as breathing.
    expect(out.offer?.lastActivityAt).toBe(fresh.startedAt);
  });

  it("excludes steps outside the 30-day window and takes the median of done durations", () => {
    const old = step({ startedAt: NOW - PULSE_WINDOW_MS - DAY });
    const a = step({ durationMs: 2 * MIN, endedAt: NOW - DAY });
    const b = step({ durationMs: 4 * MIN, endedAt: NOW - DAY });
    const c = step({ durationMs: 60 * MIN, endedAt: NOW - DAY });
    const out = aggregatePulse([old, a, b, c], NOW);
    expect(out.offer?.runs30d).toBe(3);
    expect(out.offer?.medianRunMs).toBe(4 * MIN);
  });

  it("returns an entry for every specialist segment even with zero steps, and none for null-specialist segments", () => {
    const out = aggregatePulse([], NOW);
    expect(out.offer).toEqual({ inFlight: 0, lastActivityAt: null, runs30d: 0, medianRunMs: null });
    expect(out.foundation).toBeUndefined();
    expect(out.direction).toBeUndefined();
  });
});

describe("recencyLevel", () => {
  it("steps at 7 and 30 days and is null with no activity", () => {
    expect(recencyLevel(null, NOW)).toBeNull();
    expect(recencyLevel(NOW - 6 * DAY, NOW)).toBe("fresh");
    expect(recencyLevel(NOW - 8 * DAY, NOW)).toBe("recent");
    expect(recencyLevel(NOW - 31 * DAY, NOW)).toBe("quiet");
  });
});

describe("composeReadout", () => {
  const empty = { sent30d: 0, plansDone30d: 0, plansInFlight: 0 };

  it("returns null when nothing has ever moved", () => {
    expect(composeReadout(aggregatePulse([], NOW), empty, NOW)).toBeNull();
  });

  it("leads with in-flight runs, then plans in motion, then sent count, then the quietest section", () => {
    const pulse = aggregatePulse(
      [
        step({ phase: "running", startedAt: NOW - MIN, endedAt: undefined, durationMs: undefined }),
        step({ tool: "dispatchLeadEngine", startedAt: NOW - 20 * DAY - MIN, endedAt: NOW - 20 * DAY }),
      ],
      NOW,
    );
    const text = composeReadout(pulse, { sent30d: 4, plansDone30d: 1, plansInFlight: 2 }, NOW);
    expect(text).toBe("Offer run in flight · 2 plans in motion · 4 emails sent in 30 days · Leads quiet 20 days");
  });

  it("pluralizes correctly at one", () => {
    const text = composeReadout(aggregatePulse([], NOW), { sent30d: 1, plansDone30d: 0, plansInFlight: 1 }, NOW);
    expect(text).toBe("1 plan in motion · 1 email sent in 30 days");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @pikar/core exec vitest run src/blueprintPulse.test.ts`
Expected: FAIL — module `./blueprintPulse` does not exist.

- [ ] **Step 3: Implement**

`packages/core/src/blueprintPulse.ts`:

```ts
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
```

- [ ] **Step 4: Add the index export, run the test**

Add `export * from "./blueprintPulse";` to `packages/core/src/index.ts` beside the `blueprintSegments` export line.

Run: `pnpm --filter @pikar/core exec vitest run src/blueprintPulse.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx biome check --write packages/core/src/blueprintPulse.ts packages/core/src/blueprintPulse.test.ts
pnpm typecheck
git status --short
git add packages/core/src/blueprintPulse.ts packages/core/src/blueprintPulse.test.ts packages/core/src/index.ts
git commit -m "feat(core): blueprint pulse aggregation from the dispatch trace"
```

---

### Task 3: The `blueprintPulse` query + agentSteps index

**Files:**
- Modify: `packages/backend/convex/schema.ts` (one index on `agentSteps`)
- Modify: `packages/backend/convex/blueprint.ts` (one query)
- Create: `packages/backend/convex/blueprintPulse.test.ts`

**Interfaces:**
- Consumes: `aggregatePulse`, `dispatchToolFor`, `PULSE_WINDOW_MS`, `type PulseStep` from `@pikar/core`; `tenantQuery` from `./lib/functions`.
- Produces: `api.blueprint.blueprintPulse` — args `{ now: number }`, returns `{ segments: Record<string, SegmentPulse>, globals: PulseGlobals }`. Task 4 consumes it.

- [ ] **Step 1: Read the Convex guidelines**

Read `packages/backend/convex/_generated/ai/guidelines.md` before writing anything.

- [ ] **Step 2: Add the index**

In `schema.ts`, `agentSteps` currently ends with `.index("by_turn", ["tenantId", "turnId"]).index("by_tenant", ["tenantId"])`. Add:

```ts
    // Pulse layer (living-map §3): per-specialist range read — 5 indexed queries instead of a
    // tenant-wide scan that grows with every cockpit turn.
    .index("by_tenant_tool_startedAt", ["tenantId", "tool", "startedAt"])
```

- [ ] **Step 3: Write the failing test**

`packages/backend/convex/blueprintPulse.test.ts` (mirror the harness setup of the existing `blueprint.test.ts` — same `convexTest` import and schema wiring):

```ts
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const seedStep = (tenantId: string, over: Record<string, unknown> = {}) => ({
  tenantId,
  threadId: "th1",
  turnId: "turn1",
  stepKey: `k${Math.random()}`,
  tool: "dispatchOfferArchitect" as const,
  phase: "done" as const,
  startedAt: NOW - 10 * MIN,
  endedAt: NOW - 5 * MIN,
  durationMs: 5 * MIN,
  ...over,
});

describe("blueprintPulse", () => {
  it("aggregates my dispatch steps and never a sibling tenant's", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("agentSteps", seedStep("tenantA"));
      await ctx.db.insert("agentSteps", seedStep("tenantA", { phase: "running", startedAt: NOW - MIN, endedAt: undefined, durationMs: undefined }));
      await ctx.db.insert("agentSteps", seedStep("tenantB"));
    });
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    const out = await asA.query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.segments.offer?.runs30d).toBe(1);
    expect(out.segments.offer?.inFlight).toBe(1);
    expect(out.segments["money-model"]?.runs30d).toBe(0);
  });

  it("counts sent requests and done/in-flight plans tenant-wide", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("requests", { tenantId: "tenantA", correlationId: "c1", goal: "g", recipient: "r@x.com", status: "sent", attachmentRefs: [], createdAt: NOW - 10 * MIN });
      await ctx.db.insert("plans", { tenantId: "tenantA", threadId: "th1", status: "done", createdAt: NOW - 10 * MIN });
      await ctx.db.insert("plans", { tenantId: "tenantA", threadId: "th2", status: "collecting", createdAt: NOW - MIN });
      await ctx.db.insert("plans", { tenantId: "tenantB", threadId: "th3", status: "done", createdAt: NOW - MIN });
    });
    const asA = t.withIdentity({ subject: "tenantA|s", issuer: "test" });
    const out = await asA.query(api.blueprint.blueprintPulse, { now: NOW });
    expect(out.globals).toEqual({ sent30d: 1, plansDone30d: 1, plansInFlight: 1 });
  });
});
```

(If `requests`/`plans` inserts require more mandatory fields than shown, copy the minimal seed shape from an existing test that inserts those tables — do not guess field values.)

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @pikar/backend exec vitest run convex/blueprintPulse.test.ts`
Expected: FAIL — `blueprintPulse` is not a function on `api.blueprint`.

- [ ] **Step 5: Implement the query**

In `packages/backend/convex/blueprint.ts` (imports already include `tenantQuery`; extend the `@pikar/core` import with `aggregatePulse`, `dispatchToolFor`, `PULSE_WINDOW_MS`, `type PulseStep`, `BLUEPRINT_SEGMENTS` if not present):

```ts
/**
 * The pulse layer's ONE read (living-map §3.1). Counts and timestamps only cross the wire (D6):
 * the narrowing into `PulseStep` below is the enforcement point — nothing content-shaped leaves.
 * `now` is a client arg: queries must be deterministic, and the 30-day window is the client's
 * clock's business.
 */
export const blueprintPulse = tenantQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const since = now - PULSE_WINDOW_MS;
    const steps: PulseStep[] = [];
    for (const segment of BLUEPRINT_SEGMENTS) {
      const tool = dispatchToolFor(segment);
      if (tool === null) continue;
      const rows = await ctx.db
        .query("agentSteps")
        .withIndex("by_tenant_tool_startedAt", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("tool", tool as never).gt("startedAt", since),
        )
        .collect();
      for (const r of rows)
        steps.push({
          tool: r.tool,
          phase: r.phase,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          durationMs: r.durationMs,
        });
    }

    const sent = await ctx.db
      .query("requests")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "sent").gt("createdAt", since),
      )
      .collect();
    const done = await ctx.db
      .query("plans")
      .withIndex("by_tenant_status_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "done").gt("createdAt", since),
      )
      .collect();
    let plansInFlight = 0;
    for (const status of ["collecting", "proposed", "delivering"] as const) {
      const rows = await ctx.db
        .query("plans")
        .withIndex("by_tenant_status_createdAt", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("status", status),
        )
        .collect();
      plansInFlight += rows.length;
    }

    return {
      segments: aggregatePulse(steps, now),
      globals: { sent30d: sent.length, plansDone30d: done.length, plansInFlight },
    };
  },
});
```

(`as never` on the tool eq: `dispatchToolFor` returns `string`, the index field is the closed
union — the value is provably a member (the core totality test) and the cast is confined to the
index callback. If the codebase prefers, narrow `dispatchToolFor`'s return type instead.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @pikar/backend exec vitest run convex/blueprintPulse.test.ts`
Expected: PASS (2/2).

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx biome check --write packages/backend/convex/blueprintPulse.test.ts packages/backend/convex/blueprint.ts
pnpm typecheck
git status --short
git add packages/backend/convex/schema.ts packages/backend/convex/blueprint.ts packages/backend/convex/blueprintPulse.test.ts
git commit -m "feat(blueprint): tenant pulse query over the dispatch trace"
```

---

### Task 4: Canvas pulse — breathing, dimming, readout

**Files:**
- Modify: `apps/web/app/globals.css` (one keyframe block, after `bp-wire-flow` at ~line 1999)
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintCanvas.tsx`

**Interfaces:**
- Consumes: `api.blueprint.blueprintPulse` (Task 3), `composeReadout`, `recencyLevel`, `type SegmentPulse`, `type PulseGlobals` from `@pikar/core`.
- Produces: `BlueprintCanvas` gains an optional prop `pulse?: Record<string, SegmentPulse>`; `BlueprintReport` gains `pulse?: { segments: Record<string, SegmentPulse>; globals: PulseGlobals }`. Task 5 reuses the same panel-level query result.

- [ ] **Step 1: Keyframes**

In `globals.css`, directly after the `bp-wire-flow` reduced-motion block:

```css
/* Node status dot while that section's specialist is running RIGHT NOW (living-map §3.2).
   State, not decoration: the class is applied only while a fresh `running` dispatch step
   exists, so the breath stops when the run does. */
@keyframes bp-node-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.bp-node-pulse {
  animation: bp-node-pulse 1.8s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .bp-node-pulse {
    animation: none;
    outline: 2px solid var(--teal-400);
    outline-offset: 1px;
  }
}
```

- [ ] **Step 2: Query in the panel, readout in the report**

In `BlueprintPanel.tsx`:

- `BlueprintPanel` adds, beside the existing `blueprintState` query:

```tsx
  // One clock per mount: a changing arg would resubscribe the query every render, and the
  // 30-day window does not need sub-session precision.
  const [now] = useState(() => Date.now());
  const pulse = useQuery(api.blueprint.blueprintPulse, { now });
```

- Thread `pulse` into both `BlueprintReport` call sites (`pulse={pulse}`), and extend `BlueprintReport`'s props with `pulse?: { segments: Record<string, SegmentPulse>; globals: PulseGlobals }` (import `composeReadout` and both types from `@pikar/core`).
- In `BlueprintReport`, between the lede `<p>` and the `<BlueprintCanvas … />`, render the readout — only when there is one:

```tsx
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
```

- Pass `pulse={pulse?.segments}` to `BlueprintCanvas`.

(`pulse === undefined` — query loading or unavailable — renders exactly today's static view: every
pulse prop is optional, per spec §7 error handling.)

- [ ] **Step 3: Canvas breathing + dimming**

In `BlueprintCanvas.tsx`:

- Add `pulse?: Record<string, SegmentPulse>` to the props (import `type SegmentPulse`, `recencyLevel` from `@pikar/core`).
- In the segment render loop, before the `return`:

```tsx
            const segPulse = pulse?.[segment.id];
            const breathing = (segPulse?.inFlight ?? 0) > 0;
            const recency = recencyLevel(segPulse?.lastActivityAt ?? null, Date.now());
```

- The status dot `<span aria-hidden="true" …>` (the 7×7 circle) gains `className={breathing ? "bp-node-pulse" : undefined}`, and when `breathing`, its `background` becomes `var(--teal-400)` regardless of done state (a live run outranks completeness).
- The node sub-line (the `{filled} of {total}` text) appends, when `breathing`, `· run in flight` — state must be present as text, never motion-alone (spec §6):

```tsx
                        : `${filled} of ${total}${isGap ? " · needs you" : ""}${breathing ? " · run in flight" : ""}`}
```

- Recency dimming composes with the existing opacity rules — replace the node's current `opacity:` expression with:

```tsx
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
```

(`recency === null` — no signal, including every null-specialist segment — falls through to 1:
absence of data never dims, per the amended D1.)

- [ ] **Step 4: Verify**

```bash
npx biome check --write "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintCanvas.tsx"
pnpm typecheck
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git status --short
git add apps/web/app/globals.css "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintCanvas.tsx"
git commit -m "feat(blueprint): canvas pulse — breathing dot, recency dimming, status readout"
```

---

### Task 5: Anatomy — real Outcomes, last-run in Process

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx` (thread the prop)

**Interfaces:**
- Consumes: `type SegmentPulse` from `@pikar/core`; the panel's existing `pulse` query result (Task 4).
- Produces: `SegmentAnatomy` gains `pulse?: SegmentPulse`.

- [ ] **Step 1: Thread the prop**

In `BlueprintPanel.tsx`, the anatomy call site becomes:

```tsx
      {openSegment && (
        <SegmentAnatomy
          segment={openSegment}
          blueprint={blueprint}
          pulse={pulse?.segments[openSegment.id]}
        />
      )}
```

(`BlueprintReport` already receives `pulse` from Task 4 — no extra query.)

- [ ] **Step 2: Formatting helpers + bands**

In `SegmentAnatomy.tsx`, add (top-level, beside `TOOL_LABELS`):

```tsx
/** "3 minutes" / "40 seconds" — durations are typical-run scale, so two units suffice. */
const fmtDuration = (ms: number): string =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} sec`;

const fmtWhen = (at: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(at));
```

`SegmentAnatomy` accepts and forwards `pulse`:

```tsx
export function SegmentAnatomy({
  segment,
  blueprint,
  pulse,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
  pulse?: SegmentPulse;
}) {
```

(import `type SegmentPulse` from `@pikar/core`.)

- **Process band**: `ProcessBand` gains `pulse?: SegmentPulse` (pass it at the call site). In the specialist branch, under the "Works from…" line, add a last-run line — only when a run exists:

```tsx
        {pulse !== undefined && (pulse.inFlight > 0 || pulse.lastActivityAt !== null) && (
          <span style={{ ...soft, fontSize: "0.78rem", display: "block" }}>
            {pulse.inFlight > 0
              ? "Running right now."
              : `Last ran ${fmtWhen(pulse.lastActivityAt as number)}.`}
          </span>
        )}
```

- **Outcomes band**: replace the deferral paragraph with:

```tsx
      <Band title="Outcomes">
        {segment.specialist === null ? (
          <p style={{ ...soft, fontSize: "0.83rem" }}>
            Nothing runs here on its own — this section moves when you update your profile or your
            documents.
          </p>
        ) : pulse === undefined ? (
          <p style={{ ...soft, fontSize: "0.83rem" }}>Checking…</p>
        ) : pulse.runs30d === 0 ? (
          <p style={{ ...soft, fontSize: "0.83rem" }}>
            No {segment.specialist} runs in the last 30 days.
          </p>
        ) : (
          <p style={{ ...soft, fontSize: "0.83rem" }}>
            {pulse.runs30d} run{pulse.runs30d === 1 ? "" : "s"} in the last 30 days
            {pulse.lastActivityAt !== null ? ` · last ${fmtWhen(pulse.lastActivityAt)}` : ""}
            {pulse.medianRunMs !== null ? ` · typical run ${fmtDuration(pulse.medianRunMs)}` : ""}.
          </p>
        )}
      </Band>
```

(The slice-1 deferral comment block is deleted — this is the replacement it promised. "Checking…"
while the query loads follows the Gmail-row discipline: never a false zero.)

- [ ] **Step 3: Verify**

```bash
npx biome check --write "apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx"
pnpm typecheck
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git status --short
git add "apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx"
git commit -m "feat(blueprint): anatomy pulse — measured outcomes and last-run in Process"
```

---

### Task 6: Watch registration, playbook, build

**Files:**
- Modify: `docs/playbooks/watch.json` (extend the `onboarding.md` array)
- Modify: `docs/playbooks/onboarding.md`

**Interfaces:** none — this is the slice's definition-of-done.

- [ ] **Step 1: Register the new core files**

In `watch.json`, append to the `"onboarding.md"` array:

```json
    "packages/core/src/blueprintPulse.ts",
    "packages/core/src/blueprintPulse.test.ts"
```

(`packages/backend/convex/blueprintPulse.test.ts` starts with `blueprint` under an already-watched
directory file list — add it explicitly too:)

```json
    "packages/backend/convex/blueprintPulse.test.ts"
```

- [ ] **Step 2: Playbook paragraph**

In `docs/playbooks/onboarding.md`, in the current dated block, add a short paragraph in the file's prose style: the blueprint now carries a pulse layer — `blueprintPulse` (one tenant query, counts and timestamps only) aggregates the `agentSteps` dispatch trace via `packages/core/src/blueprintPulse.ts`; attribution is `SPECIALISTS[route].stepTool`, deliberately NOT `requests.route` (which holds the router's `direct_llm|sub_agent|direct_tool`); nodes breathe only on a fresh `running` step (`STALE_RUN_MS` guard), dim on stepped recency, and the readout line composes deterministically in `composeReadout`. Bump `Last verified` if the date moved.

- [ ] **Step 3: Full verification**

```bash
pnpm typecheck
pnpm --filter @pikar/core exec vitest run src/blueprintPulse.test.ts
pnpm --filter @pikar/backend exec vitest run convex/blueprintPulse.test.ts
pnpm --filter web build
```

Expected: all clean. The interactive walkthrough (breathing dot during a live specialist run, readout line, dimming, Outcomes numbers) is the controller's job on the running app — a live dispatch is required to see the breath, so the controller triggers one via the cockpit ("Ask <specialist>") while watching the canvas.

- [ ] **Step 4: Commit**

```bash
git status --short
git add docs/playbooks/watch.json docs/playbooks/onboarding.md
git commit -m "docs(blueprint): record the pulse layer in the onboarding playbook"
```

---

## Out of scope (slice 3 of the same spec)

- The `goals` table, mutations, canvas milestone flags, Direction band, spine `Goals:` section, and the readout's "next milestone in N days" part (spec §5) — `composeReadout` gains that input when goals exist.
- Verb labels on agent steps (`agentSteps.label` is declared-unwritten; nothing here reads it).
- Any new cockpit tool.
