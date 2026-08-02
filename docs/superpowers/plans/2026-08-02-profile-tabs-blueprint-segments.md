# Profile Tabs + Blueprint Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column scroll on `/dashboard/profile` with three top-level tabs, and turn the blueprint from a flat report into an overview-first grid of six business segments.

**Architecture:** Three sibling panels are rendered simultaneously and toggled with the `hidden` attribute (so unsaved edits survive a tab switch without lifting any state). Segment grouping and completeness maths live in a new pure module in `packages/core`, enforced total over `BLUEPRINT_FIELDS` at compile time. No backend change of any kind.

**Tech Stack:** Next.js App Router (client components), React 19, Convex react hooks, vitest, Biome. Inline `React.CSSProperties` objects — the app deliberately has **no component library** (BRAND §8.3); do not add one.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-02-profile-tabs-blueprint-segments-design.md`. Read it before Task 1.
- **No backend change.** `api.blueprint.blueprintState` already returns `state`, `live`, `diff`, `confirmedAt`, `unincorporatedCount`. Do not add or modify a Convex function in this plan.
- **Two writers stay separate.** `saveFacts` (re-derives tier) and `updateProfile` (re-embeds the vault doc) keep their own Save buttons on their own panels. Never merge them.
- **The tier is never a control.** It renders as text with `TIER_REASON` + `SOURCE_WORDS`. Do not turn it into a disabled input.
- **Query params:** read with `new URLSearchParams(window.location.search)` inside a `useEffect`, **never** `useSearchParams` — the repo idiom, documented at `apps/web/app/(app)/dashboard/voice/page.tsx:23-30`. `useSearchParams` requires a Suspense boundary that typecheck cannot see is missing.
- **Colour tokens only** (BRAND §8.1): `--ink`, `--ink-soft`, `--rule`, `--card`, `--canvas`, `--teal-600`, `--held`, `--held-text`, `--released`. Never hardcode a hex a token covers.
- **Accessibility (BRAND §6, non-negotiable):** `--teal-600` on white is 2.9:1 — fills and white-text CTAs only, never small teal body text. `--held` is 1.9:1 on light paper — marks only, use `--held-text` for amber text. Never encode meaning in colour alone.
- **A segment with `total === 0` renders "Not tracked yet", never a ratio.** Honest zeros (BRAND §5) — do not invent a denominator like `0 / 3`.
- **Playbook obligation (CLAUDE.md §9):** `docs/playbooks/onboarding.md` watches `apps/web/app/(app)/dashboard/profile/` and `packages/core/src/blueprint.ts`. **Every commit that touches those paths must also touch `onboarding.md` in the same commit**, or the Stop hook blocks the turn. Task 1 opens one running entry; each later task appends one line to it.
- **Verification is a real build.** `next start` serves a frozen build — `pnpm --filter @pikar/web build` and restart before believing anything you see in a browser.

---

### Task 1: The pure segment module

**Files:**
- Create: `packages/core/src/blueprintSegments.ts`
- Create: `packages/core/src/blueprintSegments.test.ts`
- Modify: `packages/core/src/index.ts` (add one export line)
- Modify: `docs/playbooks/watch.json` (register the two new files under `onboarding.md`)
- Modify: `docs/playbooks/onboarding.md` (open the running entry)

**Interfaces:**
- Consumes: `BLUEPRINT_FIELDS`, `BlueprintField`, `BusinessBlueprint` from `./blueprint`; `SpecialistRoute` from `./specialists`.
- Produces: `BLUEPRINT_SEGMENTS` (readonly array), `type BlueprintSegment`, `segmentFill(blueprint, segment) => { filled: number; total: number }`, `segmentHeadline(blueprint, segment) => string | null`. Tasks 5 uses all four.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/blueprintSegments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_FIELDS,
  type BlueprintField,
  type BusinessBlueprint,
} from "./blueprint";
import { BLUEPRINT_SEGMENTS, segmentFill, segmentHeadline } from "./blueprintSegments";

/** Every field null — the shape `mergeBlueprint` produces for an empty business. */
const blank = (): BusinessBlueprint =>
  Object.fromEntries(BLUEPRINT_FIELDS.map((f) => [f, null])) as unknown as BusinessBlueprint;

const segment = (id: string) => {
  const found = BLUEPRINT_SEGMENTS.find((s) => s.id === id);
  if (!found) throw new Error(`no segment ${id}`);
  return found;
};

describe("segment assignment", () => {
  // The bug this guards: a twelfth blueprint field is added and silently never renders.
  it("claims every blueprint field exactly once", () => {
    const claimed = BLUEPRINT_SEGMENTS.flatMap((s) => s.fields as readonly BlueprintField[]);
    expect([...claimed].sort()).toEqual([...BLUEPRINT_FIELDS].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("puts bindingConstraint in Direction, not Offer", () => {
    expect(segment("direction").fields).toContain("bindingConstraint");
    expect(segment("offer").fields).not.toContain("bindingConstraint");
  });
});

describe("segmentFill", () => {
  it("counts populated fields against the segment's own size", () => {
    const blueprint = {
      ...blank(),
      offering: { values: ["Fractional CFO retainer"], origin: "stated" },
    } as BusinessBlueprint;
    expect(segmentFill(blueprint, segment("offer"))).toEqual({ filled: 1, total: 2 });
  });

  // Honest zeros: Leads has no fields yet, so it must not invent a denominator.
  it("reports total 0 for a segment with no fields yet", () => {
    expect(segmentFill(blank(), segment("leads"))).toEqual({ filled: 0, total: 0 });
  });
});

describe("segmentHeadline", () => {
  it("returns the FIRST populated field in the segment's own order", () => {
    const blueprint = {
      ...blank(),
      offering: { values: ["Retainer"], origin: "stated" },
      targetCustomer: { values: ["Series-A founders"], origin: "stated" },
    } as BusinessBlueprint;
    expect(segmentHeadline(blueprint, segment("offer"))).toBe("Retainer");
  });

  it("joins a list field's values", () => {
    const blueprint = {
      ...blank(),
      primaryGoals: { values: ["Productize", "Hire an analyst"], origin: "stated" },
    } as BusinessBlueprint;
    expect(segmentHeadline(blueprint, segment("direction"))).toBe("Productize · Hire an analyst");
  });

  it("returns null when nothing in the segment is populated", () => {
    expect(segmentHeadline(blank(), segment("money-model"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @pikar/core exec vitest run src/blueprintSegments.test.ts`
