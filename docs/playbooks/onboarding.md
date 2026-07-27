# Playbook: Persona Onboarding & Business Profile

> Last verified: 2026-07-27 — Phase 17.1 Wave 1 (plan 17.1-01): **the business BLUEPRINT's structural half landed** — `packages/core/src/blueprint.ts`, the next layer of this same typed-profile subsystem. The CLOSED eleven-field set, ONE `satisfies Record<BlueprintField, FieldSpec>` totality table (a 12th field without a spec is a COMPILE error — mutation-verified: `TS2741` at the `satisfies`, reverted green), `statedFromProfile` (which takes a `BusinessProfile` + a `Tier` and nothing else, so `revenueStage` is structurally unreachable) and `probesFor` (a typed field generates NO probe — cost scales with blanks). See "Business blueprint" below for the field set, the D5 rule, the `stage`-vs-`revenueStage` trap and the `- **Persona:**` detector collision. Prior: 2026-07-26 — Phase 15.1 Wave 6 (plan 15.1-07): **both surfaces landed, and first-time onboarding works again.** The onboarding page is now a CONVERSATION over `onboarding.converse` (opening intake → one `extractProfile` → the fact loop → agent identity → the model-authored closing beat → `saveFacts` THEN `commitProfile`), and the profile page is the FACTS surface (the five tier facts editable, the tier read-only with `TIER_REASON` + an honest `tierSource`, a tier move announced as an EVENT, and design §10's non-blocking legacy invitation). See "The two surfaces (plan 15.1-07)" below for the commit ORDER and why it is load-bearing, the `pikar:onboarding-draft-v2` key, and the one place a choice control is legitimate (the behaviour preset) versus where it is forbidden (the tier). The SC#1c source scan was RE-ARMED against the rewritten source — new per-page anchors, a property-position `tier:`/`persona:` rule, a runtime-`TIERS`-import rule, and a positive row proving the preset group is still there — and mutation-checked: a planted `<button onClick={() => saveFacts({ tier: "sme" })}>` turned it **2 RED**, reverting restored 14/14. Prior: 2026-07-26 — Phase 15.1 Wave 5 (plan 15.1-06): **onboarding stopped guessing the persona from prose and started ASKING.** `onboarding.converse` is one `generateObject` turn returning `{reply, slots, missing, nextSlot, done}` — stateless, writes nothing, and **the CODE owns the state machine while the model owns only the wording**. Its system prompt is the new UNGATED `onboarding-agent` registry row (Q6), loaded FAIL-CLOSED and FIRST, before the offline `SMOKE::onboard::` short-circuit, so SC#3c is exercised on the offline path too. See "The conversational turn" below for the full contract, the Q1 decision and its ceiling, and the SMOKE grammar. Prior: 2026-07-26 — Phase 15.1 Wave 4 (plan 15.1-04): **the LAST authoritative reader of the markdown persona is gone.** `evaluations.ts`'s `personaHint` is deleted and its framework auto-pick now indexes `TIER_FRAMEWORK` (bound `satisfies Record<Tier, Framework>`, `enterprise` → `swot`) with `tenantProfiles.tier`, read via `internal.tenantProfile.forTenant`. That closes defect 1d on the READ side: a `business_profile` doc with a garbage `- **Persona:**` line can no longer silently reclassify a tenant (SC#2b, proven with TWO different table tiers over ONE identical malformed document). `deserializeProfile`'s `"solopreneur"` fallback is **deliberately retained** as a display convenience for the profile page's edit-form loader — see "Record vs projection" below. Q3 is unchanged: `financialsPresent` still overrides with `growth-os`, and the tier's perceivable effect lands on the specialist prompt ([ADR-009](../decisions/009-tier-shapes-the-specialist-prompt-not-the-offer-set.md)), never on the rubric. Prior: 2026-07-26 — Phase 15.1 Wave 3 (plan 15.1-03): **THE SUBTRACTION.** The tier is no longer an INPUT at any layer. `vProfile` has no `persona` field (a Convex `v.object` rejects an EXTRA key, so a caller that sends a tier is REFUSED — the control is gone, not hidden: SC#1b); `profileSchema` has no `persona` property (the model has nowhere to put a guess — defect 1a, structurally); `validateProfile` takes a `ProfileInput` and its `isPersona` branch is DELETED; and both dashboard pages lost their persona pill block, the profile page rendering the tier READ-ONLY with `TIER_REASON`. `commitProfile` and `updateProfile` now READ `tenantProfiles` and splice `row.tier` into the serialized markdown (§4.2 — the markdown is a projection, the table is the record). `commitProfile` is the design §6 COMPLETION GATE: `INCOMPLETE_ONBOARDING` + a `missing` list while any fact slot is empty; `updateProfile` deliberately has NO slot gate (design §10 — no forced re-onboarding of a legacy tenant) but throws `INCOMPLETE_FACTS` when the tier ROW is absent entirely. Both audit payloads now carry `tierSource` and NO `personaConfirmed` — deleted, never corrected, because the audit is insert-only. The `onboarding.ts` module header restates this contract, so a reader who opens the adapter before this playbook still meets it. Prior: 2026-07-26 — Phase 15.1 Wave 2 (plan 15.1-02): the tier got a home. `packages/backend/convex/tenantProfile.ts` is LIVE — `forTenant` / `get` / `saveFacts` / `grantEnterprise` / `backfillLegacyTier` + `runBackfillLegacyTier` (see "The `saveFacts` contract" below and the operator lines under Operational notes). Prior: 2026-07-26 — Phase 15.1 Wave 0 (plan 15.1-01): the tier stopped being a guess. `businessProfile.ts` gained the fact-derived tier surface (`TierFacts`/`deriveTier`/`TIER_REASON`, the closed `REVENUE_STAGES`/`FUNDING_STATES`/`TIERS`/`TIER_SOURCES`/`BEHAVIOR_PRESETS` unions, the `REQUIRED_SLOTS` completion gate, `sanitizeAgentName`) — see "Tier derivation" below. Nothing on the Phase-11 write path changed yet: `decideConfirm`, `validateProfile`, `serializeProfile`, `deserializeProfile` and the `persona` argument are all byte-identical (plan 15.1-03 owns that surgery). Prior: 2026-07-25 — upload `accept` now lists EXTENSIONS alongside the MIME types (`.txt,.md,.markdown,.csv`). Chrome resolves an `accept` MIME type to extensions through the OS registry, and Windows has no entry for `text/markdown`, so the MIME-only list rendered `.md` files invisible in the picker — the folder simply looked empty, with no error to explain it. Prior: 2026-07-24 against 11-04 (editable profile page + re-embed on save; getProfile/deserializeProfile edit-form loader)
> Build history: `.planning/phases/11-persona-onboarding-business-profile/`, `.planning/phases/15.1-fact-derived-tier-conversational-onboarding/` · Related ADRs: [003](../decisions/003-skill-registry-for-prompts.md), [009](../decisions/009-tier-shapes-the-specialist-prompt-not-the-offer-set.md) (tier shapes the specialist PROMPT, not the offer set)

