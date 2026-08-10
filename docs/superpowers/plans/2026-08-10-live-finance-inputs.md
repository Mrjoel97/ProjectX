# Live Finance Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cockpit agent sight of the tenant's financial figures and one governed path to update them from conversation, with every figure carrying honest provenance.

**Architecture:** A pure `FigureClaim` type in `@pikar/core` is the single shape every source produces. `finance_write` joins `ACTION_TYPES` as an `inline` arm, so an agent-proposed figure change stages as a plan and is applied by `executePlan` only — while the human's own edit stays ungated. Both actors route through one `writeFigureRow` function. The agent reads figures through a char-budgeted spine line plus a `readFinance` tool, and never computes a ratio itself.

**Tech Stack:** TypeScript, Convex (thin adapter over pure packages), Vitest, Vercel AI SDK `tool()` / `jsonSchema()`, Biome.

**Spec:** `docs/superpowers/specs/2026-08-10-live-finance-inputs-design.md`

**Scope:** Ship-order steps 1–4 of the spec. Steps 5–6 (the `docType`-gated vault source, finance-tile display) are Plan 2.

**Carried into Plan 2 from Task 1's review:** `isNewerThan(claim, storedObservedAt)` treats "nothing stored" as `=== null` only, deliberately — so a stored `0` behaves correctly rather than being swallowed by a falsy check. A Convex `v.optional` column reads back as `undefined`, and `undefined === null` is false, so **the vault source must pass `doc.observedAt ?? null`**. Getting this wrong blocks the *first* write to a field — the exact inverse of the rule.

**Deferred to Plan 2, deliberately:** the spec's *"a rejected claim is not re-proposed"* rule and the *fail-open on grounding* rule. Both only bind once the vault source exists — with conversation as the only source, a claim recurs only if the owner says the same thing again, which is not a loop worth building state for. Do not implement them here; do not silently drop them either.

## Global Constraints

- **CLAUDE.md §1** — domain logic lives in `packages/*`; `packages/backend/convex/` is a thin adapter. Every pure rule in this plan goes in `@pikar/core`.
- **CLAUDE.md §2** — never import `query`/`mutation`/`action` from `./_generated/server` in feature files. Use `tenantQuery` / `tenantMutation` from `convex/lib/functions.ts`.
- **CLAUDE.md §4** — audit payloads carry refs, hashes, ids and counts ONLY. Never a monetary value.
- **CLAUDE.md §5** — no hardcoded agent prompts. Tool `description` string literals are split so each chunk stays under the 200-character scan ceiling.
- **CLAUDE.md §8** — reuse before writing. Every rule below has exactly one definition.
- **CLAUDE.md §9** — playbooks are definition-of-done: `dashboard-pages.md`, `cockpit.md`, `business-evaluation.md`, `skill-registry.md`. A Stop hook blocks the turn if a watched path changed and its playbook did not.
- **`tenantId` is never model-supplied.** Injected by the wrapper at public call sites; read off the approved plan row at the applier.
- **Test runner:** run a single file with `npx vitest run <path>` from inside the package directory. Do **not** use `pnpm --filter <pkg> test -- <file>` — the `--` is swallowed and the whole suite runs.
- **Full suite:** `pnpm exec turbo run test --concurrency=1` from the repo root. The default parallel `pnpm test` exhausts this machine (`spawn UNKNOWN`, exit 134) and those are not real failures.
- **Lint:** `pnpm lint` is red repo-wide (64 errors on this branch). Lint only what you touched: `pnpm exec biome ci <paths>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/financeClaim.ts` | **Create.** `FigureClaim`, `validateFigureClaim`, `isNewerThan`. Pure, Convex-free. |
| `packages/core/src/financeClaim.test.ts` | **Create.** Tests for the above. |
| `packages/core/src/cash.ts` | **Modify.** `CashInputState` gains provenance; `statedFigure` reads stored origin. |
| `packages/core/src/cashSpine.ts` | **Create.** The spine finance line + its char budget. |
| `packages/core/src/cashSpine.test.ts` | **Create.** Worst-case budget proof. |
| `packages/core/src/actionType.ts` | **Modify.** `finance_write` in `ACTION_TYPES` and `ARMS`. |
| `packages/backend/convex/schema.ts` | **Modify.** `financeInputs` provenance columns; `plans.financeClaims`. |
| `packages/backend/convex/cash.ts` | **Modify.** `writeFigureRow`, `saveInput` delegation, `applyFinanceClaims`, origin at the read boundary. |
| `packages/backend/convex/cockpit.ts` | **Modify.** The `finance_write` inline arm. |
| `packages/backend/convex/approvals.ts` | **Modify.** `planKind` returns `finance_write`. |
| `packages/backend/convex/llm.ts` | **Modify.** `readFinance` and `stageFinanceWrite` tools. |
| `apps/web/app/(app)/dashboard/approvals/ApprovalsView.tsx` | **Modify.** The sixth badge / title / action-label. |
| `packages/contracts/skills/cockpit-agent.md` | **Modify.** Staleness rule + the arithmetic boundary. |
| `packages/backend/scripts/eval-cases/37-finance-update.json` | **Create.** The owed fixture. |

---

### Task 1: The `FigureClaim` type and its validation

**Files:**
- Create: `packages/core/src/financeClaim.ts`
- Test: `packages/core/src/financeClaim.test.ts`
- Modify: `packages/core/src/index.ts` (add the export)

**Interfaces:**
- Consumes: `CashInputField`, `validateCashInput`, `cashInputSpec` from `./cash`.
- Produces: `FigureClaim`, `FigureOrigin`, `FigureActor`, `FigureConfidence`, `validateFigureClaim(claim)`, `isNewerThan(claim, storedObservedAt)`. Tasks 3, 4 and 8 depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/financeClaim.test.ts`:

```ts
import { expect, test } from "vitest";
import { type FigureClaim, isNewerThan, validateFigureClaim } from "./financeClaim";

const claim = (over: Partial<FigureClaim> = {}): FigureClaim => ({
  field: "cac",
  value: 1400,
  origin: "stated",
  actor: "agent",
  basis: "user statement, turn 4",
  observedAt: 1_754_000_000_000,
  confidence: "high",
  ...over,
});

test("a well-formed claim passes", () => {
  expect(validateFigureClaim(claim())).toEqual({ ok: true });
});

test("the underlying cash validation still governs the value", () => {
  const bad = validateFigureClaim(claim({ value: -5 }));
  expect(bad.ok).toBe(false);
});

test("a non-finite value is refused before it can reach a store", () => {
  expect(validateFigureClaim(claim({ value: Number.NaN })).ok).toBe(false);
});

test("an empty basis is refused — an unattributable figure is not a claim", () => {
  const r = validateFigureClaim(claim({ basis: "   " }));
  expect(r).toEqual({ ok: false, reason: "A claim must carry a basis." });
});

test("a user claim is always high confidence — confidence grades extraction, not truth", () => {
  const r = validateFigureClaim(claim({ actor: "user", confidence: "low" }));
  expect(r).toEqual({ ok: false, reason: "A user-entered figure is always high confidence." });
});