Expected: FAIL — `Failed to resolve import "./blueprintSegments"`.

- [ ] **Step 3: Write the module**

Create `packages/core/src/blueprintSegments.ts`:

```ts
// The blueprint's PRESENTATION grouping (Phase: profile tabs, 2026-08-02 spec §4).
//
// A segment is a business-shaped bucket over the CLOSED field set in `blueprint.ts`. It adds no
// data: `BLUEPRINT_FIELDS` is unchanged and this module never widens it. Segments are named after
// `SPECIALIST_ROUTES` so each one has an agent that could fill it — the "Ask <specialist>" action
// is deferred (spec D5), which is why `specialist` is declared here but not yet consumed.
//
// Lives in core, not in the web app, because the totality guarantee below is domain logic and is
// worth testing without a browser (CLAUDE.md §1).

import type { BlueprintField, BusinessBlueprint } from "./blueprint";
import type { SpecialistRoute } from "./specialists";

export type BlueprintSegment = {
  readonly id: string;
  readonly label: string;
  /** Reporting order WITHIN the segment. The first entry is the most identifying field — it is
   *  what `segmentHeadline` shows on the overview tile, so this order is load-bearing. */
  readonly fields: readonly BlueprintField[];
  /** The specialist that could fill this segment, or null where no agent owns it. */
  readonly specialist: SpecialistRoute | null;
};

export const BLUEPRINT_SEGMENTS = [
  {
    id: "foundation",
    label: "Foundation",
    fields: ["oneLineDescription", "name", "stage", "tier"],
    specialist: null,
  },
  {
    id: "offer",
    label: "Offer",
    fields: ["offering", "targetCustomer"],
    specialist: "offer-architect",
  },
  {
    id: "money-model",
    label: "Money model",
    fields: ["revenueModel"],
    specialist: "money-model-designer",
  },
  // No field TODAY. Renders "Not tracked yet" rather than a fake denominator, and is the first
  // segment real per-department content would land in (spec D1).
  { id: "leads", label: "Leads", fields: [], specialist: "lead-engine" },
  {
    id: "direction",
    label: "Direction",
    fields: ["primaryGoals", "knownConstraints", "bindingConstraint"],
    specialist: null,
  },
  { id: "evidence", label: "Evidence", fields: ["entities"], specialist: "research" },
] as const satisfies readonly BlueprintSegment[];

type AssignedField = (typeof BLUEPRINT_SEGMENTS)[number]["fields"][number];

/**
 * COMPILE-TIME TOTALITY. A blueprint field that no segment claims makes the line below an error,
 * here, once — the `FIELD_SPEC` discipline (`blueprint.ts:103`) applied to the UI grouping.
 *
 * The tuple wrapper is load-bearing: a bare `BlueprintField extends AssignedField` DISTRIBUTES
 * over the union and the `never` branch is then absorbed by the union of the others, so an
 * unassigned field would pass. `[A] extends [B]` compares the unions whole.
 */
type EveryFieldAssigned = [BlueprintField] extends [AssignedField] ? true : never;
const _everyFieldAssigned: EveryFieldAssigned = true;
void _everyFieldAssigned;

/** How much of a segment is known. `total` is the segment's own field count — never padded. */
export function segmentFill(
  blueprint: BusinessBlueprint,
  segment: BlueprintSegment,
): { filled: number; total: number } {
  let filled = 0;
  for (const field of segment.fields) if (blueprint[field] !== null) filled += 1;
  return { filled, total: segment.fields.length };
}

/**
 * The one-line summary for the overview tile: the FIRST populated field in the segment's own
 * order. Deterministic by construction — there is no ranking heuristic to drift. Clipping to one
 * visual line is the caller's job (CSS), not this function's.
 */
export function segmentHeadline(
  blueprint: BusinessBlueprint,
  segment: BlueprintSegment,
): string | null {
  for (const field of segment.fields) {
    const entry = blueprint[field];
    if (entry !== null && entry.values.length > 0) return entry.values.join(" · ");
  }
  return null;
}
```

