# Scorecard Field Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the scorecard store per-field provenance so an agent-derived figure can be stored and used without being recorded as the owner's own statement.

**Architecture:** A new optional `fieldProvenance` map on `evaluations`, keyed by scorecard dot-path, holding `{ actor, origin, source, at }`. `applyScorecardAnswer` — the single writer every surface already routes through — gains a **required** provenance parameter, so every call site must declare who is answering. `userProvided` and `userProvidedAt` narrow to their literal meaning (the user supplied it); readers consult `fieldProvenance` first and fall back to the legacy proxies for rows written before this change. With provenance recorded, the two refusals that block agent figures (`writeFigureRow`'s throw and `applyFinanceClaims`'s `agent_cannot_update_figure`) become conditional.

**Tech Stack:** TypeScript, Convex, vitest + convex-test, `@pikar/core` (pure-TS domain layer).

**Spec:** `docs/superpowers/specs/2026-08-15-document-driven-blueprint-updates-design.md` (§3.4, §5, §9 plan 1)

## Global Constraints

- **CLAUDE.md §1** — domain types live in `packages/core`; `convex/` is a thin adapter. The provenance type goes in core.
- **CLAUDE.md §2** — never import raw `query`/`mutation`/`action` from `./_generated/server`; use the wrappers in `convex/lib/functions.ts`.
- **CLAUDE.md §4** — `source` on a provenance record carries refs/ids ONLY, never raw user content. It reaches no audit payload in this plan, but the rule holds at the type's docstring.
- **CLAUDE.md §8** — reuse before writing. `FigureOrigin` / `FigureActor` already exist in `packages/core/src/financeClaim.ts`; do not define a second vocabulary.
- **No migration.** `fieldProvenance` is `v.optional`. Every existing row stays valid and every reader has a legacy fallback. Do not write a backfill.
- **Vocabulary is fixed:** `actor` ∈ `"user" | "agent"`, `origin` ∈ `"stated" | "observed"`. Do not add members.
- Run all commands from `packages/backend/`. Test: `pnpm vitest run <file>`. Typecheck: `pnpm typecheck`.
- Convex CLI runs from `packages/backend` only. `turbo run test --concurrency=1` — parallel vitest spawn-fails on this machine.

---

### Task 1: The provenance type and the schema column

**Files:**
- Modify: `packages/core/src/financeClaim.ts` (append the type)
- Modify: `packages/backend/convex/schema.ts:801-812` (evaluations table)
- Modify: `packages/backend/convex/evaluations.ts:156-171` (`insertEvaluation` args)
- Test: `packages/backend/convex/evaluations.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `FieldProvenance` type exported from `@pikar/core`; `evaluations.fieldProvenance` column of type `Record<string, { actor: "user"|"agent"; origin: "stated"|"observed"; source: string; at: number }> | undefined`.

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/convex/evaluations.test.ts`:

```ts
test("an evaluation row round-trips fieldProvenance", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("evaluations", {
      tenantId: TENANT,
      threadId: THREAD,
      framework: "growth-os" as const,
      findings: [],
      gaps: [],
      notEnoughData: [],
      scorecard: emptyScorecard,
      userProvided: [],
      fieldProvenance: {
        "financials.cac": {
          actor: "agent" as const,
          origin: "stated" as const,
          source: "vaultDoc:abc123",
          at: 1_700_000_000_000,
        },
      },
      verdict: "gaps" as const,
      createdAt: 1_700_000_000_000,
    }),
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.fieldProvenance?.["financials.cac"]).toEqual({
    actor: "agent",
    origin: "stated",
    source: "vaultDoc:abc123",
    at: 1_700_000_000_000,
  });
});

test("a legacy row with no fieldProvenance is still valid", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("evaluations", {
      tenantId: TENANT,
      threadId: THREAD,
      framework: "growth-os" as const,
      findings: [],
      gaps: [],
      notEnoughData: [],
      scorecard: emptyScorecard,
      userProvided: [],
      verdict: "gaps" as const,
      createdAt: 1_700_000_000_000,
    }),
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row?.fieldProvenance).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run convex/evaluations.test.ts -t "round-trips fieldProvenance"`
Expected: FAIL — the validator rejects the unknown field `fieldProvenance`.

- [ ] **Step 3: Add the type to core**

Append to `packages/core/src/financeClaim.ts`:

```ts
/**
 * Per-field provenance for a SCORECARD dot-path. The scorecard store historically carried none,
 * so `userProvided` had to answer both "whose fact is this" and "who typed it in" — and therefore
 * lied about one whenever an agent wrote. This record separates them.
 *
 * `origin` is the fact's nature: a figure read out of the owner's own P&L is `stated` — a human
 * asserted it, in a document. `actor` is who performed the write. The pair `stated` + `agent` is
 * the common and correct shape for a document-derived figure, and is exactly what stops the
 * finance page printing "Measured by Pikar" over it.
 *
 * `source` is refs/ids/labels ONLY (CLAUDE.md §4) — a docId, a surface name. NEVER a quoted
 * passage, and never a raw value.
 *
 * `at` is when the figure was TRUE, not when the row was written. A P&L dated six weeks ago is
 * already six weeks into its 90-day staleness clock; stamping the write time would reset a clock
 * that must not reset.
 */
export type FieldProvenance = {
  actor: FigureActor;
  origin: FigureOrigin;
  source: string;
  at: number;
};
```

- [ ] **Step 4: Add the schema column**

In `packages/backend/convex/schema.ts`, immediately after the `userProvidedAt` field in the `evaluations` table (line ~812):

```ts
    // Per-dot-path provenance — the upgrade path named at `cash.ts writeFigureRow` and
    // `cash.ts statedFigure`, now taken. `userProvided` remains the LITERAL "the user supplied
    // it" list; this map records every answer, including the ones an agent wrote, so a
    // document-derived figure can be USED without being CITED as the owner's testimony.
    // `at` is when the figure was true (never the write time). Optional ⇒ no migration; readers
    // fall back to the `userProvided` / `userProvidedAt` proxies for rows written before this.
    fieldProvenance: v.optional(
      v.record(
        v.string(),
        v.object({
          actor: v.union(v.literal("user"), v.literal("agent")),
          origin: v.union(v.literal("stated"), v.literal("observed")),
          source: v.string(), // refs/ids ONLY (§4)
          at: v.number(),
        }),
      ),
    ),
```

- [ ] **Step 5: Thread it through `insertEvaluation`**

In `packages/backend/convex/evaluations.ts`, in the `insertEvaluation` args object, after `userProvidedAt: evalFields.userProvidedAt,`:

```ts
    fieldProvenance: evalFields.fieldProvenance,
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm vitest run convex/evaluations.test.ts -t "fieldProvenance"`
Expected: PASS (both tests)

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/financeClaim.ts packages/backend/convex/schema.ts packages/backend/convex/evaluations.ts packages/backend/convex/evaluations.test.ts
git commit -m "feat(21-01): the scorecard gets a place to record who answered"
```

---

### Task 2: `applyScorecardAnswer` requires provenance

The signature change is the point: making the parameter **required** turns every existing call site into a compile error until it declares who is answering. Do not give it a default.

**Files:**
- Modify: `packages/backend/convex/evaluations.ts:585-630` (`applyScorecardAnswer`), `:675-700` (both `recordScorecardAnswer` variants)
- Modify: `packages/backend/convex/approvals.ts:392`
- Modify: `packages/backend/convex/cash.ts:388-394`
- Test: `packages/backend/convex/evaluations.test.ts`

**Interfaces:**
- Consumes: `FieldProvenance` from `@pikar/core` (Task 1); `evaluations.fieldProvenance` column (Task 1).
- Produces: `applyScorecardAnswer(db, tenantId, threadId, field, value, provenance: FieldProvenance): Promise<{ recorded: true }>` — a sixth **required** positional parameter.

- [ ] **Step 1: Write the failing tests**

Add to `packages/backend/convex/evaluations.test.ts`:

```ts
const USER_PROV = {
  actor: "user" as const,
  origin: "stated" as const,
  source: "finance-panel",
  at: 1_700_000_000_000,
};
const AGENT_PROV = {
  actor: "agent" as const,
  origin: "stated" as const,
  source: "vaultDoc:abc123",
  at: 1_600_000_000_000,
};

test("a USER answer joins userProvided and stamps userProvidedAt", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, TENANT, THREAD, "financials.cac", 150, USER_PROV),
  );
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, TENANT));
  expect(row?.scorecard.financials.cac).toBe(150);
  expect(row?.userProvided).toContain("financials.cac");
  expect(row?.userProvidedAt?.["financials.cac"]).toBe(USER_PROV.at);
  expect(row?.fieldProvenance?.["financials.cac"]).toEqual(USER_PROV);
});

