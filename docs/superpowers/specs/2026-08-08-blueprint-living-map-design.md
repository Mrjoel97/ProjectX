# Blueprint — the living operating map

> Status: draft for owner review, 2026-08-08.
> Builds on `2026-08-02-profile-tabs-blueprint-segments-design.md` (tabs + segments + canvas).
> Touches `apps/web/app/(app)/dashboard/profile/`, `packages/core/`, and adds one backend query
> module + one new table.

## 1. Problem

The blueprint today is a **knowledge map**: what the system knows, where each fact came from,
where the chain breaks. It answers "what do you know about my business?" but not "what does my
business *do*?" Three layers are missing:

1. **Pulse** — the canvas is static between rebuilds, while the backend already records every
   run (`requests`, `plans`, `agentSteps`) with timestamps and statuses that never reach the sheet.
2. **Anatomy** — tapping a node shows its fields, but not the processes that run in that section,
   the tools enabling them, or the outcomes they shipped.
3. **Intention** — `primaryGoals` is free text in a closed field set. Nothing carries a target
   date, so neither the user nor the agents can see how long anything takes or what is due.

The feature serves two audiences by construction — the canvas renders for humans, `renderSpine()`
serializes for every agent surface — and each layer below must land on **both** renderers or it
doesn't count.

## 2. Decisions (proposed)

| # | Decision | Alternative rejected |
|---|---|---|
| D1 | **Amended 2026-08-08 (pre-implementation):** activity attributes to a segment via the dispatch trace — an `agentSteps` row whose `tool` equals `SPECIALISTS[segment.specialist].stepTool`. The original rule (`requests.route === segment.specialist`) is unimplementable: `requests.route` persists the Executive Router's `direct_llm \| sub_agent \| direct_tool` decision (`pipeline.ts`), never a specialist name. Segments with `specialist: null` show no run pulse — no signal exists, and inventing one would violate D2. | Keyword/heuristic matching of run content to segments — a ranking heuristic that drifts, and it would need content reads where counts suffice. |
| D2 | **Pulse is real state only.** A node breathes iff a non-terminal run is in flight *now*; brightness follows last-activity recency; a wire animates when work actually flowed. No ambient/timer animation. | Decorative motion. The moment one pulse is fake, all pulses are (the `bp-wire-flow` precedent — motion that reports state). |
| D3 | **Goals are a NEW table**, not new blueprint fields. The 11-field set stays closed (17.1 owner decision — diff and spine budgets depend on it). Goals reach agents via a separate spine section, not via `BLUEPRINT_FIELDS`. | Reopening the closed field set; stuffing dates into `primaryGoals` prose. |
| D4 | **Drill-down is a fixed four-band anatomy** (Knowledge / Process / Tools / Outcomes) rendered in the existing detail area — every segment the same shape, populated only by what's real. | A free-form sub-diagram per section: unbounded design surface, and empty sections would need fake content. |
| D5 | **"Ask <specialist> →" ships in slice 1** — it was declared in the 08-02 spec (its D5) and the anatomy's Process band is where it lives. | Deferring again; the map stays a mirror instead of a cockpit. |
| D6 | **Aggregates only cross the wire.** The pulse query returns counts, statuses, and timestamps per segment — never goal text, draft text, or recipients. (CLAUDE.md §4 discipline applied to a read surface.) | Shipping run content to the canvas that it would never render. |

## 3. Layer 1 — pulse

### 3.1 Backend: `blueprint.blueprintPulse` (query)

