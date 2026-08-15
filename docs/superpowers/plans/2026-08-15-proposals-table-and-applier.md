# Proposals Table and Applier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the spine that lets a proposed business fact — from a document, a chat turn, or a voice session — be stored, reviewed, and applied to the right store through that store's existing single writer.

**Architecture:** One `proposals` row per source event holds N `ProposedFact` items. A CLOSED target registry in `packages/core` is the single definition of what may be proposed, and its three consumers (the future model schema, the applier's dispatch, the future gap-finder) all read it. The applier calls the four existing writers and never touches `db` directly, so every validator, range check and consent rule that guards manual entry guards proposal-applied entry automatically. Contradictions and stale facts are excluded from accept-all by pure predicates that live beside the registry.

**Tech Stack:** TypeScript, Convex, vitest + convex-test, `@pikar/core` (pure-TS domain layer).

**Spec:** `docs/superpowers/specs/2026-08-15-document-driven-blueprint-updates-design.md` (§3.1-3.3, §5, §6.1-6.3; this is plan 2 of §9)

## Global Constraints

- **CLAUDE.md §1** — domain logic lives in `packages/core` (pure TS, Convex-free). `packages/backend/convex/` is a thin adapter. The registry, the fact type and both predicates go in core.
- **CLAUDE.md §2** — never import raw `query`/`mutation`/`action` from `./_generated/server`. Use `tenantQuery` / `tenantMutation` / `tenantAction` from `convex/lib/functions.ts` (defined at lines 63, 66, 74).
- **CLAUDE.md §4** — `basis` and provenance `source` carry refs, ids, labels and counts ONLY. Never raw user content, never a quoted passage.
- **CLAUDE.md §5** — no hardcoded agent prompts. This plan adds none; it is storage and application only.
- **CLAUDE.md §8** — reuse before writing. `FigureOrigin`, `FigureActor`, `FigureConfidence` and `FieldProvenance` already exist in `packages/core/src/financeClaim.ts`. `CASH_INPUTS` (`packages/core/src/cash.ts:147`), `BLUEPRINT_FIELDS`/`FIELD_SPEC` (`packages/core/src/blueprint.ts:38`) and `CrmOperation` (`packages/core/src/contacts.ts:120`) already define the field sets. Do not restate any of them.
- **No new dependency.** Nothing here needs one.
- **The registry is CLOSED.** Adding a target must be a compile error until every consumer handles it. That is the point, not an inconvenience.
- **The applier never calls `ctx.db` directly.** Every write goes through the store's existing single writer. A direct write is a defect even if it produces the same row.
- Run all commands from `packages/backend/` unless a task says otherwise. Test: `pnpm vitest run <file>`. Typecheck: `pnpm typecheck`. Core tests run from `packages/core/`.
- **Shared working tree.** This repo has nine git worktrees and several lanes commit to the same branch concurrently. NEVER `git add -A` or `git add .`. Run `git diff -- <file>` before every `git add`; use `git add -p` on any file you did not create. Never rebase, reset, or amend.

---

### Task 1: The §4 basis guard moves to the shared validator

Ruling PF-18 from plan 1. The rule "a basis names where a number came from, it does not quote it" is enforced today at ONE producer (`llm.ts:2902`), while `validateFigureClaim` — the shared trust boundary both current producers run — checks only that the basis is non-blank. This plan adds a SECOND producer, so the guard moves to the boundary before that producer exists rather than after.

**Files:**
- Modify: `packages/core/src/financeClaim.ts` (`validateFigureClaim`)
- Modify: `packages/backend/convex/llm.ts:2896-2904` (remove the now-duplicated guard)
- Test: `packages/core/src/financeClaim.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `validateFigureClaim` now refuses a basis containing `"`, `'`, `“` or `”`, or longer than 120 characters, with the reason string `"A basis must name where the number came from, not quote it."`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/financeClaim.test.ts`. Read the file's existing fixture style first and match it — it will already have a helper or literal for a valid claim; reuse that rather than inventing a new shape.

```ts
const BASIS_CAP = 120;

test("a basis carrying quoted content is refused", () => {
  const claim = { ...validClaim, basis: 'the P&L says "revenue 40200"' };
  const result = validateFigureClaim(claim, NOW);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(/not quote it/);
});

test("a basis long enough to be a transcript is refused", () => {
  const claim = { ...validClaim, basis: "a".repeat(BASIS_CAP + 1) };
  expect(validateFigureClaim(claim, NOW).ok).toBe(false);
});

test("a basis of exactly the cap is allowed", () => {
  const claim = { ...validClaim, basis: "a".repeat(BASIS_CAP) };
  expect(validateFigureClaim(claim, NOW).ok).toBe(true);
});

test("curly quotes are refused too, not just straight ones", () => {
  const claim = { ...validClaim, basis: "the deck said “40k”" };
  expect(validateFigureClaim(claim, NOW).ok).toBe(false);
});

test("an ordinary ref-style basis still passes", () => {
  const claim = { ...validClaim, basis: "vaultDoc:abc123 p4" };
  expect(validateFigureClaim(claim, NOW).ok).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `packages/core`: `pnpm vitest run src/financeClaim.test.ts -t "basis"`
Expected: the quote and length tests FAIL (currently only a blank basis is refused).

- [ ] **Step 3: Move the guard into the validator**

In `packages/core/src/financeClaim.ts`, immediately after the existing blank-basis check in `validateFigureClaim`:

```ts
  // §4 at the SHARED boundary, not at one producer. `basis` reaches the audit log and the approval
  // card, so "refs only, never quoted content" has to hold for every writer — the cockpit tool that
  // enforced it locally, and the proposal applier that did not exist when it was written. Not
  // mechanically decidable in general; these two cheap shapes catch the realistic failures (a model
  // quoting the source line, or pasting a transcript).
  if (/["'“”]/.test(claim.basis) || claim.basis.length > BASIS_CHAR_CAP) {
    return { ok: false, reason: "A basis must name where the number came from, not quote it." };
  }
```

And above the function, beside the other module constants:

```ts
/** Long enough for a real ref (`vaultDoc:<id> p4`), far short of a pasted passage. */
export const BASIS_CHAR_CAP = 120;
```

- [ ] **Step 4: Delete the now-duplicated guard in llm.ts**

Remove the `if (/["'“”]/.test(u.basis) || u.basis.length > 120)` block and its comment at `packages/backend/convex/llm.ts:2896-2904`. Replace the comment with one line naming where the rule now lives:

```ts
          // §4's refs-only rule is enforced in `validateFigureClaim` (@pikar/core) — the shared
          // boundary every producer runs — so it is not repeated here.
```

The `validateFigureClaim` call further down this handler already runs on the constructed claim, so the rule still bites; verify that by reading the surrounding code before deleting.

- [ ] **Step 5: Run both suites**

From `packages/core`: `pnpm vitest run src/financeClaim.test.ts` — expect PASS.
From `packages/backend`: `pnpm vitest run convex/cash.test.ts convex/cockpitTools.test.ts convex/llm*.test.ts` and `pnpm typecheck` — expect PASS. If a cockpit test asserted the old inline refusal sentence, update it to the new shared reason string; do NOT weaken it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/financeClaim.ts packages/core/src/financeClaim.test.ts packages/backend/convex/llm.ts
git commit -m "refactor(21-02): the refs-only basis rule moves to the boundary every producer runs"
```

---

### Task 2: The closed target registry

**Files:**
- Create: `packages/core/src/proposal.ts`
- Create: `packages/core/src/proposal.test.ts`
- Modify: `packages/core/src/index.ts` (export the new module)

**Interfaces:**
- Consumes: `FigureOrigin`, `FigureActor`, `FigureConfidence` from `./financeClaim`; `CASH_INPUTS` from `./cash`; `BLUEPRINT_FIELDS`, `FIELD_SPEC` from `./blueprint`.
- Produces:
  - `type ProposalStore = "financeInputs" | "scorecard" | "profile" | "contacts" | "followUps"`
  - `type ProposedFact = { target: { store: ProposalStore; field: string }; value: number | string | boolean; confidence: FigureConfidence; origin: FigureOrigin; actor: FigureActor; basis: string; observedAt: number; sourceLocator: ProposalSourceLocator }`
  - `type ProposalSourceLocator = { kind: "vault_doc"; vaultDocId: string } | { kind: "chat"; threadId: string } | { kind: "voice"; voiceSessionId: string }`
  - `const PROPOSAL_TARGETS: readonly ProposalTarget[]` and `proposalTarget(store, field): ProposalTarget | null`
  - `type ProposalTarget = { store: ProposalStore; field: string; label: string; valueType: "number" | "string" | "boolean"; unlocks: string | null }`

> **A spec correction, deliberate.** Spec §5 lists the narrative store as `blueprint`, routed through "`confirmBlueprint`'s write path". That is imprecise and following it literally would produce a wrong design. `confirmBlueprint` (`blueprint.ts:342`) serializes a WHOLE derived blueprint into a `vaultDocuments` row from `tenantProfiles.blueprintDraft`; it is not a per-field writer and has no way to accept one proposed field. The blueprint's *stated* values come from `BusinessProfile` via `statedFromProfile` (`blueprint.ts:186`), and the single writer for those is `writeProfileDoc` in `onboarding.ts:460`. So this plan names the store `profile`, targets `BusinessProfile` fields, and routes to `writeProfileDoc`. The blueprint remains a derived view that picks the change up on its next build.

- [ ] **Step 1: Write the failing totality test**

Create `packages/core/src/proposal.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { BLUEPRINT_FIELDS, FIELD_SPEC } from "./blueprint";
import { CASH_INPUTS } from "./cash";
import { PROPOSAL_TARGETS, proposalTarget } from "./proposal";

describe("the target registry is closed and total", () => {
  test("every CASH_INPUTS field is a target, on its own store", () => {
    for (const spec of CASH_INPUTS) {
      const target = proposalTarget(spec.store, spec.field);
      expect(target, `${spec.field} missing from PROPOSAL_TARGETS`).not.toBeNull();
      expect(target?.valueType).toBe("number");
    }
  });

  test("every model-derivable blueprint field is a profile target", () => {
    for (const field of BLUEPRINT_FIELDS) {
      if (!FIELD_SPEC[field].derivable) continue;
      expect(proposalTarget("profile", field), `${field} missing`).not.toBeNull();
    }
  });

  test("a non-derivable blueprint field is NOT a target", () => {
    // `entities` is graph-derived and `tier` is computed; neither may be proposed.
    expect(proposalTarget("profile", "entities")).toBeNull();
    expect(proposalTarget("profile", "tier")).toBeNull();
  });

  test("no target names a field absent from its source list", () => {
    const cashFields = new Set(CASH_INPUTS.map((s) => `${s.store}:${s.field}`));
    const blueprintFields = new Set<string>(BLUEPRINT_FIELDS);
    for (const t of PROPOSAL_TARGETS) {
      if (t.store === "financeInputs" || t.store === "scorecard") {
        expect(cashFields.has(`${t.store}:${t.field}`), `${t.field} not in CASH_INPUTS`).toBe(true);
      } else if (t.store === "profile") {
        expect(blueprintFields.has(t.field), `${t.field} not in BLUEPRINT_FIELDS`).toBe(true);
      }
    }
  });

  test("no duplicate store+field pair", () => {
    const keys = PROPOSAL_TARGETS.map((t) => `${t.store}:${t.field}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("an unknown pair resolves to null rather than throwing", () => {
    expect(proposalTarget("scorecard", "notAField")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

From `packages/core`: `pnpm vitest run src/proposal.test.ts`
Expected: FAIL — `./proposal` does not exist.

- [ ] **Step 3: Write the registry**

Create `packages/core/src/proposal.ts`. Derive from the existing lists; do NOT hand-type the finance or profile fields.

```ts
// The ONE closed table of what may be proposed (design §3.3). Three consumers read it — the
// derive pass's structured-output schema (plan 3), this plan's applier dispatch, and the gap
// finder (plan 4) — so a target that is legal for one is legal for all three, by construction
// rather than by three lists agreeing.
//
// It is ASSEMBLED from the existing field sets, never a restatement of them: `CASH_INPUTS` owns
// which finance figures exist and which store each lives in, and `FIELD_SPEC.derivable` owns which
// narrative fields a model may propose. Adding a field there adds it here; the totality test in
// proposal.test.ts fails if the two ever drift.
import { BLUEPRINT_FIELDS, FIELD_SPEC } from "./blueprint";
import { CASH_INPUTS } from "./cash";
import type { FigureActor, FigureConfidence, FigureOrigin } from "./financeClaim";

export type ProposalStore =
  | "financeInputs"
  | "scorecard"
  | "profile"
  | "contacts"
  | "followUps";

export type ProposalTarget = {
  readonly store: ProposalStore;
  readonly field: string;
  readonly label: string;
  readonly valueType: "number" | "string" | "boolean";
  /** What filling this unlocks, for gap ranking in plan 4. `null` when it unlocks nothing named. */
  readonly unlocks: string | null;
};

/** Where a proposed fact came from. Refs and ids ONLY (§4) — never a passage. */
export type ProposalSourceLocator =
  | { readonly kind: "vault_doc"; readonly vaultDocId: string }
  | { readonly kind: "chat"; readonly threadId: string }
  | { readonly kind: "voice"; readonly voiceSessionId: string };

export type ProposedFact = {
  readonly target: { readonly store: ProposalStore; readonly field: string };
  readonly value: number | string | boolean;
  readonly confidence: FigureConfidence;
  readonly origin: FigureOrigin;
  /** Always stamped at apply time, never read from the model. See the applier. */
  readonly actor: FigureActor;
  /** Refs/ids/labels ONLY (§4). Code-constructed, never model-supplied. */
  readonly basis: string;
  /** When the fact was TRUE, not when the row was written. */
  readonly observedAt: number;
  readonly sourceLocator: ProposalSourceLocator;
};

const CONTACT_TARGETS: readonly ProposalTarget[] = [
  {
    store: "contacts",
    field: "addContact",
    label: "Add a contact",
    valueType: "string",
    unlocks: null,
  },
  {
    store: "followUps",
    field: "addFollowUp",
    label: "Add a follow-up",
    valueType: "string",
    unlocks: null,
  },
];

export const PROPOSAL_TARGETS: readonly ProposalTarget[] = [
  ...CASH_INPUTS.map((spec) => ({
    store: spec.store as ProposalStore,
    field: spec.field as string,
    label: spec.label,
    valueType: "number" as const,
    unlocks: spec.unlocks ?? null,
  })),
  ...BLUEPRINT_FIELDS.filter((f) => FIELD_SPEC[f].derivable).map((f) => ({
    store: "profile" as ProposalStore,
    field: f as string,
    label: FIELD_SPEC[f].label,
    valueType: "string" as const,
    unlocks: null,
  })),
  ...CONTACT_TARGETS,
];

const BY_KEY = new Map(PROPOSAL_TARGETS.map((t) => [`${t.store}:${t.field}`, t]));

/** `null` for an unknown pair — a model naming a field that does not exist is expected input,
 *  not an exceptional condition, so this never throws. */
export const proposalTarget = (store: string, field: string): ProposalTarget | null =>
  BY_KEY.get(`${store}:${field}`) ?? null;
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/core/src/index.ts`, in the same style as its neighbours:

```ts
export * from "./proposal";
```

- [ ] **Step 5: Run tests and typecheck**

From `packages/core`: `pnpm vitest run src/proposal.test.ts` — expect PASS.
From `packages/core`: `pnpm typecheck`. From `packages/backend`: `pnpm typecheck`.
If `CashInputSpec.unlocks` is not optional, drop the `?? null`; read the type before assuming.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/proposal.ts packages/core/src/proposal.test.ts packages/core/src/index.ts
git commit -m "feat(21-02): one closed table of what may be proposed, assembled from the field sets that already exist"
```

---

### Task 3: Contradiction and staleness predicates

These are the rules that protect one-click accept-all (spec §6.1, §6.2). They are pure and live beside the registry so the applier and the future UI cannot disagree about what is safe to sweep into a batch.

**Files:**
- Modify: `packages/core/src/proposal.ts`
- Modify: `packages/core/src/proposal.test.ts`

**Interfaces:**
- Consumes: `ProposedFact` from Task 2.
- Produces:
  - `type ProposalGuard = "blank" | "overwrite" | "stale"`
  - `classifyProposal(fact: ProposedFact, current: CurrentValue | null): ProposalGuard`
  - `type CurrentValue = { value: number | string | boolean; statedByUser: boolean; statedAt: number | null }`
  - `const sweepable = (g: ProposalGuard) => g === "blank"`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/proposal.test.ts`:

```ts
import { classifyProposal, sweepable } from "./proposal";

const fact = {
  target: { store: "scorecard" as const, field: "cac" },
  value: 340,
  confidence: "high" as const,
  origin: "stated" as const,
  actor: "agent" as const,
  basis: "vaultDoc:abc123",
  observedAt: 1_700_000_000_000,
  sourceLocator: { kind: "vault_doc" as const, vaultDocId: "abc123" },
};

describe("what may be swept into accept-all", () => {
  test("a fact filling a blank is sweepable", () => {
    expect(classifyProposal(fact, null)).toBe("blank");
    expect(sweepable("blank")).toBe(true);
  });

  test("overwriting a value the USER stated is a contradiction, never swept", () => {
    const current = { value: 150, statedByUser: true, statedAt: 1_600_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("overwrite");
    expect(sweepable("overwrite")).toBe(false);
  });

  test("overwriting an AGENT-written value is NOT a contradiction", () => {
    // The owner's word is what accept-all must never quietly replace. A prior agent figure
    // carries no such authority, so a newer one may sweep.
    const current = { value: 150, statedByUser: false, statedAt: 1_600_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("blank");
  });

  test("a fact older than the stored figure is stale, never swept", () => {
    const current = { value: 150, statedByUser: false, statedAt: 1_800_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("stale");
    expect(sweepable("stale")).toBe(false);
  });

  test("staleness is checked before the overwrite rule, so an old fact over a user value is stale", () => {
    const current = { value: 150, statedByUser: true, statedAt: 1_800_000_000_000 };
    expect(classifyProposal(fact, current)).toBe("stale");
  });

  test("an unknown stored time does not make a fact stale", () => {
    // A legacy row with no recorded time must not silently block every new fact.
    const current = { value: 150, statedByUser: false, statedAt: null };
    expect(classifyProposal(fact, current)).toBe("blank");
  });

  test("an equal timestamp is not stale — only strictly older is", () => {
    const current = { value: 150, statedByUser: false, statedAt: fact.observedAt };
    expect(classifyProposal(fact, current)).toBe("blank");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

From `packages/core`: `pnpm vitest run src/proposal.test.ts -t "accept-all"`
Expected: FAIL — `classifyProposal` is not exported.

- [ ] **Step 3: Implement the predicates**

Append to `packages/core/src/proposal.ts`:

```ts
/** What a store already holds for a target, in the ONE shape both predicates need. The applier
 *  reads it per store; the predicates never touch a database. */
export type CurrentValue = {
  readonly value: number | string | boolean;
  /** True only when the OWNER supplied it. An agent-written value is false — see `classifyProposal`. */
  readonly statedByUser: boolean;
  /** When the stored figure was TRUE. `null` for a legacy row with no recorded time. */
  readonly statedAt: number | null;
};

/**
 * `blank`     — nothing there, or what is there carries no owner authority. Sweepable.
 * `overwrite` — would replace something the OWNER stated. Needs its own deliberate click.
 * `stale`     — the fact is older than what is stored. Needs its own deliberate click.
 */
export type ProposalGuard = "blank" | "overwrite" | "stale";

export function classifyProposal(fact: ProposedFact, current: CurrentValue | null): ProposalGuard {
  if (current === null) return "blank";
  // Staleness FIRST. An old fact over an owner-stated value is both stale and an overwrite, and
  // "stale" is the more informative thing to tell the user — it names why the newer number wins.
  // An unknown stored time (`null`) is NOT treated as stale: a legacy row with no recorded time
  // would otherwise block every new fact forever, which is the unsafe direction.
  if (current.statedAt !== null && fact.observedAt < current.statedAt) return "stale";
  // Only the OWNER's word is protected from a one-click sweep. Replacing a previous agent figure
  // with a newer one is ordinary progress, not a contradiction.
  if (current.statedByUser) return "overwrite";
  return "blank";
}

/** Accept-all covers blanks ONLY (design §6.1). Both other guards need their own click. */
export const sweepable = (guard: ProposalGuard): boolean => guard === "blank";
```

- [ ] **Step 4: Run tests and typecheck**

From `packages/core`: `pnpm vitest run src/proposal.test.ts` and `pnpm typecheck` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proposal.ts packages/core/src/proposal.test.ts
git commit -m "feat(21-02): accept-all covers blanks only — the two guards that make one click safe"
```

---

### Task 4: The `proposals` table

**Files:**
- Modify: `packages/backend/convex/schema.ts`
- Test: `packages/backend/convex/proposals.test.ts` (create)

**Interfaces:**
- Consumes: the `ProposedFact` shape from Task 2 (mirrored as a Convex validator).
- Produces: a `proposals` table with indexes `by_tenant_status` and `by_tenant_source`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/convex/proposals.test.ts`. Copy the `modules` / component-registration preamble verbatim from the top of `packages/backend/convex/cash.test.ts` — the aggregate and rate-limiter components must be registered or `convexTest` throws.

```ts
test("a proposals row round-trips with its items", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("proposals", {
      tenantId: "u1",
      createdAt: 1_700_000_000_000,
      sourceKind: "vault_doc" as const,
      sourceRef: "doc123",
      status: "pending" as const,
      items: [
        {
          target: { store: "scorecard" as const, field: "cac" },
          value: 340,
          confidence: "high" as const,
          origin: "stated" as const,
          actor: "agent" as const,
          basis: "vaultDoc:doc123",
          observedAt: 1_650_000_000_000,
          sourceLocator: { kind: "vault_doc" as const, vaultDocId: "doc123" },
        },
      ],
    }),
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.items).toHaveLength(1);
  expect(row?.items[0].target.field).toBe("cac");
  expect(row?.status).toBe("pending");
});

test("an empty items array is storable — a source that yielded nothing is a real outcome", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("proposals", {
      tenantId: "u1",
      createdAt: 1_700_000_000_000,
      sourceKind: "chat" as const,
      sourceRef: "thread1",
      status: "discarded" as const,
      items: [],
    }),
  );
  expect((await t.run((ctx) => ctx.db.get(id)))?.items).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run convex/proposals.test.ts`
Expected: FAIL — no `proposals` table in the schema.

- [ ] **Step 3: Add the table**

In `packages/backend/convex/schema.ts`, add alongside the other tables:

```ts
  // One row per SOURCE EVENT (design §3.1) — a document, a chat turn, a voice session — holding the
  // N facts derived from it. Items are EMBEDDED, not a child table: one card is one row, so
  // accept-all is one Convex mutation and all-or-none comes for free, the same property
  // `applyCrmOperations` already relies on. Per-item override is an argument to the accept
  // mutation, not a second table.
  proposals: defineTable({
    tenantId: v.string(),
    createdAt: v.number(),
    sourceKind: v.union(v.literal("vault_doc"), v.literal("chat"), v.literal("voice")),
    /** vaultDocId | threadId | voiceSessionId — an id, never a title (§4). */
    sourceRef: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("discarded"),
      v.literal("superseded"),
    ),
    items: v.array(
      v.object({
        target: v.object({
          store: v.union(
            v.literal("financeInputs"),
            v.literal("scorecard"),
            v.literal("profile"),
            v.literal("contacts"),
            v.literal("followUps"),
          ),
          field: v.string(),
        }),
        value: v.union(v.number(), v.string(), v.boolean()),
        confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
        origin: v.union(v.literal("stated"), v.literal("observed")),
        actor: v.union(v.literal("user"), v.literal("agent")),
        /** Refs/ids/labels ONLY (§4) — code-constructed, never model-supplied. */
        basis: v.string(),
        /** When the fact was TRUE, never the write time. */
        observedAt: v.number(),
        sourceLocator: v.union(
          v.object({ kind: v.literal("vault_doc"), vaultDocId: v.string() }),
          v.object({ kind: v.literal("chat"), threadId: v.string() }),
          v.object({ kind: v.literal("voice"), voiceSessionId: v.string() }),
        ),
      }),
    ),
  })
    .index("by_tenant_status", ["tenantId", "status"])
    // Re-ingesting the same document supersedes its prior pending proposal (§6.3).
    .index("by_tenant_source", ["tenantId", "sourceKind", "sourceRef"]),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run convex/proposals.test.ts` and `pnpm typecheck` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/proposals.test.ts
git commit -m "feat(21-02): one row per source event, N facts inside"
```

---

### Task 5: The applier

The load-bearing task. It reads current values per store, classifies each item, and applies the accepted ones through the store's existing single writer.

**Files:**
- Create: `packages/backend/convex/proposals.ts`
- Modify: `packages/backend/convex/onboarding.ts:460,529` (export `writeProfileDoc` and `currentProfileDoc`)
- Test: `packages/backend/convex/proposals.test.ts`

**Interfaces:**
- Consumes: `PROPOSAL_TARGETS`, `proposalTarget`, `classifyProposal`, `sweepable`, `ProposedFact`, `CurrentValue` (Tasks 2-3); the `proposals` table (Task 4); `applyFinanceClaims` (`cash.ts:463`), `applyCrmOperations` (`contacts.ts:264`), `writeProfileDoc` (`onboarding.ts:460`).
- Produces: `acceptProposal` — a `tenantMutation` taking `{ proposalId: Id<"proposals">; acceptedIndices: number[]; edits?: { index: number; value: number | string | boolean }[] }` and returning `{ ok: true; applied: number; skipped: number } | { ok: false; reason: ProposalRefusal }`; plus `discardProposal` and `listPending`.

**The one-writer table.** The applier calls these and NEVER `ctx.db` for a target store:

| store | writer |
| --- | --- |
| `financeInputs`, `scorecard` | `applyFinanceClaims(ctx, tenantId, claims)` (`cash.ts:463`) |
| `profile` | `writeProfileDoc(ctx, tenantId, mergedProfile, existing)` (`onboarding.ts:460`) |
| `contacts`, `followUps` | `applyCrmOperations(ctx, tenantId, operations)` (`contacts.ts:264`) |

- [ ] **Step 1: Export the profile writer**

`writeProfileDoc` (`onboarding.ts:460`) and `currentProfileDoc` (`onboarding.ts:529`) are module-private. Add `export` to both, and a one-line comment on `writeProfileDoc` naming its second caller:

```ts
/** Exported for `proposals.ts`: the profile store's ONE writer, so a proposal-applied field lands
 *  by the same route as an onboarding edit and inherits `validateProfile` either way. */
```

Do NOT change either function's behaviour or signature.

- [ ] **Step 2: Write the failing tests**

Add to `packages/backend/convex/proposals.test.ts`:

```ts
test("accepting a blank scorecard fact applies it with honest provenance", async () => {
  const t = convexTest(schema, modules);
  const proposalId = await seedProposal(t, "u1", [cacFact]);
  const result = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0],
  });
  expect(result).toMatchObject({ ok: true, applied: 1 });
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
  expect(row?.scorecard.financials.cac).toBe(340);
  expect(row?.fieldProvenance?.["financials.cac"].actor).toBe("agent");
  expect(row?.userProvided).not.toContain("financials.cac");
});

test("actor is STAMPED, never read from the row", async () => {
  const t = convexTest(schema, modules);
  // A stored item claiming the OWNER said it. The applier must overwrite that.
  const proposalId = await seedProposal(t, "u1", [{ ...cacFact, actor: "user" as const }]);
  await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0],
  });
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
  expect(row?.fieldProvenance?.["financials.cac"].actor).toBe("agent");
  expect(row?.userProvided).not.toContain("financials.cac");
});

test("an index outside the items array refuses rather than applying a partial batch", async () => {
  const t = convexTest(schema, modules);
  const proposalId = await seedProposal(t, "u1", [cacFact]);
  const result = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0, 7],
  });
  expect(result).toMatchObject({ ok: false, reason: "unknown_item" });
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, "u1"));
  expect(row).toBeNull();
});

test("a target absent from the registry refuses", async () => {
  const t = convexTest(schema, modules);
  const bad = { ...cacFact, target: { store: "scorecard" as const, field: "notAField" } };
  const proposalId = await seedProposal(t, "u1", [bad]);
  const result = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0],
  });
  expect(result).toMatchObject({ ok: false, reason: "unknown_target" });
});

test("accepting marks the proposal accepted; a second accept is a no-op", async () => {
  const t = convexTest(schema, modules);
  const proposalId = await seedProposal(t, "u1", [cacFact]);
  await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0],
  });
  const second = await asTenant(t, "u1").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0],
  });
  expect(second).toMatchObject({ ok: false, reason: "not_pending" });
});