// THE ANTI-LAUNDERING ASSERTION. This is the whole design in one test: the value is usable,
// the provenance is honest, and the owner is not credited with something they did not say.
test("an AGENT answer lands the value but NEVER joins userProvided", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, TENANT, THREAD, "financials.cac", 340, AGENT_PROV),
  );
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, TENANT));
  expect(row?.scorecard.financials.cac).toBe(340);
  expect(row?.userProvided).not.toContain("financials.cac");
  expect(row?.userProvidedAt?.["financials.cac"]).toBeUndefined();
  expect(row?.fieldProvenance?.["financials.cac"]).toEqual(AGENT_PROV);
});

test("an agent answer does not reset the observedAt clock to write time", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, TENANT, THREAD, "financials.cac", 340, AGENT_PROV),
  );
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, TENANT));
  // 1_600_000_000_000, the figure's own date — not Date.now().
  expect(row?.fieldProvenance?.["financials.cac"].at).toBe(AGENT_PROV.at);
});

test("a user re-answer overwrites provenance, so a corrected figure is freshly stated", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, TENANT, THREAD, "financials.cac", 340, AGENT_PROV),
  );
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, TENANT, THREAD, "financials.cac", 150, USER_PROV),
  );
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, TENANT));
  expect(row?.scorecard.financials.cac).toBe(150);
  expect(row?.userProvided).toContain("financials.cac");
  expect(row?.fieldProvenance?.["financials.cac"]).toEqual(USER_PROV);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run convex/evaluations.test.ts -t "userProvided"`
Expected: FAIL — `applyScorecardAnswer` takes 5 arguments, not 6.

- [ ] **Step 3: Change the writer**

In `packages/backend/convex/evaluations.ts`, replace the body of `applyScorecardAnswer` (lines 585-630) with:

```ts
export async function applyScorecardAnswer(
  db: DatabaseWriter,
  tenantId: string,
  threadId: string,
  field: string,
  value: number | string | boolean,
  provenance: FieldProvenance,
): Promise<{ recorded: true }> {
  // NOT named `v` — that is the convex/values validator import at module scope.
  const coerced = coerceScorecardValue(field, value);
  const last = await db
    .query("evaluations")
    .withIndex("by_tenant_thread", (q) => q.eq("tenantId", tenantId).eq("threadId", threadId))
    .order("desc")
    .first();

  // `userProvided` and `userProvidedAt` are now LITERAL: they record what the USER supplied, and
  // an agent write must not join them. `runEvaluation` rebuilds its citation map from
  // `userProvided` and stamps every member `source: "user-provided"` at HIGH confidence, so an
  // agent figure appearing there would launder into the evaluation engine as the owner's own
  // testimony. `fieldProvenance` is written for EVERY answer and is the honest record.
  const byUser = provenance.actor === "user";

  if (last) {
    const scorecard = setPath(last.scorecard, field, coerced);
    const userProvided =
      byUser && !last.userProvided.includes(field)
        ? [...last.userProvided, field]
        : last.userProvided;
    // Stamped from the provenance's own `at`, NEVER `Date.now()`: a figure's stated time is when
    // it was TRUE. A user typing in the panel passes `at: Date.now()` and behaviour is unchanged;
    // a six-week-old P&L keeps its own date and stays six weeks into its staleness clock.
    const userProvidedAt = byUser
      ? { ...(last.userProvidedAt ?? {}), [field]: provenance.at }
      : last.userProvidedAt;
    const fieldProvenance = { ...(last.fieldProvenance ?? {}), [field]: provenance };
    await db.patch(last._id, { scorecard, userProvided, userProvidedAt, fieldProvenance });
    return { recorded: true };
  }

  // No evaluation yet — seed a minimal carrier so the answer survives into the first run.
  await db.insert("evaluations", {
    tenantId,
    threadId,
    framework: "growth-os",
    findings: [],
    gaps: [],
    notEnoughData: [],
    scorecard: setPath(emptyScorecard, field, coerced),
    userProvided: byUser ? [field] : [],
    ...(byUser ? { userProvidedAt: { [field]: provenance.at } } : {}),
    fieldProvenance: { [field]: provenance },
    verdict: "insufficient",
    createdAt: Date.now(),
  });
  return { recorded: true };
}
```

Add `FieldProvenance` to the existing `@pikar/core` import at the top of the file.

> **Note on the seed branch:** read the current lines 614-630 before replacing. Keep whatever `scorecard` / `verdict` / other field values that branch already uses; the only changes are `userProvided`, `userProvidedAt` and the new `fieldProvenance`.

- [ ] **Step 4: Update the two `recordScorecardAnswer` variants**

In `packages/backend/convex/evaluations.ts`, both the `tenantMutation` (line ~675) and the `internalMutation` twin (line ~690) pass agent provenance. **This is the laundering door the spec names.** The cockpit tool relays a figure the user spoke, but a model can misreport what it heard, so the write is recorded as `agent`:

```ts
export const recordScorecardAnswer = tenantMutation({
  args: {
    threadId: v.string(),
    field: v.string(),
    value: v.union(v.number(), v.string(), v.boolean()),
  },
  handler: (ctx, { threadId, field, value }) =>
    applyScorecardAnswer(ctx.db, ctx.tenantId, threadId, field, value, {
      actor: "agent",
      origin: "stated",
      source: "cockpit:recordScorecardAnswer",
      at: Date.now(),
    }),
});
```

Apply the identical provenance literal in `recordScorecardAnswerInternal`, using its explicit `tenantId` argument.

- [ ] **Step 5: Update the Approvals call site**

`packages/backend/convex/approvals.ts:392` — a human answering a decision question in the UI:

```ts
    await applyScorecardAnswer(ctx.db, ctx.tenantId, threadId, answer.field, answer.value, {
      actor: "user",
      origin: "stated",
      source: "approvals:answerDecision",
      at: Date.now(),
    });