test("observedAt in the future is refused — a figure cannot be true before it exists", () => {
  const r = validateFigureClaim(claim({ observedAt: 4_000_000_000_000 }), 1_754_000_000_000);
  expect(r).toEqual({ ok: false, reason: "A figure cannot be observed in the future." });
});

test("isNewerThan is true when nothing is stored", () => {
  expect(isNewerThan(claim(), null)).toBe(true);
});

test("isNewerThan refuses a claim no newer than what is stored", () => {
  expect(isNewerThan(claim({ observedAt: 100 }), 100)).toBe(false);
  expect(isNewerThan(claim({ observedAt: 99 }), 100)).toBe(false);
  expect(isNewerThan(claim({ observedAt: 101 }), 100)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/financeClaim.test.ts`
Expected: FAIL — `Failed to resolve import "./financeClaim"`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/financeClaim.ts`:

```ts
// The ONE shape every finance source produces — conversation now, vault documents and connectors
// later. Pure and Convex-free (CLAUDE.md §1): the write boundary in `convex/cash.ts` and the
// staging tool in `convex/llm.ts` both validate through this module, so a claim can never reach a
// store by a route that skipped a rule.
import { type CashInputField, validateCashInput } from "./cash";

/** The display vocabulary from the cash spec. `observed` means PIKAR measured it — reserved for
 *  the measured-figures slice; every claim this phase stores is `stated`. */
export type FigureOrigin = "stated" | "observed";

/** What invariant 11 gates on. A figure the agent heard the owner say is `stated` by a human and
 *  written by an agent — origin and actor are independent. */
export type FigureActor = "user" | "agent";

/** Reuses `evaluations.ts`'s Provenance vocabulary rather than inventing a second scale. */
export type FigureConfidence = "high" | "medium" | "low";

export type FigureClaim = {
  field: CashInputField;
  value: number;
  origin: FigureOrigin;
  actor: FigureActor;
  /** Refs / ids / labels ONLY — never quoted content. This string reaches the audit log and the
   *  approval card, and CLAUDE.md §4 forbids raw user content in either. */
  basis: string;
  /** When the figure was TRUE, not when the row was written. A P&L dated six weeks ago describes a
   *  figure already six weeks into its 90-day staleness clock; stamping `Date.now()` would reset a
   *  clock that must not reset. */
  observedAt: number;
  confidence: FigureConfidence;
};

export function validateFigureClaim(
  claim: FigureClaim,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  // The value rule has ONE definition, in `cash.ts`. Re-deriving bounds here would be a second
  // chance to disagree about what a legal figure is (CLAUDE.md §8 rung 2).
  const value = validateCashInput(claim.field, claim.value);
  if (!value.ok) return value;
  if (claim.basis.trim() === "") return { ok: false, reason: "A claim must carry a basis." };
  if (claim.actor === "user" && claim.confidence !== "high") {
    return { ok: false, reason: "A user-entered figure is always high confidence." };
  }
  if (claim.observedAt > nowMs) {
    return { ok: false, reason: "A figure cannot be observed in the future." };
  }
  return { ok: true };
}

/** Propose only if the claim is strictly newer than what is stored. One comparison replaces a
 *  merge policy: a figure typed three days ago is not challenged by a document from July.
 *  `null` means nothing is stored, so anything is newer. */
export const isNewerThan = (claim: FigureClaim, storedObservedAt: number | null): boolean =>
  storedObservedAt === null || claim.observedAt > storedObservedAt;
```

- [ ] **Step 4: Export it from the package index**

In `packages/core/src/index.ts`, add alongside the existing `cash` exports:

```ts
export * from "./financeClaim";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run src/financeClaim.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/financeClaim.ts packages/core/src/financeClaim.test.ts packages/core/src/index.ts
git commit -m "feat(finance): the FigureClaim shape every source produces"
```

---

### Task 2: Provenance on `CashInputState`, and origin returned rather than inferred

This is the leak fix. Vault-grounded figures currently render as though the owner stated them, because origin is deduced from membership of the evaluation row's `userProvided` list rather than stored.

**Files:**
- Modify: `packages/core/src/cash.ts:274-279` (`CashInputState`), and `statedFigure` at `:316`
- Test: `packages/core/src/cash.test.ts` (append)

**Interfaces:**
- Consumes: `FigureOrigin`, `FigureActor` from Task 1.
- Produces: `CashInputState` gains `origin: FigureOrigin`, `actor: FigureActor`, `basis: string | null`. Task 3 populates them; Task 6 reads them.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/cash.test.ts`:

```ts
test("statedFigure carries the stored origin rather than assuming 'stated'", () => {
  const spec = cashInputSpec("cashOnHand");
  const figure = statedFigure(
    {
      field: "cashOnHand",
      value: 38_500,
      statedAt: 1_754_000_000_000,
      stale: false,
      origin: "observed",
      actor: "agent",
      basis: "vault:doc_7c2a#p3",
    },
    spec,
    1_754_000_100_000,
  );
  expect(figure.state).toBe("known");
  if (figure.state === "known") expect(figure.origin).toBe("observed");
});

test("an absent input is unknown regardless of provenance", () => {
  const spec = cashInputSpec("cashOnHand");
  const figure = statedFigure(undefined, spec, 1_754_000_000_000);
  expect(figure.state).toBe("unknown");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/cash.test.ts -t "stored origin"`
Expected: FAIL — object literal may only specify known properties (`origin` does not exist on `CashInputState`).

- [ ] **Step 3: Widen the type**

In `packages/core/src/cash.ts`, replace the `CashInputState` definition at line 274:

```ts
export type CashInputState = {
  field: CashInputField;
  value: number | null;
  statedAt: number | null;
  stale: boolean;
  /** Stored provenance, NOT inferred. The prior version deduced origin from membership of the
   *  evaluation row's `userProvided` list, so a vault-grounded fill rendered identically to a
   *  figure the owner typed. Absent provenance (every pre-existing row) reads as a user statement,
   *  which is what those rows are. */
  origin: FigureOrigin;
  actor: FigureActor;
  basis: string | null;
};
```

Add to the imports at the top of `cash.ts`:

```ts
import type { FigureActor, FigureOrigin } from "./financeClaim";
```

- [ ] **Step 4: Make `statedFigure` read the stored origin**

In `packages/core/src/cash.ts`, in `statedFigure`, replace the hardcoded `"stated"`:

```ts
  return knownFigure(input.origin, input.value, spec.unit, {
    ...(input.statedAt === null ? {} : { statedAt: input.statedAt }),
    stale: needsConfirmation(input.value, input.statedAt, nowMs),
  });
```

- [ ] **Step 5: Fix the compile errors the widened type produces**

`tsc` will now flag every `CashInputState` literal in `cash.test.ts` and its helpers. Give each the honest default — these are user-typed fixtures:

```ts
origin: "stated", actor: "user", basis: null,
```

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the tests**

Run: `cd packages/core && npx vitest run src/cash.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/cash.ts packages/core/src/cash.test.ts
git commit -m "fix(finance): origin is stored and returned, never inferred from userProvided"
```

---

### Task 3: Provenance columns, `writeFigureRow`, and `saveInput` as a delegation

**Files:**
- Modify: `packages/backend/convex/schema.ts:1518-1530` (`financeInputs`)
- Modify: `packages/backend/convex/cash.ts` (`inputStatesFor` at `:107`, `saveInput` at `:243`)
- Test: `packages/backend/convex/cash.test.ts` (append)

**Interfaces:**
- Consumes: `FigureClaim`, `validateFigureClaim` from Task 1; the widened `CashInputState` from Task 2.
- Produces: `writeFigureRow(db, tenantId, claim)` — a plain async function over an explicit `tenantId`. Task 4's applier calls it.

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/convex/cash.test.ts`:

```ts
test("an agent-written figure reads back with agent provenance, not as a user statement", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1|s1" });

  await t.run(async (ctx) => {
    await writeFigureRow(ctx.db, "u1", {
      field: "cashOnHand",
      value: 38_500,
      origin: "stated",
      actor: "agent",
      basis: "user statement, turn 4",
      observedAt: 1_754_000_000_000,
      confidence: "high",
    });
  });

  const { inputs } = await asUser.query(api.cash.inputs, {});
  const cash = inputs.find((i) => i.field === "cashOnHand");
  expect(cash?.value).toBe(38_500);
  expect(cash?.actor).toBe("agent");
  expect(cash?.basis).toBe("user statement, turn 4");
  expect(cash?.statedAt).toBe(1_754_000_000_000);
});

test("saveInput stamps the human as the actor and observedAt as now", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1|s1" });
  await asUser.mutation(api.cash.saveInput, { field: "cashOnHand", value: 1_000 });

  const { inputs } = await asUser.query(api.cash.inputs, {});
  const cash = inputs.find((i) => i.field === "cashOnHand");
  expect(cash?.actor).toBe("user");
  expect(cash?.origin).toBe("stated");
});
```

Add to that file's imports: `import { writeFigureRow } from "./cash";`

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/backend && npx vitest run convex/cash.test.ts -t "agent provenance"`
Expected: FAIL — `writeFigureRow` is not exported.

- [ ] **Step 3: Add the schema columns**

In `packages/backend/convex/schema.ts`, inside `financeInputs`, after `statedAt`:

```ts
    // Provenance, added 2026-08-10. All optional: existing rows carry none, and a row without
    // provenance IS a user statement — which is exactly what every pre-existing row is. No
    // backfill, no migration.
    origin: v.optional(v.union(v.literal("stated"), v.literal("observed"))),
    actor: v.optional(v.union(v.literal("user"), v.literal("agent"))),
    basis: v.optional(v.string()),
```

`statedAt` keeps its name and now means `observedAt` — when the figure was true. Add that to its comment rather than renaming the column, which would need a migration for no behavioural gain.

- [ ] **Step 4: Write `writeFigureRow` and make `saveInput` delegate**

In `packages/backend/convex/cash.ts`, replace the body of `saveInput` and add the shared writer above it:

```ts
/**
 * THE writer. Both actors route through this one function (contacts-crm invariant 13): the
 * ungated human edit below, and `applyFinanceClaims` behind the Approve gate. Two copies of the
 * store-routing rule would be two chances to disagree about where a figure lives.
 *
 * A plain async function over an EXPLICIT tenantId — never `ctx.tenantId` — so the applier can
 * pass the tenant read off the approved plan row.
 */
export async function writeFigureRow(
  db: MutationCtx["db"],
  tenantId: string,
  claim: FigureClaim,
): Promise<void> {
  const check = validateFigureClaim(claim);
  if (!check.ok) throw new Error(`INVALID_INPUT: ${check.reason}`);
  const spec = cashInputSpec(claim.field);

  if (spec.store === "scorecard") {
    if (spec.path === undefined) throw new Error("INVALID_INPUT: no scorecard path");
    const existing = await latestScorecardRow(db, tenantId);
    await applyScorecardAnswer(
      db,
      tenantId,
      existing?.threadId ?? "finance-panel",
      spec.path,
      claim.value,
    );
    return;
  }

  const row = await db
    .query("financeInputs")
    .withIndex("by_tenant_field", (q) =>
      q.eq("tenantId", tenantId).eq("field", claim.field as "cashOnHand"),
    )
    .unique();
  const write = {
    valueUsd: claim.value,
    statedAt: claim.observedAt,
    origin: claim.origin,
    actor: claim.actor,
    basis: claim.basis,
  };
  if (row) await db.patch(row._id, write);
  else
    await db.insert("financeInputs", {
      tenantId,
      field: claim.field as "cashOnHand",
      ...write,
    });
}

export const saveInput = tenantMutation({
  args: { field: vCashField, value: v.number() },
  handler: async (ctx, { field, value }): Promise<{ saved: true }> => {
    // The human editing their own number is UNGATED — invariant 11: the ACTOR decides gating, not
    // the operation. Same writer, no plan, no approval.
    await writeFigureRow(ctx.db, ctx.tenantId, {
      field,
      value,
      origin: "stated",
      actor: "user",
      basis: "finance panel",
      observedAt: Date.now(),
      confidence: "high",
    });
    return { saved: true };
  },
});
```

Add the imports `FigureClaim`, `validateFigureClaim` from `@pikar/core` and `MutationCtx` from `./_generated/server`.

- [ ] **Step 5: Populate provenance at the read boundary**

In `inputStatesFor`, the `financeInputs` branch returns:

```ts
        return {
          field: spec.field,
          value,
          statedAt,
          stale: needsConfirmation(value, statedAt, nowMs),
          origin: row?.origin ?? "stated",
          actor: row?.actor ?? "user",
          basis: row?.basis ?? null,
        };
```

And the scorecard branch — where the leak lives. A scorecard field is user-provided only if it appears in `userProvided`; anything else got there by grounding:

```ts
      const userStated = (evaluation?.userProvided ?? []).includes(spec.path as string);
      return {
        field: spec.field,
        value,
        statedAt,
        stale: needsConfirmation(value, statedAt, nowMs),
        // The leak fix: a grounded fill is NOT a user statement. It reads as `observed` with no
        // actor claim rather than borrowing the owner's authority.
        origin: userStated ? "stated" : "observed",
        actor: userStated ? "user" : "agent",
        basis: userStated ? null : "business evaluation grounding",
      };
```

- [ ] **Step 6: Close the renderer gap this task opens**

**This step is not optional and must land in the same commit as step 5.** Step 5 is the first code that ever produces `origin: "observed"`, and `CashView.tsx:159-169` currently gates the whole staleness affordance on `origin === "stated"`:

```tsx
{figure.origin === "stated" ? (
  <p …>{…`You told us this on ${shortDay(figure.statedAt)}.`}{figure.stale ? " Is this still right?" : ""}</p>
) : null}
{figure.origin === "observed" ? (
  <p …>Measured by Pikar.</p>
) : null}
```

So a machine-extracted figure that is 200 days old renders as a bare "Measured by Pikar." — no date, no confirm prompt. `needsConfirmation` computes `stale: true`, attaches it to the figure, and the renderer drops it on the floor **for exactly the figures that deserve the most scrutiny**. Before this plan, that could not happen, because every `statedFigure` result was `"stated"`. Give the observed branch the same two affordances:

```tsx
{figure.origin === "observed" ? (
  <p style={{ ...muted, fontSize: "0.8rem" }}>
    {figure.statedAt === undefined
      ? "Measured by Pikar."
      : `Measured by Pikar on ${shortDay(figure.statedAt)}.`}
    {figure.stale ? " Is this still right?" : ""}
  </p>
) : null}
```

Pin it in `cashView.test.ts`: a stale `observed` figure must render the confirm prompt. Without that test nothing in either package fails when this regresses.

- [ ] **Step 7: Run the tests**

Run: `cd packages/backend && npx vitest run convex/cash.test.ts`, then `cd apps/web && npx vitest run "app/(app)/dashboard/finance/cashView.test.ts"`
Expected: PASS both.

Then confirm the branch-wide typecheck is green again: `cd packages/backend && npx tsc --noEmit -p .`. It has been **red since Task 2** — `convex/cash.ts:132` and `:150` build `CashInputState` literals without `origin`/`actor`/`basis`. Those two literals are this task's to fill; the errors disappearing is how you know step 5 is complete.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/cash.ts packages/backend/convex/cash.test.ts "apps/web/app/(app)/dashboard/finance/CashView.tsx" "apps/web/app/(app)/dashboard/finance/cashView.test.ts"
git commit -m "feat(finance): one writeFigureRow for both actors, and provenance on every figure"
```

---

### Task 4: `finance_write` as the sixth action type

**Files:**
- Modify: `packages/core/src/actionType.ts:8` (`ACTION_TYPES`), `:14` (`actionTypeOf`), the `ARMS` table
- Modify: `packages/backend/convex/schema.ts` (`plans.kind`, `plans.financeClaims`)
- Modify: `packages/backend/convex/cockpit.ts:562-580` (dispatcher arm bind), `:697-720` (dispatch)
- Modify: `packages/backend/convex/cash.ts` (`applyFinanceClaims`)
- Test: `packages/core/src/actionType.test.ts`, `packages/backend/convex/cash.test.ts`

**Interfaces:**
- Consumes: `writeFigureRow` from Task 3.
- Produces: `applyFinanceClaims(ctx, tenantId, claims)`. Task 8 stages the rows it consumes.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/actionType.test.ts`:

```ts
test("finance_write is an inline arm — one transactional write on our own tables", () => {
  expect(armFor("finance_write")).toBe("inline");
});

test("actionTypeOf maps the finance_write kind", () => {
  expect(actionTypeOf("finance_write")).toBe("finance_write");
});
```

Append to `packages/backend/convex/cash.test.ts`:

```ts
test("a staged finance plan writes NOTHING until it is approved", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1|s1" });

  const planId = await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: "u1",
      kind: "finance_write",
      status: "awaiting_approval",
      // NOTE: the happy path uses `cashOnHand`, a financeInputs field. It must NOT use `cac` —
      // `cac` is scorecard-stored, and this task's own applier refuses scorecard fields. An
      // earlier draft of this plan specified both, which is self-contradictory. `cac` belongs in
      // the refusal test, and only there.
      financeClaims: [
        {
          field: "cashOnHand",
          value: 38_500,
          origin: "stated",
          actor: "agent",
          basis: "14000 / 10, turn 4",
          observedAt: 1_754_000_000_000,
          confidence: "high",
        },
      ],
    } as never),
  );

  const before = await asUser.query(api.cash.inputs, {});
  expect(before.inputs.find((i) => i.field === "cashOnHand")?.value).toBeNull();

  await t.run((ctx) => applyFinanceClaims(ctx, "u1", [
    {
      field: "cashOnHand",
      value: 38_500,
      origin: "stated",
      actor: "agent",
      basis: "14000 / 10, turn 4",
      observedAt: 1_754_000_000_000,
      confidence: "high",
    },
  ]));

  const after = await asUser.query(api.cash.inputs, {});
  expect(after.inputs.find((i) => i.field === "cashOnHand")?.value).toBe(38_500);
  expect(planId).toBeDefined();
});

test("the audit row carries names and counts, and NEVER a figure (§4)", async () => {
  const t = convexTest(schema, modules);
  const claim = {
    field: "cashOnHand" as const,
    value: 38_500,
    origin: "stated" as const,
    actor: "agent" as const,
    basis: "14000 / 10, turn 4",
    observedAt: 1_754_000_000_000,
    confidence: "high" as const,
  };
  await t.run((ctx) => applyFinanceClaims(ctx, "u1", [claim]));

  const rows = await t.run((ctx) => ctx.db.query("audit").collect());
  const row = rows.find((r) => r.event === "finance.claims_applied");
  expect(row).toBeDefined();
  expect(Object.keys(row!.payload as object).sort()).toEqual([
    "actors",
    "confidences",
    "count",
    "fields",
  ]);
  // The negative assertion is the point: the figure must not be reachable anywhere in the payload.
  expect(JSON.stringify(row!.payload)).not.toContain("38500");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && npx vitest run src/actionType.test.ts`
Expected: FAIL — `"finance_write"` is not assignable to `ActionType`.

- [ ] **Step 3: Widen the closed union and decide its arm**

In `packages/core/src/actionType.ts`:

```ts
export const ACTION_TYPES = [
  "email",
  "memo",
  "calendar_event",
  "media",
  "crm_write",
  "finance_write",
] as const;
```

```ts
export const actionTypeOf = (
  kind: "memo" | "calendar_event" | "media" | "crm_write" | "finance_write" | undefined,
): ActionType => kind ?? "email";
```

And in `ARMS`:

```ts
  // 2026-08-10: the `inline` arm's THIRD occupant. A figure update is one transactional write on
  // our own `financeInputs` / `evaluations` tables — no fetch, nothing for the retrier to retry.
  finance_write: "inline",
```

- [ ] **Step 4: Follow the compile errors**

`tsc` now fails at the dispatcher's own arm bind in `cockpit.ts` and at Approvals' `Record<PlanKind, string>`. That is the guarantee working. In `packages/backend/convex/cockpit.ts`, add to the dispatcher bind beside `crm_write: "inline"`:

```ts
  finance_write: "inline",
```

- [ ] **Step 5: Add the plan-row shape**

In `packages/backend/convex/schema.ts`, widen `plans.kind` with `v.literal("finance_write")` and add beside `crmOperations`:

```ts
    // Staged figure claims, inert until Approve. Content plane — the applier re-validates every
    // claim rather than trusting the row, because a plan row can be revised between staging and
    // approval.
    financeClaims: v.optional(
      v.array(
        v.object({
          field: v.string(),
          value: v.number(),
          origin: v.union(v.literal("stated"), v.literal("observed")),
          actor: v.union(v.literal("user"), v.literal("agent")),
          basis: v.string(),
          observedAt: v.number(),
          confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
        }),
      ),
    ),
```

- [ ] **Step 6: Write the applier**

In `packages/backend/convex/cash.ts`:

```ts
/**
 * The ONLY path an agent-proposed figure reaches a store, and `executePlan` is its only caller.
 * Re-validates every claim: the plan row is content plane and could have been revised between
 * staging and Approve. All-or-nothing falls out of Convex's serializable mutation for free.
 */
export async function applyFinanceClaims(
  ctx: { db: MutationCtx["db"] },
  tenantId: string,
  claims: readonly FigureClaim[] | undefined,
): Promise<void> {
  const applied = claims ?? [];
  for (const claim of applied) {
    // A claim off a plan row is DB-sourced JSON cast to FigureClaim — it is NOT type-checked
    // input. `validateFigureClaim` throws past its own ok/reason contract on two shapes a stored
    // row can hold: an unknown `field` reaches `cashInputSpec`, which throws, and a null `basis`
    // TypeErrors on `.trim()`. Narrow BEFORE validating, or an approved plan crashes the mutation
    // instead of refusing cleanly.
    if (!CASH_INPUTS.some((s) => s.field === claim.field) || typeof claim.basis !== "string") {
      throw new Error("INVALID_INPUT: malformed claim on plan row");
    }
    // The scorecard store cannot carry provenance: `applyScorecardAnswer` takes only
    // (db, tenantId, threadId, path, value), so origin/actor/basis/observedAt are all discarded,
    // and it appends the dot-path to `userProvided` — which `runEvaluation` rebuilds its citation
    // map from, stamping "user-provided" at HIGH confidence. An agent claim on a scorecard field
    // would therefore read back as the owner's own statement AND launder into the evaluation
    // engine's citations. `writeFigureRow` throws on this; refuse earlier, with a reason the
    // approval card can show.
    if (cashInputSpec(claim.field).store === "scorecard") {
      throw new Error("INVALID_INPUT: that figure cannot be updated by an agent yet");
    }
    // Task 1's merge policy lives in the CALLER — `writeFigureRow` has no isNewerThan guard, so
    // without this an approved claim observed in June patches over a figure the human saved
    // today, moving statedAt backward and flipping actor.
    const stored = await ctx.db
      .query("financeInputs")
      .withIndex("by_tenant_field", (q) =>
        q.eq("tenantId", tenantId).eq("field", claim.field as "cashOnHand"),
      )
      .unique();
    if (!isNewerThan(claim, stored?.statedAt ?? null)) continue;
    await writeFigureRow(ctx.db, tenantId, claim);
  }
  if (applied.length === 0) return;
  // §4: field NAMES, a COUNT and enums — never a figure. Tenant revenue in the append-only audit
  // log is precisely the PII honeypot §4 exists to prevent.
  await ctx.runMutation(internal.audit.log, {
    tenantId,
    eventType: "finance.claims_applied",
    payload: {
      count: applied.length,
      fields: applied.map((c) => c.field),
      actors: [...new Set(applied.map((c) => c.actor))],
      confidences: [...new Set(applied.map((c) => c.confidence))],
    },
  });
}
```

**The audit surface is `internal.audit.log`, not `insertAudit`** — an earlier draft of this plan named a function that does not exist. `audit.ts:16` exports `log` as an `internalMutation` taking `eventType` (not `event`), and it is the module's only insert surface, which is what CLAUDE.md §3's insert-only rule means in practice. Because it is a mutation rather than a direct `db` write, the applier's `ctx` must be a full `MutationCtx`, not `{ db }` — matching `applyCrmOperations`, which has the same shape for the same reason. Also import `CASH_INPUTS`, `cashInputSpec` and `isNewerThan` from `@pikar/core`.

**The scorecard restriction is a real product limit, not a technicality.** It means the agent can update the five `financeInputs` figures — cash on hand, monthly operating cost, MRR, receivables, payables — and **cannot yet update CAC**, which is the headline use case. Closing that needs a per-dot-path provenance map on `evaluations` (mirroring the `userProvidedAt` map that already exists) so `applyScorecardAnswer` can record who supplied a figure. That is a separate, well-bounded change and it is the honest next slice; shipping the agent's CAC update on top of a store that records every write as the owner's own word would be worse than not shipping it.

Add tests for all three refusals: a malformed claim on the plan row, a scorecard-field claim, and a claim older than what is stored (which must leave the stored row untouched rather than throwing).

- [ ] **Step 7: Dispatch it**

In `packages/backend/convex/cockpit.ts`, beside the `crm_write` branch in the inline arm:

```ts
        if (actionTypeOf(plan.kind) === "finance_write") {
          // tenantId off the APPROVED PLAN ROW, never model-supplied.
          await applyFinanceClaims(ctx, plan.tenantId, plan.financeClaims as FigureClaim[]);
        }
```

Import `applyFinanceClaims` from `./cash`.

- [ ] **Step 8: Run the tests**

Run: `cd packages/core && npx vitest run src/actionType.test.ts` then `cd ../backend && npx vitest run convex/cash.test.ts`
Expected: PASS both.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/actionType.ts packages/core/src/actionType.test.ts packages/backend/convex/schema.ts packages/backend/convex/cash.ts packages/backend/convex/cockpit.ts packages/backend/convex/cash.test.ts
git commit -m "feat(finance): finance_write, the sixth action type, on the inline arm"
```

---

### Task 5: The Approvals surface — the refusal path

**REWRITTEN after Task 4.** Following the compile errors in Task 4 already landed the badge (`ApprovalsView.tsx:154`), `titleFor` (`:231`), `actionLabel` (`:251`), the widened `planKind` union (`approvals.ts:40`) and two `test.each` rows. That is the closed union working — a half-added action type was not expressible. **Do not re-add any of it.**

Two things it did not land, and the second is the one that matters.

**Files:**
- Modify: `packages/backend/convex/cash.ts` (`applyFinanceClaims` return contract)
- Modify: `packages/backend/convex/cockpit.ts` (the `finance_write` arm's return)
- Modify: `apps/web/app/(app)/dashboard/approvals/ApprovalsView.tsx` (`refusalMessage`)
- Test: `approvalsView.test.ts`, `packages/backend/convex/cockpit.test.ts`

- [ ] **Step 1: Pin that finance never offers the Schedule button**

`crm_write`'s existing `item.kind === "email"` gate already excludes it, so this needs no source change — but nothing pins it, and the gate is one edited condition away from regressing. Add the negative assertion to `approvalsView.test.ts` alongside the two rows already there.

- [ ] **Step 2: Make a refusal reach the card**

Both of `applyFinanceClaims`'s refusals are `throw new Error("INVALID_INPUT: …")`. `ApprovalsView` only renders `refusalMessage(response.reason)` for an `{ok:false, reason}` **return** (`:388`, map at `:119-135`); a throw lands in `catch (error) => error.message` (`:399`), and **Convex redacts non-`ConvexError` messages in production**.

So today the owner approves a CAC update and gets an opaque server error, with no explanation and no lever — while the plan stays `proposed`, so every retry reproduces it. The refusal itself is correct; only its delivery is broken.

Widen `executePlan`'s return union with the finance reasons and return rather than throw. Two keys, matching the existing vocabulary in `refusalMessage`:

```tsx
  agent_cannot_update_figure:
    "That figure can only be updated by you for now — the agent cannot vouch for where it came from. Nothing changed.",
  malformed_figure_claim:
    "This figure update was malformed and was not applied. Nothing changed.",
```

**Snag to plan for:** `cockpit.test.ts`'s finance refusal test currently pins `rejects.toThrow(...)`. Converting to a return means **changing** that test, not just adding one — and the changed assertion must still prove nothing was written.

Keep `writeFigureRow`'s throw as-is. It is the last-resort invariant guard on a function both actors call; the applier is the layer that knows a refusal has a human waiting on it.

- [ ] **Step 3: Run the tests**

Run: `cd apps/web && npx vitest run "app/(app)/dashboard/approvals/approvalsView.test.ts"` and `cd packages/backend && npx vitest run convex/cockpit.test.ts convex/cash.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/approvals.ts "apps/web/app/(app)/dashboard/approvals/"
git commit -m "feat(finance): the sixth approval kind, labelled for what Approve does"
```

---

### Task 6: The spine finance line

**Files:**
- Create: `packages/core/src/cashSpine.ts`
- Test: `packages/core/src/cashSpine.test.ts`

**Interfaces:**
- Consumes: `CashInputState` (Task 2), `CASH_INPUTS`, `cashInputSpec`.
- Produces: `financeSpineLine(inputs, nowMs)` returning `string | null`, and `FINANCE_SPINE_BUDGET`.

> **CORRECTED 2026-08-10 (whole-branch review, C1).** This block claimed "Task 7 and the existing spine assembler consume it". Neither did: Task 7 built the `readFinance` tool, which reads `unitEconomics`/`solvency`/`inputsFor` and never touches this function, and no task ever wired the spine assembler — `financeSpineLine` shipped with ZERO callers outside its own test while the skill body told the model its context carries a `Finance:` line. The wiring is real as of the review fix: the line is its own query, `internal.cash.financeSpineFor`, joined to the blueprint spine only in `llm.ts`'s `buildTurnPrompt`. It is deliberately NOT appended inside `blueprint.spineForTenant` — that query's output is also `evaluations.ts`'s "Business blueprint" grounding chunk (`vaultGround.ts:225` calls `spineForTenant`, not `renderSpine`), and `FINANCIAL_PATTERNS`' unbounded `[^\d$]*` gaps capture any appended figure as the value of a label the blueprint merely mentions.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/cashSpine.test.ts`:

```ts
import { expect, test } from "vitest";
import { CASH_INPUTS, type CashInputState } from "./cash";
import { FINANCE_SPINE_BUDGET, financeSpineLine } from "./cashSpine";

const NOW = 1_754_000_000_000;
const DAY = 86_400_000;

const state = (over: Partial<CashInputState> & { field: CashInputState["field"] }): CashInputState => ({
  value: null,
  statedAt: null,
  stale: false,
  origin: "stated",
  actor: "user",
  basis: null,
  ...over,
});

test("no collected inputs produces no line — an empty spine line is worse than none", () => {
  expect(financeSpineLine(CASH_INPUTS.map((s) => state({ field: s.field })), NOW)).toBeNull();
});

test("a collected figure renders with its age in days", () => {
  const line = financeSpineLine(
    [state({ field: "cashOnHand", value: 38_500, statedAt: NOW - 38 * DAY })],
    NOW,
  );
  expect(line).toContain("cashOnHand 38500(38d)");
});

test("a stale figure is marked so the agent can act on it", () => {
  const line = financeSpineLine(
    [state({ field: "cac", value: 1400, statedAt: NOW - 94 * DAY, stale: true })],
    NOW,
  );
  expect(line).toContain("STALE");
});

test("an unstamped figure reports unknown age rather than fabricating one", () => {
  const line = financeSpineLine([state({ field: "cac", value: 1400, statedAt: null })], NOW);
  expect(line).toContain("cac 1400(?d)");
});

test("the WORST case fits the budget — every input collected, longest values, all stale", () => {
  const worst = CASH_INPUTS.map((s) =>
    state({ field: s.field, value: 999_999_999, statedAt: NOW - 9999 * DAY, stale: true }),
  );
  const line = financeSpineLine(worst, NOW);
  expect(line).not.toBeNull();
  expect((line as string).length).toBeLessThanOrEqual(FINANCE_SPINE_BUDGET);
  // The load-bearing assertion. Without it this test is TAUTOLOGICAL: financeSpineLine truncates
  // to the budget, so the length check alone passes for ANY budget value — including one so small
  // that mrr/receivables/payables silently never reach the agent, which reads their absence as
  // "not collected" and re-asks for figures the owner already gave. The ellipsis is the observable
  // signal that the guard fired, so adding a twelfth CASH_INPUTS member without re-measuring the
  // budget turns this red instead of silently dropping a figure.
  expect(line as string).not.toMatch(/…$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && npx vitest run src/cashSpine.test.ts`
Expected: FAIL — cannot resolve `./cashSpine`.

- [ ] **Step 3: Implement**

Create `packages/core/src/cashSpine.ts`:

```ts
// The always-on finance line. The spine is assembled on EVERY turn, so this is paid for in
// conversations about nothing financial — it carries STATE (what is known, missing, stale) and
// never analysis. Derived metrics cost a `readFinance` call, on the turns that need them.
import type { CashInputState } from "./cash";

/** The MEASURED worst case: all 11 CASH_INPUTS collected, longest renderable value, longest age,
 *  every one stale. Computed, not guessed — 9 for the prefix, 145 of field names, 253 for eleven
 *  " 999999999(9999d STALE)" bodies, 30 for ten joiners. RE-MEASURE when a member is added to
 *  CASH_INPUTS; the worst-case test goes red if you don't. */
export const FINANCE_SPINE_BUDGET = 437;

const DAY_MS = 86_400_000;

const age = (statedAt: number | null, nowMs: number): string =>
  statedAt === null ? "?d" : `${Math.floor((nowMs - statedAt) / DAY_MS)}d`;

/**
 * `null` when the tenant has collected nothing — a line reading "Finance: all unknown" spends
 * budget on every turn to say the agent knows nothing, which the absence of the line says for free.
 */
export function financeSpineLine(
  inputs: readonly CashInputState[],
  nowMs: number,
): string | null {
  const known = inputs.filter((i) => i.value !== null);
  if (known.length === 0) return null;
  const parts = known.map(
    (i) => `${i.field} ${i.value}(${age(i.statedAt, nowMs)}${i.stale ? " STALE" : ""})`,
  );
  const missing = inputs.filter((i) => i.value === null).map((i) => `${i.field} ?`);
  const line = `Finance: ${[...parts, ...missing].join(" · ")}`;
  return line.length <= FINANCE_SPINE_BUDGET ? line : `${line.slice(0, FINANCE_SPINE_BUDGET - 1)}…`;
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`: `export * from "./cashSpine";`

- [ ] **Step 5: Run the tests**

Run: `cd packages/core && npx vitest run src/cashSpine.test.ts`
Expected: PASS — 5 tests.

Prove the worst-case test is not tautological before you commit: temporarily lower `FINANCE_SPINE_BUDGET` below 437 and confirm the test goes **red** on the ellipsis assertion, then restore it. A budget that cannot be violated is not a budget.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/cashSpine.ts packages/core/src/cashSpine.test.ts packages/core/src/index.ts
git commit -m "feat(finance): the spine finance line, proven at its worst case"
```

---

### Task 7: The `readFinance` tool

**Files:**
- Modify: `packages/backend/convex/llm.ts` (beside `stageCrmWrite` at `:2344`)
- Test: `packages/backend/convex/cockpitTools.test.ts` (append)

**Interfaces:**
- Consumes: the `cash.unitEconomics` and `cash.solvency` queries.
- Produces: a `readFinance` tool. Task 9's fixture exercises it.

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/convex/cockpitTools.test.ts`:

```ts
test("readFinance takes no arguments — the tenant is never model-supplied", async () => {
  const tools = cockpitTools({} as never, "t1", "plan1" as unknown as Id<"plans">, PIN_CLOCK);
  const schema = (
    tools.readFinance.inputSchema as unknown as { jsonSchema: { properties: Record<string, unknown> } }
  ).jsonSchema;
  expect(Object.keys(schema.properties)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/backend && npx vitest run convex/cockpitTools.test.ts -t "readFinance"`
Expected: FAIL — `readFinance` does not exist.

- [ ] **Step 3: Implement**

In `packages/backend/convex/llm.ts`, beside `stageCrmWrite`:

```ts
    // The agent NEVER computes a financial ratio. LTGP:CAC, CFA, payback and runway are defined in
    // `financialSpine.ts` / `cash.ts` with their degenerate guards and the suppression rule; a
    // model re-deriving them in prose produces a confident wrong number on the figure that drives
    // the headline. This tool exists so the correct value is always cheaper to fetch than invent.
    readFinance: tool({
      description:
        "Read the user's current financial picture: their figures, " +
        "which are missing or out of date, and the metrics computed from them. " +
        "Never calculate these ratios yourself — read them here.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        const [unit, sol] = await Promise.all([
          ctx.runQuery(internal.cash.unitEconomicsFor, { tenantId }),
          ctx.runQuery(internal.cash.solvencyFor, { tenantId }),
        ]);
        return JSON.stringify({ unitEconomics: unit, solvency: sol });
      },
    }),
```

The tool loop has no `ctx.tenantId`, so it needs internal readers taking an explicit tenant — the `vaultGroundHydrated` convention. Add to `packages/backend/convex/cash.ts`:

```ts
// Explicit-tenantId internal readers for the tool loop. The tenant comes from the RUN, never from
// the model: `readFinance` has an empty input schema precisely so there is no argument to forge.
export const unitEconomicsFor = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const { inputs } = await inputStatesFor(ctx, tenantId, Date.now());
    return unitEconomics(toCashInputs(inputs), Date.now());
  },
});

export const solvencyFor = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const { inputs } = await inputStatesFor(ctx, tenantId, Date.now());
    return solvency(toCashInputs(inputs), Date.now());
  },
});
```

`internalQuery` is on the §2 allow-list for identity-less engine paths, the same exemption `plans.ts` and `vaultGround.ts` already use.

- [ ] **Step 4: Run the tests**

Run: `cd packages/backend && npx vitest run convex/cockpitTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/llm.ts packages/backend/convex/cash.ts packages/backend/convex/cockpitTools.test.ts
git commit -m "feat(finance): readFinance, so the agent reports ratios instead of inventing them"
```

---

### Task 8: The `stageFinanceWrite` tool

**Files:**
- Modify: `packages/backend/convex/llm.ts`
- Test: `packages/backend/convex/cockpitTools.test.ts` (append)

**Interfaces:**
- Consumes: `validateFigureClaim` (Task 1), the `plans.financeClaims` shape (Task 4).
- Produces: the staged plan rows Task 4's applier consumes.

- [ ] **Step 1: Write the failing test**

```ts
test("stageFinanceWrite stages and applies NOTHING", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "cac", value: 1400, basis: "14000 / 10, this turn" }],
  });
  expect(reply).toMatch(/approve/i);
  const plan = await readPlan(t, planId);
  expect(plan?.kind).toBe("finance_write");
  expect(plan?.financeClaims).toHaveLength(1);
});

