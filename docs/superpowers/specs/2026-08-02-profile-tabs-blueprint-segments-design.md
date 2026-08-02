# Business profile — top tabs + segmented blueprint

> Status: approved 2026-08-02. Owner decisions recorded in §2.
> Supersedes nothing. Touches `apps/web/app/(app)/dashboard/profile/` and adds one pure core module.

## 1. Problem

`/dashboard/profile` is a single 44rem column holding three tall cards — business shape (facts →
tier → agent identity), the Lean-core narrative, and the blueprint panel — in one scroll. Two
Save buttons look identical but write to different places, and the blueprint report sits at the
bottom where it is least likely to be read.

The blueprint is also presented as one flat report. There is no way to ask "what does the system
know about my offer?" without reading everything.

## 2. Decisions (owner, 2026-08-02)

| # | Decision | Alternative rejected |
|---|---|---|
| D1 | **Shell now, depth later.** Segments are built over the existing closed 11-field set; segments with no fields yet render an honest empty state rather than being hidden. | Reopening the closed field set for real per-department content (`blueprint.ts:32` — the field set is closed by an owner decision; the diff and the spine budget become unbounded otherwise). |
| D2 | **Segments are named after the growth engine**, mirroring `SPECIALIST_ROUTES` — so each segment has an agent that could fill it. | Classic departments (Sales/Marketing/Finance/Ops), which map to no shipped specialist. |
| D3 | **Overview-first grid** is the blueprint landing view (design option B). | Segment pills (A) and a side rail (C). B is the only layout where the whole-business view is the default rather than a destination, and it is the only one that makes an empty segment loud. |
| D4 | **Goals and constraints get their own `Direction` segment**, not folded into Foundation. `bindingConstraint` moves here to sit with the other constraints. | Folding into Foundation (buries them under identity facts); a full-width banner (no home for constraints). |
| D5 | **The "Ask <specialist> →" action is deferred** to its own slice. | Shipping it inside a re-layout. |

## 3. Structure

Route is unchanged: `/dashboard/profile`.

Three top-level tabs, with the active tab in the URL (`?tab=shape|business|blueprint`) so a tab is
linkable and survives a refresh. The app already uses `?thread=` this way (VOIC-04 deep-link).
An absent or unrecognized `tab` falls back to `shape` — never an error state.

`page.tsx` is 720 lines doing everything. It splits:

| file | responsibility | depends on |
|---|---|---|
| `page.tsx` | shell: header, tab bar, loading/empty/no-profile states, renders the active panel | the three panels, `styles.ts` |
| `ShapePanel.tsx` | facts → derived tier (read-only) + agent identity; owns `saveFacts` | `styles.ts` |
| `NarrativePanel.tsx` | Lean-core fields; owns `updateProfile` | `styles.ts` |
| `BlueprintPanel.tsx` | overview grid + expanded segment detail + build/rebuild + diff | `styles.ts`, `@pikar/core` |
| `styles.ts` | `label`, `field`, `card`, `primaryButton` | — |

`styles.ts` also fixes an existing smell: `BlueprintPanel` currently imports its styles from a page
component (`import { card, label, primaryButton } from "./page"`).

**Both panels keep their own Save button and their own writer.** The two-writer split is a locked
Phase-15.1 decision (facts re-derive the tier; the narrative re-embeds the vault doc) and tabs must
not merge them into one Save. Separating them onto different tabs makes the distinction clearer
than it is today, which is a side benefit, not the goal.

## 4. The segment model

New pure module `packages/core/src/blueprintSegments.ts` (CLAUDE.md §1 — domain logic lives in
`packages/*`, not in the web app).

```
SEGMENTS: readonly { id, label, fields, specialist }[]
```

`specialist` is a `SpecialistRoute | null` — declared now, consumed by the deferred D5 slice.

Field assignment (total over all 11 `BLUEPRINT_FIELDS`):

| segment | fields | specialist |
|---|---|---|
| Foundation | `name`, `oneLineDescription`, `stage`, `tier` | `null` |
| Offer | `offering`, `targetCustomer` | `offer-architect` |
| Money model | `revenueModel` | `money-model-designer` |
| Leads | *(none today)* | `lead-engine` |
| Direction | `primaryGoals`, `knownConstraints`, `bindingConstraint` | `null` |
| Evidence | `entities` | `research` |

4 + 2 + 1 + 0 + 3 + 1 = 11.