test("another tenant cannot accept this tenant's proposal", async () => {
  const t = convexTest(schema, modules);
  const proposalId = await seedProposal(t, "u1", [cacFact]);
  const result = await asTenant(t, "u2").mutation(api.proposals.acceptProposal, {
    proposalId,
    acceptedIndices: [0],
  });
  expect(result).toMatchObject({ ok: false, reason: "not_found" });
});
```

Write the `seedProposal` helper and the `cacFact` literal at the top of the file. `asTenant` is the identity helper — copy its definition from `cash.test.ts:38`.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run convex/proposals.test.ts`
Expected: FAIL — `api.proposals.acceptProposal` does not exist.

- [ ] **Step 4: Write the applier**

Create `packages/backend/convex/proposals.ts`. Structure it as TWO PASSES, matching `applyFinanceClaims`'s discipline (`cash.ts:479`): validate every accepted item with zero writes, then write. A `return` does not roll back a Convex transaction — only a throw does — so a refusal discovered mid-write would leave the batch half-applied.

The skeleton — fill the marked bodies, keep the two-pass shape:

```ts
export type ProposalRefusal =
  | "not_found"
  | "not_pending"
  | "unknown_item"
  | "unknown_target"
  | "writer_refused";

type AcceptResult =
  | { ok: true; applied: number; skipped: number }
  | { ok: false; reason: ProposalRefusal };

export const acceptProposal = tenantMutation({
  args: {
    proposalId: v.id("proposals"),
    acceptedIndices: v.array(v.number()),
    edits: v.optional(
      v.array(v.object({ index: v.number(), value: v.union(v.number(), v.string(), v.boolean()) })),
    ),
  },
  handler: async (ctx, { proposalId, acceptedIndices, edits }): Promise<AcceptResult> => {
    const row = await ctx.db.get(proposalId);
    // Tenant check and existence check give the SAME answer: a foreign id must not be
    // distinguishable from a missing one, or the refusal itself leaks that the row exists.
    if (!row || row.tenantId !== ctx.tenantId) return { ok: false, reason: "not_found" };
    if (row.status !== "pending") return { ok: false, reason: "not_pending" };

    // ── PASS 1: validate everything, write nothing. ──────────────────────────────────────────
    const seen = new Set<number>();
    for (const i of acceptedIndices) {
      if (!Number.isInteger(i) || i < 0 || i >= row.items.length || seen.has(i)) {
        return { ok: false, reason: "unknown_item" };
      }
      seen.add(i);
    }
    const editByIndex = new Map((edits ?? []).map((e) => [e.index, e.value]));
    for (const [i] of editByIndex) if (!seen.has(i)) return { ok: false, reason: "unknown_item" };

    const chosen = acceptedIndices.map((i) => ({
      ...row.items[i],
      value: editByIndex.get(i) ?? row.items[i].value,
      // §3.2: `actor` is a fact about which DOOR the write came through, not data to be read off
      // a content-plane row. The applier IS the agent door, so it is STAMPED. A stored item
      // claiming `actor: "user"` is a staging bug or a lie; either way it is overwritten.
      actor: "agent" as const,
    }));
    for (const fact of chosen) {
      if (proposalTarget(fact.target.store, fact.target.field) === null) {
        return { ok: false, reason: "unknown_target" };
      }
      // ponytail: contacts are refused wholesale until plan 3 builds the batch attestation the
      // bulk importer already requires (spec §4.2). Upgrade path: accept an `attestation` arg here
      // and pass it to `applyCrmOperations`. Refusing is the safe direction — harvested addresses
      // must never reach a send path without consent.
      if (fact.target.store === "contacts" || fact.target.store === "followUps") {
        return { ok: false, reason: "writer_refused" };
      }
    }

    // ── PASS 2: every item cleared; now read current state, classify, and write. ─────────────
    let applied = 0;
    let skipped = 0;

    const financeFacts = chosen.filter(
      (f) => f.target.store === "financeInputs" || f.target.store === "scorecard",
    );
    if (financeFacts.length > 0) {
      // BODY: for each, read its CurrentValue (see the table below), call `classifyProposal`, and
      // drop the ones you decide not to write into `skipped`. Convert the rest to `FigureClaim`
      // and hand the whole list to `applyFinanceClaims(ctx, ctx.tenantId, claims)` in ONE call —
      // it is all-or-nothing across the batch and re-validates every claim itself.
      // If it returns `{ok:false}`, return `{ok:false, reason:"writer_refused"}`.
    }

    const profileFacts = chosen.filter((f) => f.target.store === "profile");
    if (profileFacts.length > 0) {
      // BODY: `currentProfileDoc(ctx, ctx.tenantId)` for the existing doc, merge ONLY the proposed
      // fields over the parsed profile, then `writeProfileDoc(ctx, ctx.tenantId, merged, existing)`.
      // An absent field stays absent — never write `""` for one nobody proposed.
    }

    await ctx.db.patch(proposalId, { status: "accepted" });
    return { ok: true, applied, skipped };
  },
});
```