test("stageFinanceWrite REFUSES an unknown field rather than inventing one", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", {
    updates: [{ field: "vibes", value: 3, basis: "turn 1" }],
  });
  expect(reply).toMatch(/cannot|not a/i);
  expect((await readPlan(t, planId))?.kind).toBeUndefined();
});

test("stageFinanceWrite REFUSES an empty update list — a sentence, never a throw", async () => {
  const { t, planId } = await setup();
  const reply = await callClock(t, planId, "stageFinanceWrite", { updates: [] });
  expect(reply).toMatch(/nothing|no changes/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/backend && npx vitest run convex/cockpitTools.test.ts -t "stageFinanceWrite"`
Expected: FAIL — tool does not exist.

- [ ] **Step 3: Implement**

```ts
    // ONE tool carrying a LIST — one plan, one approval click, however many figures moved. It
    // stages and applies NOTHING; `executePlan`'s inline arm applies the list after Approve.
    // Validated HERE as well as at the applier: the plan row is content plane and can be revised
    // in between, and `validateFigureClaim` is idempotent over its own output.
    stageFinanceWrite: tool({
      description:
        "Stage updates to the user's own financial figures for them to approve. " +
        "This saves nothing yet. " +
        "Every update must say where the number came from. " +
        "Only the six-to-nine collected inputs can be updated, never a computed ratio.",
      inputSchema: jsonSchema<{
        updates: Array<{ field: string; value: number; basis: string }>;
      }>({
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string", description: "The input's exact name." },
                value: { type: "number", description: "The figure, in whole units." },
                basis: {
                  type: "string",
                  description: "Where it came from, e.g. '14000 / 10, this turn'.",
                },
              },
              required: ["field", "value", "basis"],
            },
          },
        },
        required: ["updates"],
      }),
      execute: async ({ updates }) => {
        if (updates.length === 0) return "There were no changes to stage.";
        const claims: FigureClaim[] = [];
        for (const u of updates) {
          // The field check MUST precede claim construction. `validateFigureClaim` delegates to
          // `cashInputSpec`, which THROWS on a field outside the union — and a hallucinated field
          // name ("revenue", "burnRate") is the likeliest malformed emission from a model. This
          // guard is what turns that throw into a sentence.
          if (!CASH_INPUTS.some((s) => s.field === u.field)) {
            return `"${u.field}" is not a figure I can update. Ask the user which one they mean.`;
          }
          // The SECOND approve surface. `apps/web/app/(app)/dashboard/workspace/cards.tsx:348-359` has
    // its own refusal map, and it lacks the two finance reasons. Its failure mode is worse than
    // the Approvals page's: `if (refusal) setNote(...)` means an UNMAPPED reason renders NOTHING
    // at all, where ApprovalsView at least falls back to the raw enum. A finance card cannot ship
    // on that surface without both entries. (Pre-existing shape — `no_deck`, the three budget
    // reasons and `review_escalated` are already missing there — but finance must not join them.)
    //
    // The model-facing half. `buildAgentContext` (llm.ts:1058) has NO `finance_write` branch, and
    // its own comment records why that matters: `PlanRow` does not declare `kind`, so widening
    // `ACTION_TYPES` is NOT a compile error here — `media` shipped in Phase 20 without ever
    // reaching it. A new action type must be added BY HAND, "and one that is not gets announced
    // to the model as an email". Add the `finance_write` arm beside the `crm_write` one, so a
    // staged figure plan is described as figures rather than as an email with recipient slots.
    // Pin it with a test, because the type system will not.
    // §4 is enforced HERE, at the boundary that constructs `basis`. `validateFigureClaim`
          // checks only that a basis is non-empty — "refs only, never quoted content" is not
          // mechanically decidable in pure TS, so the producer is the enforcement point. Reject a
          // basis carrying quoted content rather than letting it reach the audit log.
          if (/["'“”]/.test(u.basis) || u.basis.length > 120) {
            return `The basis for ${u.field} must name where the number came from, not quote it.`;
          }
          const claim: FigureClaim = {
            field: u.field as CashInputField,
            value: u.value,
            origin: "stated",
            actor: "agent",
            basis: u.basis,
            observedAt: clock(),
            confidence: "high",
          };
          const check = validateFigureClaim(claim, clock());
          if (!check.ok) return `I cannot stage ${u.field}: ${check.reason}`;
          claims.push(claim);
        }
        await ctx.runMutation(internal.cockpit.stageFinancePlan, { planId, claims });
        return `Staged ${claims.length} update(s) for approval. Nothing has changed yet.`;
      },
    }),