```

- [ ] **Step 6: Update the panel call site**

`packages/backend/convex/cash.ts:388-394`, inside `writeFigureRow`'s scorecard branch. The claim already carries everything needed — do not invent values:

```ts
    await applyScorecardAnswer(
      db,
      tenantId,
      existing?.threadId ?? "finance-panel",
      spec.path,
      claim.value,
      {
        actor: claim.actor,
        origin: claim.origin,
        source: claim.basis,
        at: claim.observedAt,
      },
    );
```

Leave the `if (claim.actor === "agent") throw` guard in place for now — Task 5 removes it, once the read side is honest.

- [ ] **Step 7: Run the full backend suite**

Run: `pnpm vitest run convex/evaluations.test.ts convex/cash.test.ts convex/approvals.test.ts`
Expected: PASS. `cash.test.ts:417` asserts the `userProvided` append for a **user** panel answer and must still pass unchanged — if it fails, the `byUser` branch is wrong.

Run: `pnpm typecheck`
Expected: PASS — no remaining 5-argument call sites.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/evaluations.ts packages/backend/convex/approvals.ts packages/backend/convex/cash.ts packages/backend/convex/evaluations.test.ts
git commit -m "feat(21-01): every scorecard answer now says who wrote it"
```

---

### Task 3: Provenance survives re-evaluation

`runEvaluation` carries `userProvided` and `userProvidedAt` forward unchanged into each new row. `fieldProvenance` must ride along, or a weekly re-evaluation silently erases every provenance record and the read side falls back to the legacy proxy — which reports agent figures as unknown-origin.

**Files:**
- Modify: `packages/backend/convex/evaluations.ts:225-232` (carry-forward), `:478-487` (persist)
- Test: `packages/backend/convex/evaluations.test.ts`

**Interfaces:**
- Consumes: `evaluations.fieldProvenance` (Task 1); `applyScorecardAnswer`'s 6-arg form (Task 2).
- Produces: nothing new — restores an existing invariant over the new column.

- [ ] **Step 1: Write the failing test**

```ts
test("fieldProvenance is carried forward unchanged by a re-evaluation", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, TENANT, THREAD, "financials.cac", 340, AGENT_PROV),
  );
  // A second row for the same tenant/thread, as a re-evaluation produces.
  await t.run(async (ctx) => {
    const last = await latestScorecardRow(ctx.db, TENANT);
    if (!last) throw new Error("fixture: no seed row");
    await ctx.db.insert("evaluations", {
      ...last,
      _id: undefined as never,
      _creationTime: undefined as never,
      createdAt: last.createdAt + 1,
    });
  });
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, TENANT));
  expect(row?.fieldProvenance?.["financials.cac"]).toEqual(AGENT_PROV);
});
```