**Totality is enforced at compile time.** A type-level check asserts the union of all `fields`
equals `BlueprintField` — a twelfth blueprint field that no segment claims is a compile error, not
a field that silently disappears from the UI. This mirrors `FIELD_SPEC`'s `satisfies
Record<BlueprintField, FieldSpec>` (`blueprint.ts:103`) and exists for the same reason: a switch
with a `default` makes the coverage test vacuous forever.

Also exported:

```
segmentFill(blueprint, segment) -> { filled: number; total: number }
```

`total` is the segment's field count; `filled` counts fields whose entry is non-null.

**A segment with `total === 0` renders "Not tracked yet", never a ratio.** The mockup showed
`Leads 0 / 3`, which invents a denominator — three fields that do not exist. Honest zeros over
fake ones (BRAND §5). This is a deliberate correction to the approved mockup.

## 5. Data flow

**No backend change.** `api.blueprint.blueprintState` already returns everything the grid needs:
`state` (`none` | `draft` | `live` | `live_stale`), `live`, `diff`, `confirmedAt`,
`unincorporatedCount`. Fill counts are computed in the browser from the pure helper against the
live blueprint. `buildBlueprintDraft`, the diff review, and both save mutations are untouched.

## 6. The overview grid

Seven tiles: the six segments plus one **status tile** carrying `confirmedAt`, the unincorporated
count, and the Rebuild button.

Each segment tile shows: uppercase segment label (BRAND §3), the fill ratio as a big stat value
(BRAND §5 stat tile), a meter, and a one-line summary of its most identifying populated field.
An empty segment says so in words.

"Most identifying" is not a judgement call: it is the **first populated field in the segment's own
`fields` order**, clipped to one line. Segment order is authored to put the most identifying field
first (e.g. Offer leads with `offering`, not `targetCustomer`), so the rule stays deterministic and
there is no ranking heuristic to drift.

Clicking a tile expands that segment's detail below the grid — one open at a time. Detail rows
reuse today's `BlueprintReport` row shape verbatim: field label, values, and the origin line
("Your own words" / "From <document>").

The `draft` state is unchanged — `BlueprintDiff` still takes the whole panel, because a pending
draft is a decision to make, not a thing to browse.

## 7. Accessibility

- Tabs: `role="tablist"` / `role="tab"` with `aria-selected` + `aria-controls`, panels
  `role="tabpanel"`; left/right arrow keys move between tabs (BRAND §6 — keyboard operability).
- Tiles are real `<button>`s with `aria-expanded` and `aria-controls` pointing at the detail region.
- Fill state is never colour-alone (BRAND §6): every meter is accompanied by its ratio in text.
- The meter uses `--teal-600` when complete and `--held` when partial. Amber stays out of any
  text role on light paper (`--held-text` if text is ever needed) — BRAND §2.
- The stale badge moves next to the tab bar so it is visible from every tab, not just Blueprint.

## 8. Error handling

Unchanged. Save failures, `INCOMPLETE_FACTS` gap messages, tier-move announcements, and the
build-failure copy ("Nothing has changed") all move with their panels verbatim. Switching tabs
does not discard unsaved edits — panel state lives in the parent shell so a half-typed narrative
survives a trip to the Blueprint tab and back.

## 9. Testing

- `packages/core/src/blueprintSegments.test.ts` — one vitest file: (a) field totality, asserting
  the concatenation of every segment's `fields` is exactly `BLUEPRINT_FIELDS` with no duplicates;
  (b) `segmentFill` maths including the `total === 0` case.
- No new UI test framework. `apps/web` is covered by Playwright e2e only, and this is a re-layout
  of existing behaviour.

## 10. Definition of done

- `pnpm typecheck` clean; the new core test green.
- `docs/playbooks/onboarding.md` updated in the same commit — it watches both
  `apps/web/app/(app)/dashboard/profile/` and `packages/core/src/blueprint.ts` (`watch.json`).
- Verified in the real app on a rebuilt production server, not just in tests: `next build` then
  restart, because `next start` serves a frozen build.

## 11. Deferred (not in this build)

- **D5 — "Ask <specialist> →"**: wiring each segment to the specialist that could fill it. The
  `specialist` field exists in the model from day one so the tiles have somewhere to put it.
- **Real per-department content** (D1). When it arrives, segments gain fields and the totality
  check forces every new field to be assigned.