**How to read `CurrentValue` per store** — the predicates in Task 3 need this shape and cannot fetch it themselves:

| store | value | `statedByUser` | `statedAt` |
| --- | --- | --- | --- |
| `scorecard` | `getPath(latestScorecardRow(...).scorecard, spec.path)` | `fieldProvenance?.[path]?.actor === "user"`, else `userProvided.includes(path)` for legacy rows | `fieldProvenance?.[path]?.at ?? userProvidedAt?.[path] ?? null` |
| `financeInputs` | the `financeInputs` row's `value` for that field | its `actor === "user"` | its `observedAt` |
| `profile` | the parsed profile's field | always `true` — every profile field today is owner-entered | `null` (the profile carries no per-field time) |

`profile` being always `statedByUser: true` is deliberate and load-bearing: it means a proposal that would overwrite an existing profile field is ALWAYS a contradiction needing its own click, and only a genuinely blank field can be swept. That is the conservative reading of §6.1 for a store with no provenance of its own.

Required behaviour, each of which a test above pins:
- Load the row by id; refuse `not_found` if absent OR if `row.tenantId !== ctx.tenantId`. Never leak existence across tenants.
- Refuse `not_pending` unless `status === "pending"`.
- Refuse `unknown_item` if any accepted index is out of range or duplicated.
- Refuse `unknown_target` if `proposalTarget(store, field)` is null for any accepted item.
- Apply edits from the `edits` argument over the stored value before classification.
- Classify each accepted item with `classifyProposal`. An item whose guard is not `blank` is applied ONLY if it was explicitly named in `acceptedIndices` — which it always is here, since `acceptedIndices` IS the explicit click. Record the guard in the returned counts so the caller can tell a sweep from a deliberate overwrite.
- **Stamp `actor: "agent"`** on every fact before constructing a writer payload. Never trust the stored value.
- Group by store, build each writer's payload, call the writers.
- Patch the row to `status: "accepted"` last.