## Purpose

The first-run experience: a brand-new user is guided to describe their business
(pasted text, an uploaded file, or a spoken brief), an LLM extracts the structured
Lean-core narrative, the agent then ASKS the determining facts in conversation
(design §6 — nothing about the business SHAPE is inferred from prose), the user
confirms the closing beat, and the confirmed profile is stored as a vault document
so every downstream agent turn is business-aware.
This is the substrate Phase 12's evaluation engine reads and the reason the cockpit
becomes a chief-of-staff rather than a generic assistant.

## Key files

Pure packages:
- `packages/core/src/businessProfile.ts` — the Convex-free domain module (CLAUDE.md §1): `Persona`
  union, `BusinessProfile` type, `serializeProfile` (deterministic vault-doc markdown) + its inverse
  `deserializeProfile` (parses the committed markdown back to structured fields — the profile page's
  edit-form loader; there is NO separate structured copy, the markdown IS the record), `decideConfirm`
  (the SC#1 always-confirm decision fn), field validators. `packages/core/src/businessProfile.test.ts`
  is its one runnable check (incl. the serialize↔deserialize round-trip).

### Tier derivation (Phase 15.1, design §5) — same file, `businessProfile.ts`

The tier is **derived from facts, never asked for and never guessed from prose**. All of it is pure
TS in `businessProfile.ts`, unit-tested in `businessProfile.test.ts`:

- **Closed unions** — `REVENUE_STAGES` (`pre-revenue` | `early-revenue` | `steady-revenue`),
  `FUNDING_STATES` (`bootstrapped` | `seeking` | `funded`), `TIER_SOURCES`
  (`derived` | `confirmed` | `admin` | `legacy`), `BEHAVIOR_PRESETS` (`direct` | `coaching` |
  `concise`). Owner decision Q7: these are literals, never free strings — a free string here
  reintroduces the string-matching defect class 15.1 exists to close.
- **Two tier types of deliberately different width** — `DerivedTier` (= `Persona`, three members) is
  what `deriveTier` returns; `Tier`/`TIERS` (four members, `enterprise` included) is what the TABLE
  can hold. D6 ("enterprise is never derived") is therefore a TYPE property, not a review note; a
  `@ts-expect-error` in the test file fails the BUILD if the return type is ever widened.
- **`deriveTier(facts)`** — `paidStaff === 0 && headcount <= 2` ⇒ `solopreneur`; else not
  (`steady-revenue` and `bootstrapped`) ⇒ `startup`; else ⇒ `sme`. Branch ORDER is load-bearing (the
  solo test runs first, so a pre-revenue one-person business is a solopreneur, not a startup).
  Thresholds are the design doc's defaults and are a **product call** — retune by editing
  `TIER_BOUNDARY_TABLE` in the test plus the two comparisons, **never** by adding a config row (a
  DB-tunable threshold makes the tier DB-writable by proxy, which D2 forbids).
- **`yearsOperating` is captured but unused by the rule** — design §4.1 names it a tier fact and the
  conversation asks it; a test pins the current contract so nobody "fixes" the omission by accident.
- **`TIER_REASON`** — the read-only reason the profile page renders next to the tier (design §9). A
  `satisfies Record<Tier, string>` table, not a switch: a new tier without a reason is a compile error.
- **`REQUIRED_SLOTS` / `missingSlots` / `canComplete`** — the design §6 completion gate. `0` is an
  ANSWER (`headcount: 0`, `paidStaff: 0`, `yearsOperating: 0` all count as PRESENT); a truthiness
  check here would re-ask a solo founder forever. An off-union enum value is MISSING, never admitted.
- **`sanitizeAgentName`** — 40-char cap, `\p{C}` (Cc + Cf) stripped, whitespace collapsed, trimmed
  after the cap. This string rides into a model system prompt in plan 15.1-05, so it is a trust
  boundary: no newline means a name cannot open a fake instruction block.

### Business blueprint (Phase 17.1) — `packages/core/src/blueprint.ts`

The blueprint is the **standing** business context every agent surface gets, as opposed to
`vaultGroundHydrated`'s per-query retrieval ("which passages mention X"). It is the next layer of
the typed profile, which is why it lives under THIS playbook rather than a second home for one
subsystem. Pure `@pikar/core` (CLAUDE.md §1) — no Convex, no network. Its one runnable check is
`packages/core/src/blueprint.test.ts`.

- **The field set is CLOSED** — `name`, `oneLineDescription`, `stage`, `tier`, `offering`,
  `targetCustomer`, `revenueModel`, `bindingConstraint`, `primaryGoals[]`, `knownConstraints[]`,
  `entities[]`. Closed or the diff and the spine cap are both unbounded. `BLUEPRINT_FIELDS` array
  ORDER is the reporting order — probes and serialization both iterate it, which is what makes the
  output byte-deterministic rather than object-key-order dependent.
- **`FIELD_SPEC` is the ONE totality table** — `as const satisfies Record<BlueprintField, FieldSpec>`
  carrying `label` / `list` / `cap` / `derivable` / `probe` per field. Deliberately NOT a switch:
  a `default` branch makes a new field silently inherit some other field's behaviour and makes the
  coverage test vacuous forever (the `TIER_REASON` idiom, itself the Phase-15 `armFor` lesson).
  **Adding a field without a spec entry is a COMPILE error** — mutation-verified in 17.1-01 (a 12th
  member produced `TS2741` at the `satisfies`, and the revert went green). Downstream handlers (the
  diff, the serializer, the spine caps) all index this table, so they become total at once.
- **`revenueModel` and `bindingConstraint` are BLUEPRINT-only fields.** They are deliberately NOT
  added to `BusinessProfile`: that type is a documented downstream contract read by the Phase 12
  evaluator, and widening it drags the evaluator, the onboarding validator and the profile form
  along for two fields only the blueprint uses. Nothing TYPES them today, so they are exactly the
  fields the probe pass exists to fill.
- **THE TRAP: `stage` is `BusinessProfile.stage`, NEVER `tenantProfiles.revenueStage`.** Two
  different fields with confusingly similar names — `stage` is a free string in the user's own words
  ("pre-launch idea"); `revenueStage` is the closed union `pre-revenue | early-revenue |
  steady-revenue`. Reading the wrong one is a silent correctness bug NO test would catch, so
  `statedFromProfile(profile, tier, entities)` takes a `BusinessProfile` and a `Tier` and **nothing
  else**: `revenueStage` is structurally unreachable from inside it. `tier` still comes from the
  `tenantProfiles` row (`deriveTier` owns it, never re-inferred).
- **D5 — typed content is authoritative and is never overwritten.** Both entry routes (type it /
  upload it) are permanent and compose. A one-line profile edit costs NO model call and NO confirm
  step. The precedence rule is a pure function with no overwrite branch (`mergeBlueprint`, plan
  17.1-03), **never a prompt** — same reasoning as `canComplete`/`missingSlots` above: a merge rule
  in a prompt is a request; a function with no overwrite branch is a guarantee.
- **`origin` is load-bearing, not decoration.** `stated` = the user asserted it (settled — the agent
  must not second-guess it back at the user); `derived` = the system inferred it, carries a `source`
  document title, and should be cited when leaned on. Graph `entities` are `derived` with
  `source: "entity graph"` for exactly this reason — they are inferred, not asserted.
- **Cost scales with BLANKS.** `probesFor(stated)` emits one retrieval probe per blank *derivable*
  field in `BLUEPRINT_FIELDS` order; a typed field generates none, and `name` / `tier` / `entities`
  are `derivable: false` so they are never probed and never accepted from a model candidate (the
  user names their own business, `deriveTier` owns the tier, the graph owns the entities). All
  surviving probes feed **ONE** model call — never one call per field.
- **A blank field is ABSENT (`statedFromProfile`) / `null` (`BusinessBlueprint`), never an entry
  with an empty value.** Presence is `trim().length > 0` per value — the `SLOT_PRESENT` rule, not
  `!value` — and a field whose values all trim empty is dropped. That absence is precisely what
  `probesFor` reads as a blank, so an empty-string entry would silently suppress its own probe.

### Tier control plane — `tenantProfiles` (Phase 15.1, design §4.1)

`packages/backend/convex/schema.ts` → `tenantProfiles`, indexed `by_tenant`. **One row per tenant.**
A new table, not a column: there is no `tenants` table (tenancy is a `tenantId: string` column on
every row), so this was the only option. Adapter: `packages/backend/convex/tenantProfile.ts` (plan
15.1-02 — its watched paths are already registered here so the Stop hook protects it from day one).

- **Record vs projection (§4.2)** — this table is the RECORD for `tier`. The `- **Persona:** x` line
  in the `business_profile` vault doc stays (grounding retrieval must still see "this is a
  solopreneur" in context) but it is a PROJECTION, and **as of plan 15.1-04 it selects no
  behaviour anywhere**: `evaluations.ts`'s `personaHint` — the LAST authoritative reader of the
  markdown persona — is deleted, and the framework auto-pick now indexes `TIER_FRAMEWORK` with
  `tenantProfiles.tier` read through `internal.tenantProfile.forTenant`. `deserializeProfile`'s
  `isTier(x) ? x : "solopreneur"` fallback is **deliberately RETAINED as a display convenience**
  (`getProfile` still pre-fills the profile page's edit form from stored markdown and must not
  throw on a legacy or garbled line); design §4.2 is explicit that the fallback *"stops being a
  silent reclassification risk once nothing authoritative depends on it"*, and 15.1-04 is what made
  that sentence true. **Anything that reads a tier back out of the markdown re-creates defect 1d.**
  Read the tier from the row — `forTenant` (identity-less) or `api.tenantProfile.get` (UI) — never
  from a parsed doc. Enforced by `evaluations.test.ts > "the framework auto-pick reads the tier
  table (SC#2b)"`; the rubric side is documented in
  [`business-evaluation.md`](./business-evaluation.md).
- **Facts are all optional; tier / tierSource / derivedAt are REQUIRED.** A `legacy` backfill row has
  no facts by definition and design §10 forbids forced re-onboarding, so the schema deliberately
  never narrows. A row cannot exist without a tier and a provenance for it — that is what stops a
  half-written row from becoming a silent "solopreneur". Completeness lives at the WRITE boundary
  (`missingSlots`), never in the schema.
- **`tierSource` semantics** — `derived` (deriveTier over complete facts) · `confirmed` (the user
  acknowledged the derivation in the design §6 closing beat) · `admin` (operator grant; the ONLY
  route to `enterprise`) · `legacy` (design §10 backfill, tier recovered from markdown, facts empty).
  It is design §4.1's one-field hedge for a later business-shape-vs-billing split — **not** an
  abstraction for a second tier concept. Do not build one until billing exists.

#### The `saveFacts` contract (plan 15.1-02) — `convex/tenantProfile.ts`

The module is a §1 THIN adapter: `deriveTier` / `missingSlots` / `sanitizeAgentName` are all
`@pikar/core`; this file only reads and writes the row. DEFAULT (V8) runtime — do NOT add
`"use node"` (`llm.ts` is the one node module; a second re-triggers the `internal`-graph
circular-inference cliff). Every handler carries an explicit `Promise<…>` return type.

- **`forTenant(tenantId)`** — `internalQuery`, the identity-less read for `internalAction` callers
  (`evaluations.runEvaluation`, `dispatch.runSpecialist`). `.unique()`, never `.first()`: one row
  per tenant is the table's invariant and a duplicate must be LOUD.
- **`get()`** — `tenantQuery`, the UI read. Returns the row AS-IS; the page composes
  `TIER_REASON[row.tier]` and `missingSlots(row)` itself.
- **`saveFacts({headcount?, paidStaff?, revenueStage?, funding?, yearsOperating?, agentName?,
  behaviorPreset?})` → `{ tier, tierSource, changed }`** — `tenantMutation`. Arg validators are
  derived from `schema.tables.tenantProfiles.validator.fields`, so they cannot drift from the table.

**There is NO `tier` argument and there never will be.** The tier is a derived OUTPUT of the facts
write, never an input to it. Three behaviours the callers depend on:

1. **Incomplete facts on a tenant with NO row FAIL CLOSED** — `ConvexError { code:
   "INCOMPLETE_FACTS", missing }`. A row cannot exist without a tier; inventing one is the
   silent-solopreneur reclassification this phase exists to kill.
2. **Incomplete facts on a tenant that HAS a row patch the facts only** — `tier` / `tierSource` /
   `derivedAt` are untouched. The legacy tier STANDS until the user completes the facts (design §10,
   no forced re-onboarding).
3. **`tierSource: "admin"` is STICKY** — a granted enterprise survives a later tenant facts edit
   (D6). The facts land; the tier and its source do not move.

Merging is `??` (nullish), never `||` — `headcount: 0` is an ANSWER, and the whole 15.1-01 slot gate
exists because a truthiness test re-asks a solo founder forever. Five two-directional compile-time
binds at the top of the file tie the schema's literal unions to the `@pikar/core` unions
(`tier`, `tierSource`, `revenueStage`, `funding`, `behaviorPreset`), so widening one side without
the other is a COMPILE error (the `_stepTools` mechanism, `dispatch.ts:131`).

Three decisions this phase locked that have no other home:

- **Q3 — `financialsPresent` keeps overriding the framework pick, and that is CORRECT.**
  `evaluations.ts`'s auto-pick gives any financially-grounded tenant `growth-os` regardless of tier;
  financials mean a growth-os diagnosis is actually possible. The tier's effect lands on voice,
  framing and the specialist prompt instead, which is **unconditional**. A verifier must NOT read
  SC#5 as "the rubric pick must change" — see [ADR-009](../decisions/009-tier-shapes-the-specialist-prompt-not-the-offer-set.md).
- **Q4 — `enterprise` is granted by an OPERATOR, not by any tenant-callable function.** A grant is an
  `internalMutation` with **no public API surface** (the `actOnGapInternal` precedent), invoked via
  `npx convex run`, writing `tierSource: "admin"`. There is no `tenantMutation`, no UI and no route,
  because `requireOwner`/**GOVN-01 is Phase 22 and is NOT closed by this phase**. Do not add a fourth
  tenant-callable pseudo-admin function — that deepens the Phase-22 blocker. D6 holds regardless of
  who can call the grant, because `deriveTier`'s return type structurally excludes `enterprise`.
- **Q6 — `onboarding-agent` and the behavior-preset style directives are UNGATED**, matching
  `business-profile` (the nearest precedent: also an onboarding skill, also ungated, also producing
  something a human confirms rather than autonomous tool-state). Gating would add an eval-corpus
  obligation this phase has no budget for, and Phase 15's eval gate is already unpaid. Do NOT add
  them to `GATED_SKILLS`.

#### The conversational turn (plan 15.1-06, design §6) — `convex/onboarding.ts` `converse`

**The invariant, stated as an invariant: the completion guarantee is CODE, never the prompt.**
`nextSlot` is `missingSlots(slots)[0]` and `done` is `canComplete(slots)`; the refusal that makes
the guarantee bite is `commitProfile`'s `INCOMPLETE_ONBOARDING`. **A future edit that moves any of
that into the `onboarding-agent` skill body is a regression to defect 1a even though every test
would still pass** — a body saying "always ask about headcount" is a model-temperature guarantee,
and a model that announces the conversation is finished would then have finished it. If you find
yourself writing a rule about WHICH question comes next, or about WHEN the conversation may end,
it belongs in code. The body owns wording; nothing else.

**The turn contract** — `tenantAction`, one `generateObject` call, no tools:

```ts
converse({
  slots: { oneLineDescription?, headcount?, paidStaff?, revenueStage?, funding?, yearsOperating? },
  userMessage: string,
  history?: { role: string; text: string }[],   // bounded to the last 10 entries in the prompt
}) : Promise<{
  reply: string;            // what the user reads
  slots: OnboardingSlots;   // provided-over-stored merge of what the turn learned
  missing: SlotName[];      // missingSlots(slots), in REQUIRED_SLOTS order
  nextSlot: SlotName | null;// missing[0] — null once nothing is left
  done: boolean;            // canComplete(slots) — NEVER read off the model
}>
```

- **Stateless. It writes NOTHING** — no row, no audit, no telemetry, no dead letter (pinned by a
  row-count assertion in `onboarding.test.ts`). The CALLER owns the transcript and the draft; the
  finished facts land through `api.tenantProfile.saveFacts` (the only tier writer) and the narrative
  through `commitProfile`. Do not add a write here: it re-opens "who owns the state" and puts
  conversational prose on the log plane, which §4 forbids.
- **The code supplies the slot NAME and its permitted shape; never question text.** `SLOT_SHAPE`
  in `onboarding.ts` carries one terse line per slot (the two enums list their literals, Q7); the
  prompt line is `Next fact to obtain: <slot> (<shape>)`. When nothing is left the instruction
  becomes the closing beat and the BODY defines what a closing beat is.
- **The merge admission test is `missingSlots` over a one-slot object**, deliberately not a second
  copy of the presence rules — so "was it merged" and "does it still count as missing" are the same
  question. `headcount: 0` is an ANSWER; an off-union enum is DROPPED, never coerced.
- **The registry read is FIRST and FAIL-CLOSED** (`internal.skills.getActiveSkill`,
  `ONBOARDING_AGENT_SKILL`) — before the SMOKE short-circuit, the `extractProfile` ordering. An
  unseeded deployment gets `NO_ACTIVE_SKILL`, not an ungoverned turn. Contrast `dispatch.ts`'s style
  overlay, which is deliberately fail-OPEN: that one is a voice overlay, this one is the whole
  system prompt.

**Q1 (LOCKED) — why this is NOT `runAgentLoop`, and what it costs.** The onboarding turn deliberately
does not ride the cockpit tool-loop, despite design §6's "reuse the Phase 3.2.1 tool-loop" note (the
design doc asked for that to be *confirmed during planning*; it was not confirmable):

- `runAgentLoop` takes a **mandatory `planId: Id<"plans">`**, and `plans.byThread` is `.unique()` —
  minting a synthetic plan row breaks every workspace reader.
- its `toolNames` argument **FILTERS** `buildCockpitTools`; it cannot ADD a tool.
- a new tool name also needs a new `agentSteps.tool` literal, or the trace insert throws **inside an
  SDK callback the SDK SWALLOWS** — a blank activity card in production with every test green, on
  the repo's hottest file, for a phase whose real job is the write path.

**The ceiling** (named in a `ponytail:` comment on `converse`): this turn has **no CKPT-05 activity
trace and no shared per-tree cost rail**, and it has no tools at all. **Upgrade path:** generalize
`runAgentLoop` with an optional `planId`, a merged extra-tools record, and the matching
`agentSteps.tool` literal — then move this handler onto it. Until then: **zero `llm.ts` edits, zero
`schema.ts` change, no new `agentSteps.tool` literal** (all three are hard `git diff --exit-code`
gates on this plan). And do NOT add `"use node"` to `onboarding.ts` — `llm.ts` is the one node
module and a second re-triggers the TS circular-inference cliff; `generateObject` runs fine in V8.

**Q6 (LOCKED): `onboarding-agent` is UNGATED**, matching `business-profile`. Do not add it to
`GATED_SKILLS` — see the rationale comment on that array and `skill-registry.md`.

**How to verify it offline — the `SMOKE::onboard::` grammar.** Verbatim:

```
SMOKE::onboard::<slot>=<value>,<slot>=<value>|reply=<text>
```

Both halves are optional (`SMOKE::onboard::` alone is a turn that learns nothing and replies with
`""`). Unknown slot names are dropped silently and off-union values are refused at the merge — the
sentinel stands in for a MODEL, so it must not be able to smuggle a value the real path would
refuse. It is content-free and PII-free, exactly like `SMOKE::profile::`. Worked example:

```ts
await asTenant(t).action(api.onboarding.converse, {
  slots: { oneLineDescription: "A neighborhood coffee roaster." },
  userMessage: "SMOKE::onboard::headcount=4,funding=bootstrapped|reply=Four of you, got it.",
});
// → { reply: "Four of you, got it.",
//     slots: { oneLineDescription: "…", headcount: 4, funding: "bootstrapped" },
//     missing: ["paidStaff", "revenueStage", "yearsOperating"],
//     nextSlot: "paidStaff", done: false }
```

**Deferred to a live deployment** (`15.1-VALIDATION.md` Manual-Only row 2): a real conversational
turn needs a seeded `onboarding-agent` row and a real model call, and this worktree has no
`CONVEX_DEPLOYMENT`. On a deployment that has one: `pnpm dev` (it seeds — **`npx convex dev` ALONE
does not**), walk the onboarding flow, and confirm both halves — the fact slots are actually ASKED
(headcount and paid staff are questions, not inferences), and an empty required slot blocks
completion however warmly the agent wraps up.

#### The two surfaces (plan 15.1-07) — `apps/web/.../onboarding/page.tsx` + `.../profile/page.tsx`

**The onboarding page, step by step.** Every step is the page's, except the two the server owns:

1. **Opening turn.** The three intake modalities (type / upload / speak) still reduce to ONE
   `intakeText`, unchanged from Phase 11.
2. **`extractProfile(intakeText)`, ONCE** — the narrative fields only. It emits no classification;
   `profileSchema` has no persona property, so there is nowhere for a guess to go.
3. **The fact loop** — `converse({slots, userMessage, history})` per user turn, the returned `slots`
   passed straight back in. **The page never chooses the next question and never computes `done`**;
   it renders `reply`, and shows a COUNT of what is left (`{n} more to cover`) — never a checklist
   of slot names. Design §6 is a conversation, not a form wearing chat's clothes.
4. **Agent identity (D4)** — a free-text name (`maxLength` client-side; `sanitizeAgentName` on the
   server is the authoritative trust boundary) and a behaviour PRESET.
5. **The closing beat (§6)** costs a SECOND `converse` call, and that is deliberate: `nextSlot` is
   derived from the slots the turn was GIVEN, so the turn that finally completes the set was still
   under "obtain <last fact>" and its reply is an acknowledgement. Re-asking with the completed
   slots is what puts the registry prompt on its "nothing left to obtain" branch. **The wording is
   the model's throughout** — a sentence composed in the page would be prompt content in source
   (§5) and would drift from the skill body. If the second call fails, the acknowledgement stands
   and the user is not stranded.
6. **Commit, FACTS FIRST.** `tenantProfile.saveFacts(...)` — which DERIVES and persists the tier —
   **then** `onboarding.commitProfile({profile})`. **The order is load-bearing, not stylistic:**
   `commitProfile` reads `tenantProfiles` to splice the tier into the markdown projection (§4.2) and
   REFUSES with `INCOMPLETE_ONBOARDING` when the row or a fact is missing. Reversed, every
   first-time onboarding fails at its last step. The localStorage draft is cleared only after BOTH
   succeed.

**Draft key: `pikar:onboarding-draft-v2`.** The payload now carries `slots`, the transcript, the
agent name and the preset. The bump is a correctness requirement, not hygiene: a v1 draft carries a
`persona` (deleted in plan 03) and no slots. An unknown/absent `v` is **DROPPED, never migrated** —
a half-migrated draft would resume a conversation whose facts were never asked, which is defect 1a
wearing a resumability costume.

**The profile page is the FACTS surface.** Two cards, two writers, and the difference is the point:

- **Business shape** → `tenantProfile.saveFacts`. The five facts editable (the three numbers are
  digits-only at the keystroke, `min={0} step={1}`; the two enums are `<select>`s over
  `REVENUE_STAGES` / `FUNDING_STATES`), plus the agent name and preset on the SAME call. There is no
  tier field to send.
- **The narrative** → `onboarding.updateProfile`, which re-embeds the vault doc in place.
- **The tier renders as TEXT** — value, `TIER_REASON[tier]`, `tierSource` in plain words, and one
  line saying the facts are what move it. **Never a disabled control:** a greyed-out picker still
  reads as "there is a control here", which is the impression design §9 removes.
- **A tier move is an EVENT** (§9, *"tier change is a moment, not a setting"*), driven off
  `saveFacts`'s `changed` flag — the server's own comparison, never a diff of what the page happens
  to be rendering.
- **The legacy invitation is NON-BLOCKING** (§10): `tierSource === "legacy"` or any missing fact
  shows an inline note explaining what completing them improves. **Never a modal, never a redirect,
  never a gate** — `onboarding.status` deliberately still returns `needsOnboarding: false` for these
  tenants, and a forced re-onboarding would contradict it.
- **`INCOMPLETE_FACTS` / `INCOMPLETE_ONBOARDING` render inline**, naming the gaps in the user's own
  language off a `SLOT_LABEL` map. A raw slot name or error code is never shown, and the refusal
  always returns the user to somewhere they can act.

**Where a choice control is legitimate, and where it is forbidden.** Both pages carry a radio group
over `BEHAVIOR_PRESETS` — a real `fieldset`/`legend` + `input[type=radio]`, so checked state, group
semantics and arrow-key navigation come from the platform. **That is NOT the persona pills
returning.** A preset is a genuine user PREFERENCE (how they want to be spoken to) backed by a
versioned registry row; the TIER is a derived FACT about the business that no control may set. The
SC#1c scan encodes exactly that distinction rather than banning all pills: it forbids a `TIERS`
member on an interactive line, forbids `tier:`/`persona:` in property position, forbids importing
the runtime `TIERS`/`PERSONAS` arrays — and POSITIVELY asserts the preset group is still present, so
"no tier control" can never be satisfied by a page with no controls at all.

Skill registry (extraction prompt, §5 — see `skill-registry.md`):
- `packages/contracts/skills/business-profile.md` — canonical extraction prompt body
- `packages/contracts/src/skills/businessProfile.ts` — derived `businessProfileSkillBody` constant
- `packages/contracts/skills/onboarding-agent.md` — canonical CONVERSATION prompt body (15.1-06)
- `packages/contracts/src/skills/onboardingAgent.ts` — derived `onboardingAgentSkillBody` constant
- `packages/contracts/src/skill.ts` — `BUSINESS_PROFILE_SKILL` + `ONBOARDING_AGENT_SKILL` name
  consts (both UNGATED — absent from `GATED_SKILLS`, Q6)
- `packages/backend/convex/skills.ts` — `seedSkills[]` rows that boot them v1/active

Backend adapter (Wave 2 — LIVE) + frontend (Wave 3 gate+onboarding LIVE; profile page Wave 4):
- `packages/backend/convex/onboarding.ts` — thin adapter (§1): `status` (tenantQuery, first-run gate),
  `getProfile` (tenantQuery — the committed profile parsed back to structured fields via
  `deserializeProfile`, or null; the profile page's edit-form loader), `extractProfile` (tenantAction,
  returns the object — NEVER auto-commits, SC#1), `converse` (tenantAction, ONE conversational turn
  — stateless, writes nothing; see "The conversational turn" above), `commitProfile` +
  `updateProfile` (tenantMutation, persistBrief clone → `startIngest`; updateProfile re-embeds in
  place). Checks: `onboarding.test.ts` (SC#1/#2/#3/#3b/#3c) + `profileRedaction.test.ts` (SC#4).
- `apps/web/app/(app)/layout.tsx` — the first-run GATE (Wave 3, LIVE): inside `<Authenticated>` Shell,
  `useQuery(api.onboarding.status)` → `router.replace("/dashboard/onboarding")` for `needsOnboarding`
  tenants; the shell loader holds while the status query resolves. NOT in `middleware.ts` (invariant below).
- `apps/web/app/(app)/dashboard/onboarding/page.tsx` — the first-run onboarding CONVERSATION
  (Wave 6, LIVE): BRAND §5 chat idiom, adapted — NOT the thread-bound ChatPane. The three ONBD-02
  intake modalities all reduce to `intakeText` for the opening turn: pasted text (compose box) →
  straight through; uploaded file and spoken brief (MediaRecorder one-shot) → `vault.vaultUpload` →
  poll `listVaultDocs` until the row's extracted `text` lands (pending_extraction/extracting show a
  waiting state). Then `extractProfile` ONCE for the narrative, the `converse` fact loop, agent
  identity, the model-authored closing beat, and `saveFacts` → `commitProfile` on confirm
  (`router.replace("/dashboard")` releases the gate). Resumable via the `pikar:onboarding-draft-v2`
  localStorage draft (no new table — RESEARCH Open-Q2), cleared only after BOTH writes succeed. Full
  step order and the commit-ordering rationale: "The two surfaces" above.
- `apps/web/app/(app)/dashboard/profile/page.tsx` — the profile view/EDIT page (Wave 6, LIVE): the
  BUSINESS SHAPE card (the five tier facts + agent name + behaviour preset → `tenantProfile.saveFacts`,
  which re-derives the tier; the tier itself read-only with `TIER_REASON` and its `tierSource`) above
  the NARRATIVE card (`api.onboarding.getProfile` → editable Lean-core fields →
  `api.onboarding.updateProfile`, which RE-EMBEDS the doc in place so grounding stays current).
  Sparse-start mirror: only `oneLineDescription` is required to Save the narrative —
  name/stage/offering/target customer never block it. This is the enrichment surface an idea-stage
  user returns to as the idea matures, and the ONLY legitimate way to move a tier.

## Dependencies & blast radius

Run `graphify query "onboarding business profile"` for the live subgraph. Couplings graphify
cannot see:

- **Extraction skill must be seeded active** — `loadSkill(ctx, BUSINESS_PROFILE_SKILL)` fails closed
  (`NO_ACTIVE_SKILL`) on a deployment that was not seeded. `seedSkills` boots it v1/active.
- **Profile-as-vault-doc** — the confirmed profile is persisted through the SAME vault ingestion path
  as any other doc (`kind: "business_profile"`), so it flows into GraphRAG grounding with zero schema
  migration. Depends on the vault subsystem (`vault.md`) staying the single ingest choke point.
- **Phase 12 eval engine reads the Lean-core field names** — renaming a `BusinessProfile` field is a
  breaking contract change for the downstream evaluator; anchor field names, do not churn them.

## Data flow

1. **Intake** — user pastes text / uploads a file / speaks a brief in `dashboard/onboarding/`.
2. **Extract** — the onboarding adapter calls the LLM with `businessProfileSkillBody`; the model emits
   a `ProfileInput` — the Lean-core fields and **no classification of any kind**. `profileSchema` has
   no `persona` property, so a guess is structurally impossible (defect 1a).
3. **Converse (design §6)** — the determining facts are ASKED, one per turn, through
   `onboarding.converse`. Each turn is one `generateObject` call under the `onboarding-agent`
   registry prompt; the CALLER holds `slots` + the transcript and passes them back in. The code
   picks `nextSlot` from `missingSlots` in `REQUIRED_SLOTS` order and computes `done` from
   `canComplete` — the model never decides either. `done` releases the closing beat, in which the
   agent makes the tailoring legible and asks the user to confirm it.
4. **Confirm (SC#1)** — the extracted narrative fields pre-fill a review card the user edits and
   explicitly confirms. Nothing is persisted before that confirmation.
5. **Derive the tier** — the collected FACTS are written through `tenantProfile.saveFacts` (which
   has no `tier` argument) and `deriveTier` turns them into the `tenantProfiles` row. This is the
   only way a tier comes to exist. `converse` itself writes nothing.
6. **Serialize + persist** — `commitProfile` reads the tier row, refuses with `INCOMPLETE_ONBOARDING`
   if any required slot is empty (design §6), then splices `row.tier` into the profile and
   `serializeProfile` renders deterministic markdown; the mutation stores it as a `business_profile`
   vault doc (persistBrief-style clone) which ingests to `ready`.
7. **Ground** — thereafter `searchVault` surfaces the profile, making agent turns business-aware.

## Invariants — what must never break

- **Sparse-start: only `oneLineDescription` is required of the PROFILE** — an idea-stage
  user (a vague idea, no business yet — ONBD-02 covers "business/idea") has no name/stage/offering/target
  customer, so those are OPTIONAL and enriched later on the profile page. `validateProfile`'s
  `REQUIRED_STRINGS` is exactly `["oneLineDescription"]`; the onboarding page's `requiredFilled` mirror and
  `serializeProfile`'s empty-name heading fallback must stay in lockstep with it. The front door admits an
  idea; it does not demand a finished business. Enforced by `businessProfile.test.ts` (sparse-start +
  empty-name cases) and `onboarding.test.ts` (empty-description rejected). The FIVE tier fact slots
  are a separate, non-optional gate — see "the completion gate" below.
- **No caller can supply a tier (SC#1b)** — `vProfile` has no `persona` field, so an extra key is a
  hard Convex validation error; `ProfileInput` has none either, so nothing can construct one; and
  `saveFacts` has no `tier` argument. Three layers, one property: the tier is an OUTPUT. Enforced by
  `onboarding.test.ts` "SC#1b: updateProfile refuses a caller-supplied tier" (mutation-checked).
- **Neither page carries a tier control (SC#1c)** — the profile page shows the tier read-only with
  `TIER_REASON` and its `tierSource`; the onboarding page never displays it as a choice at all.
  Enforced by the source scan in `businessProfile.test.ts` `describe("no tier control")`, which reads
  both `page.tsx` files off disk and asserts PER-PAGE anchors FIRST so a rename, a move or a
  read-the-same-file-twice bug fails loudly instead of passing vacuously. **If an anchor stops
  matching, fix the anchor before anything else** — every other row is a `not.toContain`, and a
  `not.toContain` over the wrong string passes forever. The scan DISTINGUISHES the legitimate
  `BEHAVIOR_PRESETS` radio group from a tier control (see "The two surfaces") and carries a POSITIVE
  row asserting that group is present, so the guarantee cannot be satisfied by a page with no
  controls. Re-armed and mutation-checked in 15.1-07 against the rewritten source.
- **The onboarding page commits FACTS FIRST, then the profile** — `saveFacts` before
  `commitProfile`, because `commitProfile` reads the tier row to splice the projection and refuses
  without it. Reversing the two breaks every first-time onboarding at its last step.
- **The completion signal comes from the SERVER** — the onboarding page renders `converse`'s `done`
  and never calls `canComplete` itself (asserted by the SC#1c scan). A client-side mirror of a
  fail-closed server gate is how a gate quietly stops being one.
- **The onboarding draft is versioned and never migrated** — `pikar:onboarding-draft-v2`; an unknown
  or absent `v` is dropped. A v1 draft carries a `persona` and no slots, so rehydrating it would
  resume a conversation whose facts were never asked.
- **The completion gate is CODE, never prompt (SC#3b)** — `commitProfile` throws
  `ConvexError({code: "INCOMPLETE_ONBOARDING", missing})` while any `REQUIRED_SLOTS` member is empty.
  A skill body saying "always ask about headcount" is a model-temperature guarantee, which is the
  defect this phase closes. `updateProfile` deliberately has NO slot gate (design §10, SC#6c) — a
  legacy tenant must still be able to edit — but throws `INCOMPLETE_FACTS` if the tier ROW is missing
  entirely, because a `"solopreneur"` fallback there would be defect 1d in a new costume.
- **The conversation's next question and its `done` flag are CODE too (SC#3c)** — `converse` returns
  `nextSlot = missingSlots(slots)[0]` and `done = canComplete(slots)`. Moving either into the
  `onboarding-agent` body is a regression to defect 1a that no existing test would catch, because
  the tests drive the offline sentinel and a prompt regression is invisible to them. Enforced by
  `onboarding.test.ts` "the CODE picks the next question…" and "a model that CLAIMS the conversation
  is finished cannot make it finished" (both mutation-checked).
- **`converse` is stateless and writes nothing** — no row on any table, no audit, no telemetry, no
  dead letter. Pinned by a before/after row-count assertion. A write here would put conversational
  prose on the log plane (§4) and take state ownership away from the caller.
- **The onboarding-agent registry read is FAIL-CLOSED and comes FIRST** — before the
  `SMOKE::onboard::` short-circuit, so an unseeded deployment cannot run an ungoverned turn even
  offline (SC#3c, mutation-checked by moving the short-circuit above the load).
- **Enterprise is not an emittable persona** — the `Persona` union is exactly `solopreneur | startup | sme`;
  `isPersona` and `decideConfirm` still reject `"enterprise"`. `BusinessProfile.persona` is widened to
  `Tier` for the PROJECTION only (the table can hold a granted `enterprise`); widening the projection
  does not widen derivation. Enforced by `businessProfile.test.ts`.
- **Enterprise is never DERIVED (D6)** — `deriveTier`'s return type is `DerivedTier` (= `Persona`), so
  `enterprise` is structurally unreachable from the facts. Widening it breaks the `@ts-expect-error`
  bind in `businessProfile.test.ts` and the BUILD fails. `enterprise` is representable on the table
  and reachable only through an operator grant (`tierSource: "admin"`, Q4).
- **`deriveTier` is the ONLY writer of the tier** — no caller-supplied tier, no config-row threshold,
  no string-match out of markdown. The markdown persona line is a PROJECTION (design §4.2).
- **Zero is an answer** — `missingSlots` tests numbers for finiteness, never truthiness. A solo
  founder answering `paidStaff: 0` has ANSWERED; treating that as absent makes the design §6
  conversation uncompletable. Enforced by `businessProfile.test.ts`.
- **The domain module is Convex-free (CLAUDE.md §1)** — `businessProfile.ts` imports no Convex, no network;
  it is pure and portable. The backend `onboarding.ts` adapter is the only place it meets the DB.
- **§4 redaction boundary (SC#4)** — `audit` / `telemetry` / `deadLetters` payloads written during
  onboarding carry refs / hashes / ids / counts / booleans ONLY — never a profile field value or intake
  prose. The profile `text` is CONTENT (it lives on the vaultDocuments row + rag chunks), never a log.
  `commitProfile` / `updateProfile` emit exactly one audit event each — payload keys EXACTLY
  `{fieldCount, tierSource, vaultDocId}` and `{fieldCount, reembed, tierSource, vaultDocId}`
  respectively. `personaConfirmed: true` is GONE, not corrected: on an edit it was outright FALSE
  (nothing was confirmed), and the audit table is insert-only (CLAUDE.md §3) so historical rows
  cannot be repaired — the fix is to stop writing the field. SC#4b extends the scan to the tier
  FACTS: no `agentName`, `revenueStage`, `funding` or numeric fact reaches a payload. Enforced by
  `profileRedaction.test.ts` (sentinel-in-every-field scan + a numeric-leaf comparison over
  `audit.payload`/`deadLetters.payload`) and by the exact key-set assertions in `onboarding.test.ts`.
- **The extraction skill is UNGATED and SEPARATE from the gated cockpit-agent** — editing
  `business-profile.md` never touches the cockpit-agent body, and it activates v1 without an eval gate
  (its output is a vault document a human confirms, not autonomous tool-state — same rationale as
  `voice-brief`). Do NOT add it to `GATED_SKILLS`.
- **First-run gate lives in the client `AppShell`, never `middleware.ts`** — the redirect into
  `/dashboard/onboarding` is client-side `<Authenticated>` + `useQuery` routing. Adding it to
  `middleware.ts` would run it on the edge without the tenant/profile query and break resumability.

## How to change safely

- **Add/rename a Lean-core field** — edit `BusinessProfile` + `serializeProfile` + `validateProfile`
  together and update `businessProfile.test.ts`'s serializer-equality fixture; then check the Phase 12
  eval engine still reads the field it expects (breaking rename = coordinate with the evaluator).
- **Change the extraction prompt** — it is a NON-gated skill: edit the canonical
  `contracts/skills/business-profile.md`, regenerate the derived `businessProfileSkillBody` constant
  byte-identically, re-seed. `seedSkills` publishes-and-activates automatically. See `skill-registry.md`.
- **Touch the commit/adapter path** — keep redaction BEFORE the write (SC#4); keep the tier SPLICE
  (`{...profile, persona: row.tier}`) on BOTH write paths, or the markdown silently emits
  `- **Persona:** undefined`; and never add a tier argument to `vProfile`. Re-run
  `profileRedaction.test.ts` + `onboarding.test.ts`.

## How to verify

- `pnpm --filter @pikar/core test -- businessProfile` — pure schema + always-confirm decision + serializer
  roundtrip + enterprise-not-emittable (SC#1). ~5s, no deployment needed.
- `pnpm --filter @pikar/core exec vitest run src/businessProfile.test.ts -t "no tier control"` — the
  SC#1c source scan over BOTH rewritten dashboard pages (14 rows). Runs off disk, needs no build and
  no deployment, and is the ONLY automated guard on the two client surfaces.
- `pnpm --filter @pikar/backend test -- onboarding` — status gate + extract-no-auto-commit (SC#1) +
  commit→ingest→retrieve + tenant isolation + re-embed (SC#2/#3) + the `converse` turn (SC#3c
  fail-closed, the code-owned next question, the model-cannot-declare-done property, the
  writes-nothing assertion), convex-test, all offline through the two SMOKE seams. LIVE.
- `pnpm --filter @pikar/contracts exec vitest run` — the `.md` ↔ derived `.ts` no-drift row for
  `onboarding-agent` (a stale derived constant seeds a stale prompt rather than failing loudly).
- `pnpm --filter @pikar/backend test -- profileRedaction` — §4 audit/telemetry/DLQ scan (SC#4). LIVE.
- `pnpm --filter @pikar/backend test -- tenantProfile` — the tier control plane: SC#2a round-trip +
  tenant isolation, the `tenant.tier_changed` payload key set (SC#5c), the `grantEnterprise` grant
  surviving a facts edit, and the legacy backfill's idempotency (SC#6a/6b). convex-test, LIVE.
- `node scripts/check-playbooks.mjs` — this playbook covers its watched paths.
- Manual first-run/resumability/review-card checks: see `11-VALIDATION.md` § Manual-Only Verifications.

## Operational notes

- **Grant an enterprise tier (D6, Q4)** — `enterprise` is NEVER derived, only granted:
  ```
  npx convex run tenantProfile:grantEnterprise '{"tenantId":"<tenantId>"}'
  ```
  It is an `internalMutation` with **no public API surface at all** — no `tenantMutation`, no UI, no
  route. It is deliberately *un-permissioned but unreachable*: `requireOwner` / **GOVN-01 is Phase 22
  and is NOT closed by this phase**, and adding a fourth tenant-callable pseudo-admin function would
  deepen that blocker. A granted enterprise **survives a later tenant facts edit** (`tierSource:
  "admin"` is sticky in `saveFacts`), and D6 holds regardless of who can call the grant because
  `deriveTier`'s return type structurally excludes `"enterprise"`.
- **A tier move emits `tenant.tier_changed`** on the existing insert-only `internal.audit.log` —
  payload is exactly `{ from, to, tierSource, factsChanged }`, four enums/counts and **no fact
  values** (§4). There is deliberately no `tierHistory` table: the audit table already IS the
  append-only log. An unchanged tier writes no event (`derivedAt` may still be refreshed — the
  timestamp records when the RULE last ran, the event records when the ANSWER moved).
- **Backfill pre-15.1 tenants into the control plane (SC#6, design §10)** — one-shot, post-merge on
  `main`'s deployment (the `vaultSweep:runSweep` precedent):
  ```
  npx convex run tenantProfile:runBackfillLegacyTier
  ```
  A `@convex-dev/migrations` migration over `vaultDocuments` (OPSG-06: resumable + batched, never an
  ad-hoc `.collect()` over a table holding book-sized uploads). It writes ONE `tierSource: "legacy"`
  row per tenant that has a non-`failed` `business_profile` doc, recovering the tier from that doc's
  markdown `Persona:` line, with **no facts at all** — design §10 forbids forced re-onboarding, so
  the legacy tier stands until the user completes the facts. `if (existing) return` does double duty
  (idempotency AND never downgrading a `derived` row back to `legacy`) — do not "improve" it into an
  upsert. **This worktree cannot run it for real** (no `CONVEX_DEPLOYMENT`); it is exercised only
  under `convex-test`, and the live run is deferred to integration on `main`
  (`15.1-VALIDATION.md` Manual-Only row 1).
- Seed dependency: a fresh deployment must run `seedSkills` (local `convex dev --run skills:seedSkills`,
  prod `npm run seed`) or the extraction action dead-letters `NO_ACTIVE_SKILL: business-profile`.
- The profile vault doc reuses the vault ingest smoke seam (`SMOKE::<docId>`) for offline tests.

## Known gaps & deferred work

- **Names-in-prose PII ceiling** (shared S1/S4 open item): `packages/pii` scrubs STRUCTURED PII only;
  grounded business-profile prose containing person names must stay out of exportable/WORM tables until
  the NER spike resolves. `ponytail:` upgrade path = Presidio/NER before any multi-user export.
- Backend adapter, onboarding UI, and profile page are all LIVE (Waves 2-6). Their watched paths stay
  registered here so the Stop hook keeps protecting them.
- **Four live-only verifications are unpaid**, recorded with their exact commands in
  `.planning/phases/15.1-fact-derived-tier-conversational-onboarding/deferred-items.md` §2: the live
  backfill run (SC#6), a real conversational turn (SC#3), profile-page interaction (SC#1c) and the
  perceivable tier difference (SC#5). This worktree has no `CONVEX_DEPLOYMENT`, and **nothing in
  Phase 15.1 was gated on one** — every offline gate they stand in for is green. They are separate
  from, and must not be conflated with, Phase 15's still-unpaid specialist-body eval gate.
- **The closing beat costs a second `converse` call.** `ponytail:` ceiling — `converse` derives
  `nextSlot` from the PRE-merge slots. Upgrade path: have it also report a post-merge closing
  instruction so one call covers the last turn. A backend change; plan 15.1-07 did not own it.