> If spreading a `Doc` with nulled system fields is awkward under this repo's convex-test version, insert an explicit literal row instead — copy every field from the `evaluations` validator. The assertion is what matters, not the fixture style.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run convex/evaluations.test.ts -t "carried forward unchanged"`
Expected: FAIL — `fieldProvenance` is `undefined` on the new row.

- [ ] **Step 3: Carry it forward**

In `packages/backend/convex/evaluations.ts`, immediately after the `userProvidedAt` carry-forward (line ~229):

```ts
      // Carried UNCHANGED, exactly like `userProvided` and `userProvidedAt` above. Without this a
      // weekly re-evaluation erases every provenance record, and the read side silently falls back
      // to the legacy proxy — which reports an agent figure as unknown-origin rather than as an
      // agent's. The erasure direction is the unsafe one.
      const fieldProvenance: Record<string, FieldProvenance> = {
        ...(last?.fieldProvenance ?? {}),
      };
```

- [ ] **Step 4: Persist it**

In the `insertEvaluation` call (line ~483), after `userProvidedAt,`:

```ts
        fieldProvenance,
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run convex/evaluations.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/evaluations.ts packages/backend/convex/evaluations.test.ts
git commit -m "feat(21-01): provenance survives the weekly re-evaluation"
```

---

### Task 4: The read side prefers provenance over the legacy proxy

`cash.ts`'s `statedFigure` currently derives `actor` from `userProvided` membership — an over-broad proxy its own comment flags. It now reads `fieldProvenance` when present and falls back only for legacy rows.

**Files:**
- Modify: `packages/backend/convex/cash.ts:155-180`
- Test: `packages/backend/convex/cash.test.ts`

**Interfaces:**
- Consumes: `evaluations.fieldProvenance` (Task 1), populated by `applyScorecardAnswer` (Task 2) and carried forward (Task 3).
- Produces: no signature change. The returned `{ origin, actor, statedAt }` triple becomes accurate for agent-written scorecard fields.

- [ ] **Step 1: Write the failing tests**

Add to `packages/backend/convex/cash.test.ts`. Note this file has no bare `TENANT`/`THREAD`
constants — it uses the `asTenant(t, userId)` identity helper (`cash.test.ts:38`), and the tenant
id is the subject prefix before `|`. Follow that idiom:

```ts
test("an agent-written scorecard figure reports actor 'agent'", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    applyScorecardAnswer(ctx.db, "u1", "thread_1", "financials.cac", 340, {
      actor: "agent",
      origin: "stated",
      source: "vaultDoc:abc123",
      at: 1_600_000_000_000,
    }),
  );
  const { inputs } = await asTenant(t, "u1").query(api.cash.inputs, {});
  const cac = inputs.find((i) => i.field === "cac");
  expect(cac?.value).toBe(340);
  expect(cac?.actor).toBe("agent");
  expect(cac?.origin).toBe("stated");
  expect(cac?.statedAt).toBe(1_600_000_000_000);
});

test("a legacy row with userProvided but no fieldProvenance still reports actor 'user'", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("evaluations", {
      tenantId: "u1",
      threadId: "thread_1",
      framework: "growth-os" as const,
      findings: [],
      gaps: [],
      notEnoughData: [],
      scorecard: { ...emptyScorecard, financials: { ...emptyScorecard.financials, cac: 150 } },
      userProvided: ["financials.cac"],
      userProvidedAt: { "financials.cac": 1_700_000_000_000 },
      verdict: "gaps" as const,
      createdAt: 1_700_000_000_000,
    }),
  );
  const { inputs } = await asTenant(t, "u1").query(api.cash.inputs, {});
  const cac = inputs.find((i) => i.field === "cac");
  expect(cac?.actor).toBe("user");
  expect(cac?.statedAt).toBe(1_700_000_000_000);
});
```

`api.cash.inputs` is the `tenantQuery` at `cash.ts:187`; it returns `{ inputs: CashInputState[] }`.
Import `applyScorecardAnswer` and `latestScorecardRow` from `./evaluations` and `emptyScorecard`
from `@pikar/core/growth/index` if the file does not already.

- [ ] **Step 2: Run tests to verify the first fails**