Define the refusal union beside the handler:

```ts
export type ProposalRefusal =
  | "not_found"
  | "not_pending"
  | "unknown_item"
  | "unknown_target"
  | "writer_refused";
```

For the `profile` store, read the current profile with `currentProfileDoc`, merge ONLY the proposed fields, and pass the merged object to `writeProfileDoc`. Do not construct a profile from scratch — an absent field must stay absent, not become `""`.

For `contacts`/`followUps`, build a `CrmOperation[]` matching `packages/core/src/contacts.ts:120` and hand it to `applyCrmOperations`. Per spec §4.2, contact items require the batch attestation; this plan does NOT implement the attestation UI — refuse contact items with `writer_refused` and a `ponytail:` comment naming plan 3 as the upgrade path, so the store is never written without consent.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm vitest run convex/proposals.test.ts convex/cash.test.ts convex/evaluations.test.ts convex/onboarding.test.ts` and `pnpm typecheck` — expect PASS. Every pre-existing test must pass unchanged; if one fails, the export in Step 1 changed behaviour it should not have.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/proposals.ts packages/backend/convex/proposals.test.ts packages/backend/convex/onboarding.ts
git commit -m "feat(21-02): the applier calls the writers that already exist, and stamps the actor itself"
```

---

### Task 6: Documentation (CLAUDE.md §9)

