# Blueprint Node Anatomy (Living-Map Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a blueprint segment reveals a fixed four-band anatomy — Knowledge / Process / Tools / Outcomes — with the "Ask <specialist> →" handoff available on every specialist-owned segment, not just the first gap.

**Architecture:** Pure re-composition of the existing profile surface. The segment detail (`SegmentDetail`) and the specialist handoff (`AskSpecialist`) move out of `BlueprintPanel.tsx` (672 lines) into a new `SegmentAnatomy.tsx`, which renders the four bands. The Process and Tools bands read the specialist capability grant that already lives in core (`SPECIALISTS[route].tools`) — displayed tools are the *real* grant, never invented copy. No backend change, no schema change, no new dependency.

**Tech Stack:** Next.js app router client components, Convex `useQuery`/`useAction`, `@pikar/core` (`BLUEPRINT_SEGMENTS`, `SPECIALISTS`), inline styles from `styles.ts` + CSS variables from `globals.css`.

**Spec:** `docs/superpowers/specs/2026-08-08-blueprint-living-map-design.md` §4 (D4, D5), §7, §10.

## Global Constraints

- No component library, no diagram library (spec §10; CLAUDE.md §10 — the app deliberately has none).
- Colors via `globals.css` CSS variables only — never a hardcoded hex a token covers (CLAUDE.md §10).
- Honest zeros: a band with nothing real says so in words; never a fake count or placeholder diagram (spec D4, BRAND §5).
- The Outcomes band ships as honest deferral copy — pulse aggregates arrive in slice 2 (spec §9).
- `docs/playbooks/onboarding.md` watches `apps/web/app/(app)/dashboard/profile/` — it MUST be updated (or its `Last verified` line bumped) in the same commit as any change here, or the Stop hook blocks the turn (CLAUDE.md §9).
- **CRLF warning:** `docs/playbooks/*.md` files are CRLF. Multi-line Edit anchors silently no-op — use single-line anchors only when editing them.
- Shared working tree: parallel lanes commit here. Stage files by exact path; NEVER `git add -A`. Check `git status` before every commit and leave foreign files alone.
- No new UI test framework (`apps/web` is Playwright-e2e only, per the 08-02 spec §9 precedent). The only new logic is declarative presentation records; the runnable check is `pnpm typecheck` per task plus the prod-build verification in Task 5.
- Preserve the `segment-detail-${segment.id}` element id — `SegmentLedger`'s `aria-controls` points at it (`BlueprintPanel.tsx:518`).

---

### Task 1: Extract `segmentCopy.ts` and `SegmentAnatomy.tsx` (no visual change yet)

**Files:**
- Create: `apps/web/app/(app)/dashboard/profile/segmentCopy.ts`
- Create: `apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/BlueprintPanel.tsx` (remove `SEGMENT_COPY` at :53-99, `joinPhrases` at :374-378, `AskSpecialist` at :437-487, `SegmentDetail` at :605-671; add imports)

**Interfaces:**
- Consumes: `BLUEPRINT_SEGMENTS`, `FIELD_SPEC`, `BlueprintSegment`, `BusinessBlueprint` from `@pikar/core`; `api.cockpit.sendCockpitMessage`.
- Produces (Tasks 2–4 build on these):
  - `segmentCopy.ts`: `export const SEGMENT_COPY: Record<string, { short: string; known: string; gap: string; from: string; seed: string }>` (moved verbatim), `export function joinPhrases(parts: string[]): string` (moved verbatim).
  - `SegmentAnatomy.tsx`: `export function SegmentAnatomy({ segment, blueprint }: { segment: BlueprintSegment; blueprint: BusinessBlueprint })`, `export function AskSpecialist({ segment }: { segment: BlueprintSegment })`, and an internal `function Band({ title, children }: { title: string; children: React.ReactNode })`.

- [ ] **Step 1: Create `segmentCopy.ts`**

Move `SEGMENT_COPY` (BlueprintPanel.tsx:53-99, with its doc comment at :45-52) and `joinPhrases` (:374-378, with its comment) into the new file verbatim, adding `export` to both. No `"use client"` — it is plain data + one pure function (the `connections.ts` precedent).

- [ ] **Step 2: Create `SegmentAnatomy.tsx`**