- [ ] **Step 4: Export it from the package index**

In `packages/core/src/index.ts`, directly after the existing `export * from "./blueprint";` line (line 3), add:

```ts
export * from "./blueprintSegments";
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm --filter @pikar/core exec vitest run src/blueprintSegments.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Prove the totality check actually bites**

Temporarily delete `"entities"` from the `evidence` segment's `fields`, then run:

Run: `pnpm --filter @pikar/core typecheck`
Expected: FAIL — `Type 'boolean' is not assignable to type 'never'` at `_everyFieldAssigned`.

Restore `"entities"`, re-run, expect a clean typecheck. **Do not skip this step** — a totality check that cannot fail is worse than none, because it reads as protection.

- [ ] **Step 7: Register the new files with a playbook**

In `docs/playbooks/watch.json`, add these two entries to the `onboarding.md` array:

```
"packages/core/src/blueprintSegments.ts",
"packages/core/src/blueprintSegments.test.ts",
```

Then in `docs/playbooks/onboarding.md`, insert this entry immediately after the `# Playbook:` title line (the file is **CRLF** — preserve it; write with a script rather than a multi-line editor anchor):

```
> Last verified: 2026-08-02 (profile tabs + blueprint segments). `blueprintSegments.ts` adds the
> PRESENTATION grouping over the closed field set — six segments named after `SPECIALIST_ROUTES`,
> with a compile-time totality check that every `BLUEPRINT_FIELD` is claimed by exactly one
> segment. No blueprint field, serializer, spine or Convex function changed.
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/blueprintSegments.ts packages/core/src/blueprintSegments.test.ts packages/core/src/index.ts docs/playbooks/watch.json docs/playbooks/onboarding.md
git commit -m "feat(profile): blueprint segments -- the presentation grouping, total at compile time"
```