**Files:**
- Create: `docs/playbooks/proposals.md` (from `docs/playbooks/TEMPLATE.md`)
- Modify: `docs/playbooks/watch.json`
- Modify: `docs/playbooks/dashboard-pages.md`, `docs/playbooks/business-evaluation.md`, `docs/playbooks/onboarding.md`, `docs/playbooks/contacts-crm.md` (whichever your changes actually touched — check `watch.json` and bump only those)

- [ ] **Step 1: Write the playbook**

Cover: the one-row-per-source-event shape and why items are embedded; the closed registry and its three consumers; the one-writer table from Task 5 and why the applier never touches `db`; the two guards and the rule that accept-all covers blanks only; that `actor` is stamped and never trusted; that contact items are refused pending the attestation.

- [ ] **Step 2: Register the watched paths**

Add to `docs/playbooks/watch.json` under a new `proposals.md` entry:

```json
["packages/core/src/proposal.ts", "packages/core/src/proposal.test.ts", "packages/backend/convex/proposals.ts", "packages/backend/convex/proposals.test.ts"]
```

- [ ] **Step 3: Run the hook and the full suite**

Run `node scripts/check-playbooks.mjs` — resolve any path it names that is YOURS. Paths belonging to other lanes' uncommitted files are not yours to attest; say which in your report and leave them.
Then from `packages/backend`: `pnpm typecheck && pnpm vitest run`. Paste the real output. Bump `Last verified` only on playbooks you actually verified, and only if green.