```tsx
"use client";

import { api } from "@pikar/backend/api";
import { type BlueprintSegment, type BusinessBlueprint, FIELD_SPEC } from "@pikar/core";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEGMENT_COPY } from "./segmentCopy";
import { label } from "./styles";

const soft: React.CSSProperties = { margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" };

/** One titled region of the anatomy. Every segment renders the same four, in the same order —
 *  the anatomy is a fixed shape populated by what's real, never a per-segment layout (spec D4). */
function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "0.45rem" }}>
      <span
        style={{
          fontSize: "0.66rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
        }}
      >
        {title}
      </span>
      {children}
    </div>
  );
}

export function SegmentAnatomy({
  segment,
  blueprint,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
}) {
  const populated = segment.fields.filter((f) => blueprint[f] !== null);

  return (
    <section
      id={`segment-detail-${segment.id}`}
      style={{
        display: "grid",
        gap: "0.9rem",
        paddingTop: "0.85rem",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <h3 style={{ ...label, margin: 0 }}>{segment.label}</h3>

      <Band title="Knowledge">
        {segment.fields.length === 0 ? (
          <p style={soft}>
            Not tracked yet. This part of the business isn't wired into the blueprint, so
            rebuilding won't change what's shown here.
          </p>
        ) : (
          populated.length === 0 && (
            <p style={soft}>
              Nothing here yet. Add documents to your vault and rebuild, and anything they say
              about this part of the business will land here.
            </p>
          )
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
                  {entry.origin === "stated"
                    ? "Your own words"
                    : `From ${entry.source ?? "a vault document"}`}
                </span>
              </div>
            </div>
          );
        })}
      </Band>
    </section>
  );
}
```

The Knowledge band body is `SegmentDetail`'s body moved verbatim — only the wrapping `Band` and the outer `gap: "0.9rem"` are new.

- [ ] **Step 3: Move `AskSpecialist` into `SegmentAnatomy.tsx`**

Cut `AskSpecialist` (BlueprintPanel.tsx:437-487, with its doc comment at :432-436) and paste it into `SegmentAnatomy.tsx` with `export` added. Its `SEGMENT_COPY` reference now resolves to the `./segmentCopy` import already in the file.

- [ ] **Step 4: Rewire `BlueprintPanel.tsx`**

- Delete the moved blocks (`SEGMENT_COPY`, `joinPhrases`, `AskSpecialist`, `SegmentDetail`).
- Add: `import { AskSpecialist, SegmentAnatomy } from "./SegmentAnatomy";` and `import { joinPhrases, SEGMENT_COPY } from "./segmentCopy";`
- Replace the one `SegmentDetail` call site (:337) with:

```tsx
      {openSegment && <SegmentAnatomy segment={openSegment} blueprint={blueprint} />}
```

- Drop now-unused imports from the panel's `@pikar/core` import if typecheck flags them (`FIELD_SPEC` moves out with the detail; `BLUEPRINT_FIELDS` stays — `EMPTY_BLUEPRINT` and the KPI math still use it).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean. The classic failure here is a leftover unused import in `BlueprintPanel.tsx` — delete it, don't suppress.

- [ ] **Step 6: Bump the playbook and commit**

In `docs/playbooks/onboarding.md`, bump only the `Last verified` line (single-line Edit anchor — the file is CRLF). Then:

```bash
git status --short   # confirm only your four files changed; leave foreign files alone
git add apps/web/app/\(app\)/dashboard/profile/SegmentAnatomy.tsx apps/web/app/\(app\)/dashboard/profile/segmentCopy.ts apps/web/app/\(app\)/dashboard/profile/BlueprintPanel.tsx docs/playbooks/onboarding.md
git commit -m "refactor(blueprint): extract SegmentAnatomy and segmentCopy from BlueprintPanel"
```

---

### Task 2: Process band — the owning specialist + Ask on every specialist segment

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx`

**Interfaces:**
- Consumes: `SPECIALISTS` (from `@pikar/core` — `Readonly<Record<SpecialistRoute, SpecialistSpec>>`, where `spec.tools` is the code-owned capability grant), `AskSpecialist` and `joinPhrases` from Task 1.
- Produces: internal `ProcessBand({ segment })` and `const TOOL_LABELS: Record<string, string>` — Task 3 reuses `TOOL_LABELS`.

- [ ] **Step 1: Add the labels record and the band**

Add to `SegmentAnatomy.tsx` (import `SPECIALISTS` from `@pikar/core`, `joinPhrases` from `./segmentCopy`):

```tsx
/** User-facing names for the capability grant's tool ids. Only user-meaningful tools appear;
 *  an id with no entry here (e.g. `declareUnsupported`, an internal refusal channel) renders
 *  nothing rather than leaking an internal name. */