---

### Task 2: Extract the shared styles

Pure move, zero behaviour change. It exists because `BlueprintPanel.tsx` currently imports its styles **from a page component** (`import { card, label, primaryButton } from "./page"`), which breaks the moment the page is split.

**Files:**
- Create: `apps/web/app/(app)/dashboard/profile/styles.ts`
- Modify: `apps/web/app/(app)/dashboard/profile/page.tsx` (remove the four exported style objects, import them instead)
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx:13` (change the import source)
- Modify: `docs/playbooks/onboarding.md` (append one line)

**Interfaces:**
- Produces: `label`, `field`, `card`, `primaryButton(disabled: boolean)` — all `React.CSSProperties` (the last a factory). Tasks 3, 4 and 5 import from `./styles`.

- [ ] **Step 1: Create the styles module**

Create `apps/web/app/(app)/dashboard/profile/styles.ts` and move these four declarations **verbatim** out of `page.tsx:48-97` (`label`, `field`, `card`, `primaryButton`). Do not restyle anything:

```ts
// Shared profile-surface styles. Previously exported from `page.tsx`, which meant every panel
// imported from a page component — fine with one panel, wrong once the page became a tab shell.
// BRAND §8.3: inline style objects, no component library.

export const label: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
};

export const field: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  borderRadius: "0.7rem",
  border: "1px solid var(--rule)",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  background: "var(--card)",
  color: "var(--ink)",
  resize: "vertical",
};

export const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1.1rem",
  padding: "1.25rem",
  boxShadow: "0 12px 32px -24px rgb(14 20 25 / 45%)",
  display: "grid",
  gap: "1rem",
};

export const primaryButton = (disabled: boolean): React.CSSProperties => ({
  padding: "0.65rem 1.5rem",
  borderRadius: "999px",
  border: "none",
  background: "var(--teal-600)",
  color: "#fff",
  fontWeight: 700,
  fontSize: "0.95rem",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
  boxShadow: "0 8px 18px -8px rgb(0 150 137 / 70%)",
});
```

- [ ] **Step 2: Update the two importers**

In `page.tsx`, delete the four moved declarations and add to the import block:

```ts
import { card, field, label, primaryButton } from "./styles";
```

In `BlueprintPanel.tsx`, change line 13 from `import { card, label, primaryButton } from "./page";` to:

```ts
import { card, label, primaryButton } from "./styles";
```

- [ ] **Step 3: Verify nothing else imported from the page**

Run: `rg "from \"\./page\"" "apps/web/app/(app)/dashboard/profile"`
Expected: no matches.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pikar/web typecheck`
Expected: clean (exit 0, no output).

- [ ] **Step 5: Commit**

Append one line to the `onboarding.md` entry opened in Task 1:

```
> Styles moved to `styles.ts`; no panel imports from a page component any more.
```

```bash
git add "apps/web/app/(app)/dashboard/profile/styles.ts" "apps/web/app/(app)/dashboard/profile/page.tsx" "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx" docs/playbooks/onboarding.md
git commit -m "refactor(profile): lift shared styles out of the page component"
```

---

### Task 3: Extract the two form panels

Pure move again. Each panel keeps its **own** hooks and state — no state is lifted, because Task 4 keeps all panels mounted.

**Files:**
- Create: `apps/web/app/(app)/dashboard/profile/ShapePanel.tsx`
- Create: `apps/web/app/(app)/dashboard/profile/NarrativePanel.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/page.tsx`
- Modify: `docs/playbooks/onboarding.md`