- [ ] **Step 4: Commit**

```bash
git add docs/playbooks
git commit -m "docs(21-02): the proposals spine — what it is, and the writers it is forbidden to bypass"
```

---

## Verification

```bash
cd packages/core && pnpm typecheck && pnpm vitest run
cd ../backend && pnpm typecheck && pnpm vitest run
```

Both must pass. Paste the actual output; do not claim completion from a partial run.

**The assertion that proves this plan worked** is Task 5's "actor is STAMPED, never read from the row": a stored item claiming `actor: "user"` must still land as `actor: "agent"` and stay out of `userProvided`. If that test is absent or weakened, nothing here demonstrates the applier is honest.

## Known gaps this plan deliberately leaves

- **Contact items refuse.** The applier will not write `contacts`/`followUps` until plan 3 builds the batch attestation the bulk importer already requires (spec §4.2). Refusing is the safe direction: harvested addresses must not enter a send path without consent.
- **Nothing creates a proposal yet.** The ingest trigger and the derive pass are plan 3. This plan is storage and application only; proposals are seeded by tests.
- **No UI.** The Approvals surface is plan 3.
- **Supersession is indexed but not triggered.** Spec §6.3 says re-ingesting a document marks its
  prior pending proposal `superseded`. The `by_tenant_source` index and the `superseded` status
  exist here so plan 3's trigger can do it in one query, but nothing in this plan re-ingests
  anything, so there is no code path to fire it and no test to write for it yet.