const TOOL_LABELS: Record<string, string> = {
  searchVault: "your vault documents",
  webResearch: "live web research",
};

function ProcessBand({ segment }: { segment: BlueprintSegment }) {
  if (segment.specialist === null) {
    return (
      <p style={soft}>
        No agent owns this section — it's yours. Facts here come from your profile and your
        documents.
      </p>
    );
  }
  const grant = SPECIALISTS[segment.specialist];
  const tools = grant.tools
    .map((t) => TOOL_LABELS[t])
    .filter((t): t is string => t !== undefined);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.9rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: "block", fontSize: "0.9rem", color: "var(--ink)" }}>
          {segment.specialist}
        </strong>
        <span style={{ ...soft, fontSize: "0.83rem" }}>
          {tools.length > 0
            ? `Works from ${joinPhrases(tools)}; anything it sends stops at your approval.`
            : "Anything it sends stops at your approval."}
        </span>
      </span>
      <AskSpecialist segment={segment} />
    </div>
  );
}
```

The approval sentence is true by construction — every specialist write stops at the human Approve gate (`specialists.ts:54`, ADR-007) — and it is the single most trust-building line on the surface.

- [ ] **Step 2: Render it**

In `SegmentAnatomy`, after the Knowledge band:

```tsx
      <Band title="Process">
        <ProcessBand segment={segment} />
      </Band>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git status --short
git add apps/web/app/\(app\)/dashboard/profile/SegmentAnatomy.tsx docs/playbooks/onboarding.md
git commit -m "feat(blueprint): Process band — owning specialist and Ask on every specialist segment"
```

(Bump the playbook's `Last verified` line again only if this lands as a separate turn; within one session the Task 1 bump already covers the hook.)

---

### Task 3: Tools band — real connections, real grant, real blockers

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/segmentCopy.ts` (add `SEGMENT_BLOCKED`)

**Interfaces:**
- Consumes: `api.gmailAuth.gmailStatus` (returns `undefined` while loading, then `{ connected: boolean, ... }` — the flash-of-wrong-state discipline from `ConnectionsPanel.tsx:72-77`), `BLOCKED` from `./connections` (`{ id, label, blocker }[]`), `TOOL_LABELS` from Task 2.
- Produces: internal `ToolsBand({ segment })`, `ToolRow({ name, state, detail? })`; `SEGMENT_BLOCKED: Record<string, readonly string[]>` in `segmentCopy.ts`.

- [ ] **Step 1: Add the blocked-connection relevance map to `segmentCopy.ts`**

```ts
/** Which BLOCKED connection ids (connections.ts) are relevant to a segment's work. Only `leads`
 *  today: social posting is the lead engine's missing actuator. A segment absent here shows no
 *  blocked rows — absence of a blocker is not a fact worth a row. */
export const SEGMENT_BLOCKED: Record<string, readonly string[]> = {
  leads: ["social"],
};
```

- [ ] **Step 2: Add the band components to `SegmentAnatomy.tsx`**

Add imports: `useQuery` from `convex/react`, `BLOCKED` from `./connections`, `SEGMENT_BLOCKED` from `./segmentCopy`.

```tsx
function ToolRow({ name, state, detail }: { name: string; state: string; detail?: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        alignItems: "baseline",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: "0.88rem", color: "var(--ink)", fontWeight: 600 }}>{name}</span>
        {detail !== undefined && (
          <span style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-soft)" }}>
            {detail}
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
          whiteSpace: "nowrap",
        }}
      >
        {state}
      </span>
    </div>
  );
}

function ToolsBand({ segment }: { segment: BlueprintSegment }) {
  // `undefined` = still loading. "Checking…" — never "Not connected" — while undefined: the
  // false-negative would invite reconnecting an already-connected account (ConnectionsPanel's
  // flash-of-wrong-state discipline).
  const gmail = useQuery(api.gmailAuth.gmailStatus);
  const blocked = BLOCKED.filter((b) => (SEGMENT_BLOCKED[segment.id] ?? []).includes(b.id));

  if (segment.specialist === null) {
    return <ToolRow name="Your profile & vault documents" state="Built in" />;
  }

  const grant = SPECIALISTS[segment.specialist];
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {grant.tools.map((t) => {
        const name = TOOL_LABELS[t];
        return name === undefined ? null : <ToolRow key={t} name={name} state="Built in" />;
      })}
      <ToolRow
        name="Google — Gmail, Calendar & Drive"
        state={gmail === undefined ? "Checking…" : gmail.connected ? "Connected" : "Not connected"}
        detail="How approved work leaves the building."
      />
      {blocked.map((b) => (
        <ToolRow key={b.id} name={b.label} state="Not available" detail={b.blocker} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Render it**

After the Process band:

```tsx
      <Band title="Tools">
        <ToolsBand segment={segment} />
      </Band>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git status --short