Thin adapter (CLAUDE.md §1) over existing tables; per-segment aggregation is a pure core helper
(`packages/core/src/blueprintPulse.ts`) fed with already-narrowed rows. Returns:

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
    plansDone30d: number    // plans reaching "done" in the last 30 days
    plansInFlight: number   // plans in collecting|proposed|delivering right now
  }
}
```

**Amended 2026-08-08 (pre-implementation):** per-segment email counts were dropped with the D1
amendment — a request does not carry a specialist attribution. Tenant-wide outcome counts feed the
status readout instead.

`now` is passed in from the client for the 30-day window (queries are deterministic; the
`Date.now()`-in-query trap).

### 3.2 Canvas rendering

- **Breathing dot**: the node's existing status dot gets a slow opacity pulse while
  `inFlight > 0`. CSS keyframes gated on a class — no JS animation loop. Honors
  `prefers-reduced-motion` (falls back to a solid highlight ring).
- **Recency dimming**: node opacity steps on `lastActivityAt` — full (≤7 days), 0.85 (≤30),
  0.7 (older/never). Stepped, not continuous, so the same data always renders the same and the
  step thresholds are testable. Never dims below the existing hover-dim floor, and `total === 0`
  segments keep their current 0.62.
- **Status readout**: one sentence above the sheet, composed deterministically —
  in-flight first, then the stalest active section, then the nearest goal deadline (layer 3):
  *"Money model run in flight · Leads idle 3 weeks · next milestone in 12 days."* Composition is a
  pure core function returning the string; empty inputs return the existing quiet state, never a
  fake sentence.
- **Edge flow** keeps its current rule (source segment fully captured) — already honest. No change.

### 3.3 Spine

No spine change in this layer: agents already receive per-run context elsewhere; duplicating run
counts into the spine spends budget on what the agent can't act on.

## 4. Layer 2 — node anatomy (drill-down)

Selecting a node renders four bands in the existing detail area below the sheet. Same order every
segment; a band with nothing real says so in words (honest zeros, BRAND §5).

| band | content | source |
|---|---|---|
| Knowledge | today's field rows verbatim (label, values, origin line) | existing `BlueprintPanel` detail |
| Process | the owning specialist, its last run's status + when, and **"Ask <specialist> →"** | `segment.specialist`, pulse aggregates; the button routes to the cockpit with the specialist preselected |
| Tools | connections this section runs on: Gmail (connected state), and blocked rows **with their stored reason** | existing connections surface + `connections.ts` `BLOCKED` |
| Outcomes | **Amended 2026-08-08:** the specialist's shipped runs: count in the last 30 days, recency, and typical (median) duration — measured from the dispatch trace. Tenant-wide delivery counts live in the status readout, not per segment (D1 amendment). | pulse aggregates (`runs30d`, `medianRunMs`, `lastActivityAt`, per segment) |

`specialist: null` segments render Process as "No agent owns this section — it's yours," which is
true and reads as a feature.

"Ask <specialist> →" is navigation + preselection only. It does not auto-start a run; the cockpit's
existing guided flow owns everything after the click (no new approval surface, no new tool).

## 5. Layer 3 — goals & milestones

### 5.1 New table

```
goals: defineTable({
  tenantId: v.string(),
  segmentId: v.string(),            // validated against BLUEPRINT_SEGMENTS ids at write
  text: v.string(),                 // the goal, user's words (content plane — never audited raw)
  targetDate: v.optional(v.number()), // ms; absent = direction without a deadline
  parentId: v.optional(v.id("goals")), // small goal inside a bigger one; one level, enforced at write
  status: v.union(v.literal("active"), v.literal("achieved"), v.literal("dropped")),
  createdAt: v.number(),
  statusChangedAt: v.number(),      // set on every status transition
}).index("by_tenant_status", ["tenantId", "status"])
```

Cycle time falls out for free: `statusChangedAt − createdAt` on an achieved goal is "how long it
took," and the pulse aggregates say what ran in that window. No extra history table until a real
need shows up (`ponytail:` one-level nesting and single-transition timing are the deliberate
ceiling; a status-history table is the upgrade path).

Mutations: `addGoal`, `setGoalStatus` (tenant-scoped wrappers, audit entries carry ids and counts
only). Editing text = drop + re-add; a goal is a claim, not a document.

### 5.2 Canvas

A segment with active goals gets a **milestone flag** row: nearest `targetDate` as a countdown
("12d") — overdue renders as "3d over" in text, never color-alone (BRAND §6). Selecting the node
lists its goals in a fifth band, **Direction**, with add/achieve/drop inline. Goals with no
`segmentId` match (defensive) surface under the Direction segment, never disappear.

### 5.3 Spine — the agent half

**Amended 2026-08-08 (pre-implementation).** The original text ("3 goals, each line capped like a
field line", with a `part of: <parent>` clause) is unimplementable: it costs ~600–720 chars against
a MEASURED headroom of 210. The spine's worst case today is 2290 of `SPINE_CHAR_CAP` = 2500 —
11 field lines (caps sum 1960) + framing and the staleness warning (314) + newlines (16) — and
`renderSpine` THROWS above the cap, so an overflow is a live outage on every cockpit turn and every
vault-grounding call, not a cosmetic bug.

`renderSpine` gains one optional trailing section, budgeted to fit the existing headroom with the
cap unchanged:

```
Goals:
- Reach 10 paying customers [due 2026-09-15]
- Ship the landing page [due 2026-08-20]
```

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

## 6. Accessibility

- Breathing dot: `prefers-reduced-motion` → static ring; state also present as text in the node
  sub-line ("run in flight"), never motion-alone.
- Recency: opacity steps are paired with the "last touched" text in the anatomy — dimming is
  reinforcement, not the only signal.
- Anatomy bands are headed regions under the existing `aria-controls` detail target; goal
  add/achieve/drop are real buttons with visible labels.

## 7. Error handling

- Pulse query unavailable → canvas renders exactly today's static view (every pulse prop
  optional). No spinner over the sheet; the sheet is useful without the pulse.
- Goal writes reuse the existing save-failure copy pattern; a failed `setGoalStatus` leaves the
  flag untouched (no optimistic flip).
- `blueprintPulse` on a tenant with no runs returns all-zero aggregates — renders as the quiet
  state, not an error.

## 8. Testing

- `packages/core/src/blueprintPulse.test.ts` — aggregation from row shapes to per-segment
  summary; status-set partition against the pinned enums; recency step thresholds; readout
  composition including all-empty.
- `packages/core/src/goals.test.ts` (pure helpers) — nearest-deadline selection, spine section
  cap arithmetic, one-level nesting guard.
- `packages/backend/convex/goals.test.ts` — tenant scoping, segmentId validation, status
  transitions stamping `statusChangedAt`.
- Playbook: `docs/playbooks/onboarding.md` updated in the same commits (it watches the profile
  surface and `blueprint.ts`); goals get their own playbook entry or an extension of onboarding's,
  registered in `watch.json`.

## 9. Build order (each slice independently shippable)

1. **Anatomy + Ask-specialist** (D4, D5) — no schema change; Process/Tools/Outcomes bands render
   from existing surfaces, Outcomes says "wired in slice 2" honestly until then.
2. **Pulse** (layer 1) — `blueprintPulse` + core aggregation + breathing/dimming/readout.
3. **Goals** (layer 3) — table, mutations, canvas flags + Direction band, spine section.

## 10. Non-goals

- No diagram library — the hand-rolled canvas already does pan/pinch/drag/keyboard and carries
  provenance inside nodes; a library fights that design.
- No user-editable wiring — `SEGMENT_FLOW` stays "a claim about the business, not a preference."
- No ambient animation, ever (D2).
- No per-section free-form sub-diagrams (D4).
- No new cockpit tool for goals in this build — the agent *reads* goals via the spine; letting the
  agent *write* goals means a new closed-union tool literal + guard-test round (`agentSteps`
  three-time trap) and is its own slice when wanted.