```

And the staging mutation it calls, in `packages/backend/convex/cockpit.ts`:

```ts
// Stages onto the plan row and NOTHING else. The row is inert until Approve — `executePlan`'s
// inline arm is the only thing that turns these claims into stored figures.
export const stageFinancePlan = internalMutation({
  args: {
    planId: v.id("plans"),
    claims: v.array(
      v.object({
        field: v.string(),
        value: v.number(),
        origin: v.union(v.literal("stated"), v.literal("observed")),
        actor: v.union(v.literal("user"), v.literal("agent")),
        basis: v.string(),
        observedAt: v.number(),
        confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      }),
    ),
  },
  handler: async (ctx, { planId, claims }) => {
    await ctx.db.patch(planId, { kind: "finance_write", financeClaims: claims });
  },
});
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/backend && npx vitest run convex/cockpitTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/llm.ts packages/backend/convex/cockpit.ts packages/backend/convex/cockpitTools.test.ts
git commit -m "feat(finance): stageFinanceWrite — one plan, one click, however many figures moved"
```

---

### Task 9: The skill body, the owed fixture, and the gate

The skill-registry playbook's binding rule: **teach a tool, owe a fixture.** A new tool without a golden case is an ungated capability.

**Files:**
- Modify: `packages/contracts/skills/cockpit-agent.md`
- Create: `packages/backend/scripts/eval-cases/37-finance-update.json`
- Modify: the fixture-floor constant (35 → 36) in `packages/backend/scripts/run-eval-golden.mjs`

- [ ] **Step 1: Add the two rules to the skill body**

In `packages/contracts/skills/cockpit-agent.md`, in the tools section:

> **Financial figures.** Your context carries a `Finance:` line with the user's figures, their age
> in days, and `STALE` on any that need confirming. When a figure is stale or missing **and it is
> relevant to what the user is asking**, raise it — do not open unrelated conversations with it.
>
> You may arrive at an **input** (the user says they spent $14,000 and gained 10 customers: CAC is
> $1,400). You may never compute a **ratio** — LTGP:CAC, CFA, payback and runway come from
> `readFinance` and nowhere else. Put your working in `basis` so the user can check it.

- [ ] **Step 2: Write the fixture**

Create `packages/backend/scripts/eval-cases/37-finance-update.json`, following `36-crm-follow-up.json`'s shape. Turn 1 states a derivable figure; the EXPECT block asserts a literal key from the closed output vocabulary:

```json
{
  "id": 37,
  "name": "finance-update",
  "turns": [
    { "user": "we spent 14k on ads last month and picked up 10 new customers" }
  ],
  "expect": { "financeClaimCount": 1, "recipientCount": 0, "planKind": "finance_write" }
}
```

If `financeClaimCount` is not already in the closed EXPECT vocabulary, add it as an observable in the eval runner — a count, in the output contract, not guidance prose.

- [ ] **Step 3: Falsify the fixture ALONE before it ever runs inside the gate**

Run: `cd packages/backend && pnpm eval:golden --only 37`
Expected: it runs for cents. A brand-new fixture costs one case to falsify and thirty-six to certify — never let one execute for the first time inside a full gate.

- [ ] **Step 4: Bump the fixture floor**

35 → 36 in the runner's floor constant.

- [ ] **Step 5: Seed and verify the version**

Run `seedSkills`, then read the deployment back at $0 and confirm which version carries your body. **Do not trust a plan's version number** — optimizer dry-runs leave candidate rows at higher versions, so `seedSkills` may not mint the version this document predicts. Record the actual version and its sha256.

- [ ] **Step 6: Run the full gate**

Run: `cd packages/backend && pnpm eval:golden --skill cockpit-agent@<the version you just verified>`
Expected: 36/36. **Budget ~$0.35, not ~$0.12** — the lower figure in older plans is stale by roughly 3x.

- [ ] **Step 7: Do not activate**

Record the evidence on the candidate row. Activation is the owner's click, not this plan's.

- [ ] **Step 8: Update the playbooks (§9)**

`dashboard-pages.md`, `cockpit.md`, `business-evaluation.md`, `skill-registry.md` — bump each `Last verified` line and record what changed. The Stop hook blocks the turn otherwise.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/skills/cockpit-agent.md packages/backend/scripts/ docs/playbooks/
git commit -m "feat(finance): teach the cockpit body figures-first, and the owed fixture"
```

---

## Final verification

- [ ] `pnpm typecheck` — 10/10 packages
- [ ] `pnpm exec turbo run test --concurrency=1` — 9/9 packages
- [ ] `pnpm exec biome ci` on the touched paths only
- [ ] `graphify update . && node scripts/extract-convex-edges.mjs`