Run: `pnpm vitest run convex/cash.test.ts -t "actor 'agent'"`
Expected: FAIL — `actor` is `"agent"` only because the field is absent from `userProvided`, and `statedAt` is `null` rather than the figure's own date. The second test should already pass; it is the regression guard.

- [ ] **Step 3: Read provenance first**

In `packages/backend/convex/cash.ts`, replace the `statedAt` and `userStated` derivations (lines ~159-168) with:

```ts
      // `fieldProvenance` is the authority when present. `userProvided` / `userProvidedAt` remain
      // the fallback for rows written before the map existed: membership there means "somebody
      // answered, probably the owner" and absence means "we do not know" — both resolved in the
      // safe direction, exactly as before. New rows never take the fallback.
      const prov =
        spec.path === undefined ? undefined : evaluation?.fieldProvenance?.[spec.path as string];
      const statedAt =
        value === null
          ? null
          : (prov?.at ?? evaluation?.userProvidedAt?.[spec.path as string] ?? null);
      const userStated = prov
        ? prov.actor === "user"
        : (evaluation?.userProvided ?? []).includes(spec.path as string);
```

Then update the returned `origin` to prefer the record — a figure PIKAR measured must not be reported as stated:

```ts
        origin: prov?.origin ?? "stated",
        actor: userStated ? "user" : "agent",
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run convex/cash.test.ts`
Expected: PASS — both new tests, and every pre-existing `statedFigure` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/cash.ts packages/backend/convex/cash.test.ts
git commit -m "feat(21-01): the finance page reads provenance, not a proxy for it"
```

---

### Task 5: Unblock the agent write

Two refusals exist, not one — `writeFigureRow` throws and `applyFinanceClaims` returns `agent_cannot_update_figure`. Both were guarding the same missing capability. Both lift together, or a caller reaching the shared function by the other route stays broken.

**Files:**
- Modify: `packages/backend/convex/cash.ts:380-390` (the throw), `:483-496` (the refusal)
- Test: `packages/backend/convex/cash.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: `applyFinanceClaims` now accepts scorecard-store claims. `FinanceApplyRefusal` keeps the `agent_cannot_update_figure` member — it is still returned for a claim carrying no usable provenance.

- [ ] **Step 1: Write the failing tests**

```ts
test("an agent claim on cac now applies, with honest provenance", async () => {
  const t = convexTest(schema, modules);
  const claim = {
    field: "cac" as const,
    value: 340,
    origin: "stated" as const,
    actor: "agent" as const,
    basis: "vaultDoc:abc123",
    observedAt: 1_600_000_000_000,
    confidence: "high" as const,
  };
  const result = await t.run((ctx) => applyFinanceClaims(ctx, TENANT, [claim]));
  expect(result.ok).toBe(true);
  const row = await t.run((ctx) => latestScorecardRow(ctx.db, TENANT));
  expect(row?.scorecard.financials.cac).toBe(340);
  // The assertion that makes the whole plan worth doing.
  expect(row?.userProvided).not.toContain("financials.cac");
  expect(row?.fieldProvenance?.["financials.cac"].actor).toBe("agent");
  expect(row?.fieldProvenance?.["financials.cac"].at).toBe(1_600_000_000_000);
});

test("a scorecard claim with a blank basis is still refused", async () => {
  const t = convexTest(schema, modules);
  const claim = {
    field: "cac" as const,
    value: 340,
    origin: "stated" as const,
    actor: "agent" as const,
    basis: "   ",
    observedAt: 1_600_000_000_000,
    confidence: "high" as const,
  };
  const result = await t.run((ctx) => applyFinanceClaims(ctx, TENANT, [claim]));
  expect(result.ok).toBe(false);
});
```

> Read `applyFinanceClaims`'s exact signature and return shape at `cash.ts:463` before writing these — it takes `(ctx, tenantId, claims)` and returns a discriminated result. Match it exactly rather than the sketch above.

- [ ] **Step 2: Run tests to verify the first fails**

Run: `pnpm vitest run convex/cash.test.ts -t "agent claim on cac"`
Expected: FAIL with `agent_cannot_update_figure`.

- [ ] **Step 3: Lift the `writeFigureRow` throw**

In `packages/backend/convex/cash.ts`, delete the `if (claim.actor === "agent") throw ...` guard in the scorecard branch and replace the `ponytail:` block above it with:

```ts
    // The scorecard store now carries per-dot-path provenance (`evaluations.fieldProvenance`), so
    // an agent claim is recorded honestly rather than refused: the value lands and is usable, the
    // write is stamped `actor: "agent"`, and `applyScorecardAnswer` keeps it OUT of `userProvided`
    // — which is what `runEvaluation` rebuilds its citation map from. The laundering path this
    // guard existed to block no longer exists.
```

The `applyScorecardAnswer` call already passes the claim's own provenance (Task 2, step 6); no further change here.

- [ ] **Step 4: Make the `applyFinanceClaims` refusal conditional**

Replace the unconditional store check (line ~494) with a provenance check. `validateFigureClaim` already refuses a blank/whitespace `basis`, a NaN or future `observedAt`, and an out-of-range value — so the remaining job here is only to keep the refusal reachable for a claim that somehow arrives without a usable basis:

```ts
    // Was unconditional: the scorecard could not record who supplied a figure, so a machine was
    // never allowed to tell it. `evaluations.fieldProvenance` now can. What survives is the
    // narrower rule the old one stood in for — a claim with nothing to record provenance FROM is
    // still refused, because a stored figure whose source is unknown is the thing that launders.
    if (cashInputSpec(claim.field).store === "scorecard" && claim.basis.trim() === "") {
      return { ok: false, reason: "agent_cannot_update_figure" };
    }
```

- [ ] **Step 5: Run the full backend suite**

Run: `pnpm vitest run convex/cash.test.ts convex/evaluations.test.ts convex/approvals.test.ts convex/plans.test.ts`
Expected: PASS. `cash.test.ts:705` asserts the refuse-before-write ordering and must still pass.

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/cash.ts packages/backend/convex/cash.test.ts
git commit -m "feat(21-01): an agent may now write CAC, because the store can say it was the agent"
```

---

### Task 6: Documentation (CLAUDE.md §9)

**Files:**
- Modify: `docs/playbooks/business-evaluation.md` (watches `convex/evaluations.ts`)
- Modify: `docs/playbooks/dashboard-pages.md` (watches `convex/cash.ts`)
- Create: `docs/decisions/ADR-0NN-scorecard-field-provenance.md` — run `ls docs/decisions/` and take the next free number

- [ ] **Step 1: Update the playbooks**

In both playbooks: add the `fieldProvenance` invariant — *`userProvided` means the user supplied it and nothing else; `fieldProvenance` records every answer; readers prefer the map and fall back to the proxy only for legacy rows* — and bump its `Last verified` line to `2026-08-15` naming this plan.

- [ ] **Step 2: Write the ADR**

The decision: **the `userProvided` / `fieldProvenance` split.** Record the alternatives considered (widening `userProvided` to carry agent writes; mirroring scorecard figures into `financeInputs`) and why they were rejected. State the standing rule that future work must not undo: `userProvided` is never widened to include non-user writes. ADRs are immutable once accepted — supersede, never edit.

- [ ] **Step 3: Verify the §9 Stop hook is satisfied**

Run: `node scripts/check-playbooks.mjs`
Expected: no unreported paths.

- [ ] **Step 4: Commit**

```bash
git add docs/playbooks docs/decisions
git commit -m "docs(21-01): record the userProvided/fieldProvenance split as a standing rule"
```

---

## Verification

After Task 6, before declaring the plan complete:

```bash
cd packages/backend && pnpm typecheck && pnpm vitest run
```

Both must pass. Paste the actual output — do not claim completion from a partial run.

**The one assertion that proves the plan worked** is in Task 5 step 1: an agent claim on `cac` lands the value, records `actor: "agent"`, and leaves `userProvided` untouched. If that test is absent or weakened, nothing else here demonstrates the feature is honest.

## Known behaviour change

`recordScorecardAnswer` (the cockpit tool, Task 2 step 4) previously added chat-given figures to `userProvided`, which `runEvaluation` cites at `confidence: "high", source: "user-provided"`. After this plan it does not. Figures the user speaks in conversation will stop being cited as user-provided testimony by the Business Evaluation Engine until a later phase gives the citation map a `fieldProvenance`-aware branch.

This is the laundering door the spec deliberately closes (§3.4). It is called out here because it is a real product-visible change that no test failure will announce — the evaluation still runs, it just cites less. Confirm the owner accepts it before executing Task 2.