**Interfaces:**
- Produces: `<ShapePanel />` and `<NarrativePanel profile={...} setProfile={...} />` — both take **no other props**. `ShapePanel` owns `api.tenantProfile.get` + `api.tenantProfile.saveFacts`. `NarrativePanel` owns `api.onboarding.updateProfile`; the loaded `BusinessProfile` stays in the page because the page's own loading/empty branches read it.

- [ ] **Step 1: Move the business-shape half into `ShapePanel.tsx`**

Move, verbatim: the `TIER_NAME`, `SOURCE_WORDS`, `REVENUE_LABEL`, `FUNDING_LABEL`, `PRESET_TITLE`, `PRESET_COPY`, `SLOT_LABEL` constants, the `digits`/`toNumber`/`readMissing` helpers, all seven `useState` calls for the facts form, the `factsSeeded` ref + its effect, `onSaveFacts`, the `rowGaps`/`invite` computation, the whole "Business shape" `<div style={card}>` block (`page.tsx:364-555`), and the `PresetGroup` + `LabeledField` components.

Start the file with `"use client";`. Keep every comment — the anti-manipulation reasoning on the tier is the most important prose on this page.

`readMissing` is also needed by `NarrativePanel`. Put it in `ShapePanel.tsx` and export it; `NarrativePanel` imports it. One copy, not two.

`invite` needs `profile.oneLineDescription` for its `missingSlots` call. `ShapePanel` therefore takes one prop after all:

```tsx
export function ShapePanel({ oneLineDescription }: { oneLineDescription: string }) {
```

and the call site passes `profile.oneLineDescription`.

- [ ] **Step 2: Move the narrative half into `NarrativePanel.tsx`**

Move the `profile`/`saving`/`saved`/`error` state, the seeding effect, `set()`, `requiredFilled`, `onSave`, and the "What the business is" `<div style={card}>` block (`page.tsx:558-642`). It imports `LabeledField` and `readMissing` from `./ShapePanel`.

Signature — the page owns the loaded profile because its own loading and no-profile branches read it:

```tsx
export function NarrativePanel({
  profile,
  setProfile,
}: {
  profile: BusinessProfile;
  setProfile: React.Dispatch<React.SetStateAction<BusinessProfile | null>>;
}) {
```

- [ ] **Step 3: Reduce `page.tsx` to a shell**

`page.tsx` keeps: `api.onboarding.getProfile`, the `profile` state + seeding effect, the three early-return branches (loading / no profile), the header, and this body:

```tsx
  return (
    <div style={page}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <span style={label}>Business profile</span>
        <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
          Your business profile
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Every agent turn reads this. Keep it current — saving updates what Pikar AI knows about
          your business.
        </p>
      </header>

      <ShapePanel oneLineDescription={profile.oneLineDescription} />
      <NarrativePanel profile={profile} setProfile={setProfile} />
      <BlueprintPanel />
    </div>
  );
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pikar/web typecheck`
Expected: clean.

- [ ] **Step 5: Verify in a real browser that nothing regressed**

Run: `pnpm --filter @pikar/web build && pnpm --filter @pikar/web start -p 3111`
Open `http://localhost:3111/dashboard/profile`. Confirm: both Save buttons still work, the tier still renders as text, and the blueprint panel still appears. This is still a **single scroll** at this point — the tabs arrive in Task 4.

- [ ] **Step 6: Commit**

Append to the `onboarding.md` entry:

```
> `page.tsx` split into `ShapePanel` / `NarrativePanel` / `BlueprintPanel`; both writers unchanged.
```

```bash
git add "apps/web/app/(app)/dashboard/profile/" docs/playbooks/onboarding.md
git commit -m "refactor(profile): split the page into shape / narrative / blueprint panels"
```

---