git add apps/web/app/\(app\)/dashboard/profile/SegmentAnatomy.tsx apps/web/app/\(app\)/dashboard/profile/segmentCopy.ts
git commit -m "feat(blueprint): Tools band — live Gmail state, capability grant, blocked reasons"
```

---

### Task 4: Outcomes band — honest deferral

**Files:**
- Modify: `apps/web/app/(app)/dashboard/profile/SegmentAnatomy.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the fourth `Band`. Slice 2 (pulse) replaces its body with real aggregates — keep it a distinct block so that replacement is one edit.

- [ ] **Step 1: Render the band**

After the Tools band:

```tsx
      <Band title="Outcomes">
        {/* Slice 2 (pulse layer) replaces this with real aggregates: emails delivered, plans
            completed, and how recently — spec §3.1. Honest deferral until then, never a fake count. */}
        <p style={{ ...soft, fontSize: "0.83rem" }}>
          Not measured yet. When outcome tracking lands, what this section actually shipped —
          emails delivered, plans completed — appears here with how recent it is.
        </p>
      </Band>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git status --short
git add apps/web/app/\(app\)/dashboard/profile/SegmentAnatomy.tsx
git commit -m "feat(blueprint): Outcomes band with honest slice-2 deferral"
```

---

### Task 5: Playbook content + real-app verification

**Files:**
- Modify: `docs/playbooks/onboarding.md` (CRLF — single-line Edit anchors only)

**Interfaces:**
- Consumes: everything above.
- Produces: the slice's definition-of-done.

- [ ] **Step 1: Update the playbook's content**

In `docs/playbooks/onboarding.md`, find the section describing the profile/blueprint surface and add a short paragraph (match the file's existing prose style): the segment detail is now the four-band anatomy in `SegmentAnatomy.tsx` (Knowledge / Process / Tools / Outcomes); `AskSpecialist` lives there and renders for every specialist-owned segment; displayed tools mirror the code-owned capability grant (`SPECIALISTS[route].tools`) so a grant change shows up here without a UI edit. Bump the `Last verified` line to 2026-08-08.

- [ ] **Step 2: Build and verify in the real app**

```bash
pnpm --filter web build
```

Expected: build succeeds. Then start the production server and verify by hand (the 08-02 spec's DoD — `next start` serves a frozen build, dev mode proves nothing):

- Open `/dashboard/profile?tab=blueprint`.
- Click each of the six segments (canvas node or ledger row): all four bands render, in order, for every segment.
- Offer/Money model/Leads/Evidence show the Ask button; Foundation/Direction show "No agent owns this section — it's yours."
- Leads' Tools band shows the Social accounts row with its legal-entity blocker text.
- Gmail row shows "Checking…" then the true state — never a "Not connected" flash on a connected account.
- Keyboard: ledger row → Enter opens the anatomy; `aria-controls` still targets `segment-detail-<id>`.

- [ ] **Step 3: Commit**

```bash
git status --short
git add docs/playbooks/onboarding.md
git commit -m "docs(blueprint): record the four-band anatomy in the onboarding playbook"
```

---

## Out of scope (later slices of the same spec)

- **Slice 2 — pulse**: `blueprint.blueprintPulse` query + core aggregation, breathing dot, recency dimming, status readout, real Outcomes numbers (spec §3).
- **Slice 3 — goals**: `goals` table, mutations, canvas milestone flags, Direction band, spine section (spec §5).
- Last-run status/recency in the Process band — needs slice 2's aggregates; the band's flex row leaves room for it.