### Task 4: The tab shell

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/page.tsx`
- Modify: `docs/playbooks/onboarding.md`

**Interfaces:**
- Consumes: `<ShapePanel />`, `<NarrativePanel />`, `<BlueprintPanel />` from Task 3.
- Produces: nothing other tasks import. Task 5 renders inside the `blueprint` panel.

- [ ] **Step 1: Add the tab model and the URL read**

At module scope in `page.tsx`:

```tsx
const TABS = [
  { id: "shape", label: "Business shape" },
  { id: "business", label: "What the business is" },
  { id: "blueprint", label: "Blueprint" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTabId = (v: string | null): v is TabId => TABS.some((t) => t.id === v);
```

Inside `ProfilePage`, alongside the existing state:

```tsx
  // `?tab=` read ONCE on mount, `window.location.search` deliberately — see
  // dashboard/voice/page.tsx:23-30. `useSearchParams` needs a Suspense boundary that typecheck
  // cannot see is missing; it either errors at prerender or silently deopts the page to CSR.
  // null = not read yet: the page is already showing its loading branch at that point, so the
  // resolved tab is never late enough to flash.
  const [tab, setTab] = useState<TabId | null>(null);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    setTab(isTabId(requested) ? requested : "shape");
  }, []);

  // `replaceState`, not a router push: switching tabs is not a navigation, and a push would add a
  // history entry per click and re-run the page's queries.
  function selectTab(next: TabId) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }
```

Extend the existing loading guard so the tab resolves inside the same window (`page.tsx:290`):

```tsx
  if (current === undefined || tab === null || (current && !profile)) {
```

- [ ] **Step 2: Render the tab bar and the three panels**

Replace the three panel calls from Task 3 Step 3 with:

```tsx
      <div
        role="tablist"
        aria-label="Business profile sections"
        style={{ display: "flex", gap: "0.35rem", borderBottom: "1px solid var(--rule)" }}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (delta === 0) return;
          e.preventDefault();
          const i = TABS.findIndex((t) => t.id === tab);
          const next = TABS[(i + delta + TABS.length) % TABS.length];
          if (next) selectTab(next.id);
        }}
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.id)}
              style={{
                appearance: "none",
                border: "none",
                background: "none",
                font: "inherit",
                cursor: "pointer",
                padding: "0.55rem 0.9rem",
                marginBottom: "-1px",
                fontWeight: 600,
                fontSize: "0.92rem",
                color: active ? "var(--ink)" : "var(--ink-soft)",
                borderBottom: `2px solid ${active ? "var(--teal-600)" : "transparent"}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* All three stay MOUNTED and are toggled with `hidden`. That is what makes a half-typed
          narrative survive a trip to the Blueprint tab and back — no state lifting needed. The
          wrapper carries no `display` style, because an inline `display` would defeat `hidden`. */}
      <div role="tabpanel" id="panel-shape" aria-labelledby="tab-shape" hidden={tab !== "shape"}>
        <ShapePanel oneLineDescription={profile.oneLineDescription} />
      </div>
      <div role="tabpanel" id="panel-business" aria-labelledby="tab-business" hidden={tab !== "business"}>
        <NarrativePanel profile={profile} setProfile={setProfile} />
      </div>
      <div role="tabpanel" id="panel-blueprint" aria-labelledby="tab-blueprint" hidden={tab !== "blueprint"}>
        <BlueprintPanel />
      </div>
```

- [ ] **Step 3: Add the cross-tab stale badge (spec §7)**

The stale count must be visible from **every** tab, not only Blueprint. Add a second subscriber to
the same query in `page.tsx` — Convex dedupes identical subscriptions, so this costs nothing:

```tsx
  const blueprintState = useQuery(api.blueprint.blueprintState);
  const staleCount =
    blueprintState?.state === "live_stale" ? blueprintState.unincorporatedCount : 0;
```

Render it inside the `role="tablist"` div, after the `TABS.map(...)`, pushed right:

```tsx
        <span style={{ flex: 1 }} />
        {staleCount > 0 && (
          <span
            style={{
              alignSelf: "center",
              fontSize: "0.75rem",
              fontWeight: 700,
              /* --held-text, NOT --held: amber on light paper is 1.9:1 and fails WCAG (BRAND §2). */
              color: "var(--held-text)",
              background: "color-mix(in srgb, var(--held) 16%, transparent)",
              padding: "0.2rem 0.55rem",
              borderRadius: "999px",
            }}
          >
            {staleCount} new {staleCount === 1 ? "document" : "documents"}
          </span>
        )}
```

A `<span>` inside a `tablist` is not a `tab` and carries no `role`, so it is skipped by tab
navigation — assistive tech sees three tabs, which is correct.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pikar/web typecheck`
Expected: clean.

- [ ] **Step 5: Verify the five behaviours that can only be seen in a browser**

Run: `pnpm --filter @pikar/web build && pnpm --filter @pikar/web start -p 3111`

Check each:
1. `/dashboard/profile` opens on **Business shape**; no flash of the wrong tab.
2. `/dashboard/profile?tab=blueprint` opens **directly** on Blueprint.
3. Type into "Offering" on the narrative tab, switch to Blueprint, switch back — **the text is still there**.
4. Focus a tab and press → and ←; focus moves and the panel follows.
5. If the blueprint is stale, the amber badge is visible from **all three** tabs.

- [ ] **Step 6: Commit**

Append to the `onboarding.md` entry:

```
> Three `role="tab"` panels, all mounted and toggled with `hidden`; `?tab=` read via
> `window.location.search` (the repo idiom — never `useSearchParams`).
```

```bash
git add "apps/web/app/(app)/dashboard/profile/page.tsx" docs/playbooks/onboarding.md
git commit -m "feat(profile): top tabs replace the single-column scroll"
```

---

### Task 5: The overview grid

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx`
- Modify: `docs/playbooks/onboarding.md`

**Interfaces:**
- Consumes: `BLUEPRINT_SEGMENTS`, `segmentFill`, `segmentHeadline`, `BlueprintSegment` from `@pikar/core` (Task 1); `card`, `label`, `primaryButton` from `./styles` (Task 2).
- Produces: nothing other tasks consume — this is the last code task.

- [ ] **Step 1: Replace `REPORT_SECTIONS` with the segment grid**

Delete the `REPORT_SECTIONS` constant (`BlueprintPanel.tsx:15-31`) — `BLUEPRINT_SEGMENTS` replaces it. Replace the `BlueprintReport` component with:

```tsx
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
```

- [ ] **Step 2: Write the tile**

```tsx
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
      aria-controls="segment-detail"
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
            background: complete ? "var(--teal-600)" : "var(--held)",
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
```

- [ ] **Step 3: Write the status tile**

```tsx
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
```

- [ ] **Step 4: Write the detail region**

Row markup is today's `BlueprintReport` rows, unchanged — including the origin line, which is the whole point of the blueprint.

```tsx
function SegmentDetail({
  segment,
  blueprint,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
}) {
  const populated = segment.fields.filter((f) => blueprint[f] !== null);

  return (
    <section id="segment-detail" style={{ display: "grid", gap: "0.65rem", paddingTop: "0.85rem", borderTop: "1px solid var(--rule)" }}>
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
```

- [ ] **Step 5: Rewire the panel's live branch**

In `BlueprintPanel`, the `live`/`live_stale` branch now passes the status data into the report instead of rendering its own footer. Replace the `<BlueprintReport blueprint={liveBlueprint} />` call **and** the footer `<div>` that follows it (`BlueprintPanel.tsx:140-165`) with:

```tsx
          <BlueprintReport
            blueprint={liveBlueprint}
            confirmedAt={blueprintState.confirmedAt}
            unincorporatedCount={
              blueprintState.state === "live_stale" ? blueprintState.unincorporatedCount : 0
            }
            rebuild={buildButton("Rebuild", blueprintState.state === "live_stale")}
          />
```

Delete the standalone `live_stale` paragraph (`BlueprintPanel.tsx:122-138`). Its job is now split
across two places that say different things: the **tab-bar badge** from Task 4 is the cross-tab
alert ("something changed"), and the **status tile** is the explanation next to the Rebuild button
that acts on it. The old full-width paragraph would be a third copy of the same sentence on one
screen, which reads as three separate problems.

Update the imports at the top of the file:

```tsx
import {
  BLUEPRINT_SEGMENTS,
  type BlueprintSegment,
  type BusinessBlueprint,
  FIELD_SPEC,
  segmentFill,
  segmentHeadline,
} from "@pikar/core";
```

`BLUEPRINT_FIELDS` and `BlueprintField` are no longer used here — remove them from the import or Biome will flag them.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm --filter @pikar/web typecheck && npx biome check "apps/web/app/(app)/dashboard/profile"`
Expected: typecheck clean. Biome may report pre-existing repo-wide `format` noise on CRLF files; there must be **no `lint/` rule failures** in the files you touched.

- [ ] **Step 7: Verify in a browser**

Run: `pnpm --filter @pikar/web build && pnpm --filter @pikar/web start -p 3111`

On `/dashboard/profile?tab=blueprint`, confirm:
1. Seven tiles: six segments plus Confirmed.
2. **Leads** reads "Not tracked yet" with a dead meter — **not** `0 / 3`.
3. Clicking a tile opens its detail below the grid; clicking it again closes it; opening another closes the first.
4. Each populated row still shows its origin ("Your own words" / "From <document>").
5. If the blueprint is stale, the count appears **once**, on the Confirmed tile.
6. A tenant with no blueprint still sees the "Build blueprint" call to action; a tenant with a pending draft still sees the diff.

- [ ] **Step 8: Commit**

Append to the `onboarding.md` entry:

```
> `BlueprintPanel` is now an overview grid of six segment tiles plus a status tile; the flat
> `REPORT_SECTIONS` grouping is gone. `total === 0` renders "Not tracked yet", never a ratio.
```

```bash
git add "apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx" docs/playbooks/onboarding.md
git commit -m "feat(profile): overview-first blueprint segment grid"
```

---

### Task 6: Full verification

**Files:**
- Modify: `docs/playbooks/onboarding.md` (close the entry with the verification result)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: all packages green. If a failure names a file you did not touch, check `git log --oneline -5` — this repo is worked by parallel lanes sharing one tree, and a foreign in-flight edit is not your regression.

- [ ] **Step 2: Typecheck the monorepo**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Confirm the backend really was untouched**

Run: `git diff --stat 19cdb2f..HEAD -- packages/backend`
Expected: **no output.** The spec's central claim is that this is a pure front-end change; if anything appears here, stop and explain why.

- [ ] **Step 4: Close the playbook entry**

Append the verification result to the `onboarding.md` entry:

```
> Verified 2026-08-02 on a rebuilt production server: tabs deep-link via `?tab=`, unsaved edits
> survive a tab switch, Leads reads "Not tracked yet", and the stale count appears once.
> `pnpm test` and `pnpm typecheck` green; `packages/backend` byte-unchanged.
```

- [ ] **Step 5: Commit**

```bash
git add docs/playbooks/onboarding.md
git commit -m "docs(profile): close the §9 entry -- tabs + segments verified"
```

---

## Notes for the implementer

- **This repo is worked by parallel lanes in ONE shared working tree.** Files you never touched will go dirty mid-task, and commits will land under you. Never `git add -A` — stage the exact paths listed in each task. Check `git status --porcelain` before every commit.
- **`.planning/*.md` and `docs/playbooks/*.md` are CRLF**, and `onboarding.md`'s blank line after the title is `\r\r\n`. A multi-line `\n` anchor silently fails to match. Edit those files with a short Python script that reads bytes, asserts its anchor is unique, and writes bytes back.
- **`next start` serves a frozen build.** Any browser check requires `pnpm --filter @pikar/web build` first, then a restart of the server process.
