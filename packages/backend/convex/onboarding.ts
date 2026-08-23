// The onboarding / business-profile adapter (ONBD-01/02) — a THIN adapter (§1) over the pure
// @pikar/core business-profile module + the vault ingest/ground spine. Domain logic (Persona,
// serializeProfile, validateProfile, SC#1 confirm-not-assume) lives in @pikar/core; this file only
// reads/writes the DB and orchestrates: the profile is "just another vault doc", so embed + tenant
// scope + retrieval come FREE from startIngest / vaultGroundHydrated (persistBrief clone, §1).
//
// DEFAULT-runtime (V8) module — NO `"use node"` (Pitfall 3, mirrors vaultLlm.ts): llm.ts is the ONE
// node module; a second re-triggers the TS `internal`-graph circular-inference cliff. `generateObject`
// runs fine in V8 (the AI SDK uses fetch). Every handler carries an explicit `Promise<...>` return
// type (the §96 mitigation) and the extractor uses `jsonSchema` (never zod), so this file stays clear
// of the cliff while co-locating the query/mutation/action surface.
//
// SC#1 (nothing is auto-committed): extractProfile RETURNS the structured object to the caller ONLY
// — it inserts no doc and writes no audit. commitProfile is the SEPARATE, explicit human-confirmed
// write. §4: no onboarding audit/telemetry/DLQ payload ever carries profile prose or field values —
// refs/hashes/ids/counts/enums ONLY. The profile `text` is vault CONTENT (kept on the row + rag
// chunks), never a log.
//
// Phase 15.1: the TIER is not an input here at any layer — not on `vProfile`, not on `profileSchema`,
// not on `validateProfile`. Both write paths READ it from `tenantProfiles` and splice it into the
// serialized markdown (§4.2 — the markdown is a projection, the table is the record), and
// `commitProfile` is the design §6 completion gate.

import { openai } from "@ai-sdk/openai";
import type { EntryId } from "@convex-dev/rag";
import { BUSINESS_PROFILE_SKILL, ONBOARDING_AGENT_SKILL } from "@pikar/contracts/skill";
import {
  type BusinessProfile,
  canComplete,
  deriveTier,
  deserializeProfile,
  FUNDING_STATES,
  missingSlots,
  type OnboardingSlots,
  type ProfileInput,
  REQUIRED_SLOTS,
  REVENUE_STAGES,
  type SlotName,
  serializeProfile,
  validateProfile,
} from "@pikar/core";
import { DEFAULT_MODEL } from "@pikar/cost";
import { categoryFor } from "@pikar/vault";
import { generateObject, jsonSchema, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
// `internalMutation` for the `__seedOnboardedTenant` harness seam below. Permitted by
// `lib/allowlist.ts`: the import guard's regex matches only the lowercase public builders
// (`query`/`mutation`/`action`) — the `internal*` variants are the sanctioned exception and need
// no allow-list entry. The tenant wrappers cannot serve here; see the seam's own comment.
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { tenantAction, tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import schema from "./schema";
import { startIngest } from "./vaultIngest";
import { rag } from "./vaultRag";

const CALL_TIMEOUT_MS = 45_000;

// The free-string vault `kind` for a committed profile (ZERO schema migration — kind is v.string()).
const PROFILE_KIND = "business_profile";

// Map a pricing/audit model id ("openai/gpt-4o-mini") to a direct-OpenAI LanguageModel (mirrors
// vaultLlm.ts resolveModel — the @ai-sdk/openai provider wants the bare name + reads OPENAI_API_KEY).
const resolveModel = (id: string): LanguageModel => openai(id.replace(/^openai\//, ""));

// The Convex arg validator mirroring the pure @pikar/core `ProfileInput` — the profile MINUS the
// tier (Phase 15.1, design §9, defect 1b). There is deliberately NO `persona` field and there never
// will be: the tier is DERIVED from asked facts (`tenantProfile.saveFacts`) and spliced into the
// serialized doc by the write paths below. Because a Convex `v.object` rejects an EXTRA key, a
// caller that sends a tier is refused here — the control is GONE, not hidden (SC#1b, pinned by
// onboarding.test.ts "refuses a caller-supplied tier"). validateProfile re-checks the rest.
const vProfile = v.object({
  name: v.string(),
  oneLineDescription: v.string(),
  stage: v.string(),
  offering: v.string(),
  targetCustomer: v.string(),
  primaryGoals: v.array(v.string()),
  knownConstraints: v.array(v.string()),
});

// generateObject structured-output schema (jsonSchema, not zod — keeps this V8 adapter zod-free like
// vaultLlm/documentSchema). STRICT mode: every property is also `required`.
//
// Defect 1a closed at the STRUCTURAL level: there is no `persona` property, so the model has nowhere
// to put a guess even if a future skill-body edit reintroduced the instruction to make one. A
// classification is ASKED (design §6) and DERIVED (`deriveTier`), never inferred from prose.
const profileSchema = jsonSchema<ProfileInput>({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "oneLineDescription",
    "stage",
    "offering",
    "targetCustomer",
    "primaryGoals",
    "knownConstraints",
  ],
  properties: {
    name: { type: "string" },
    oneLineDescription: { type: "string" },
    stage: { type: "string" },
    offering: { type: "string" },
    targetCustomer: { type: "string" },
    primaryGoals: { type: "array", items: { type: "string" } },
    knownConstraints: { type: "array", items: { type: "string" } },
  },
});

// ── Offline SMOKE seam (Pitfall 4, mirrors vaultLlm smokeGraphFixture) ────────
// A convex-test / dev smoke drives extraction deterministically and offline (no OPENAI_API_KEY). The
// sentinel carries no PII. Grammar: `SMOKE::profile::<anything>`. The fixture is a fully-populated
// profile so the review/commit E2E runs with no model call.
//
// Phase 15.1: the suffix was `<persona>` and selected the fixture's persona. Extraction emits no
// classification any more, so the suffix is INERT — it is deliberately still ACCEPTED (the grammar
// is unchanged) so every existing caller, fixture and dev smoke keeps working untouched; it simply
// selects nothing. Do not "clean up" by rejecting it: that would be a breaking change to a seam
// whose whole job is to stay boring.
const SMOKE_PROFILE_PREFIX = "SMOKE::profile::";

function smokeProfileFixture(): ProfileInput {
  return {
    name: "Smoke Business",
    oneLineDescription: "A deterministic smoke-fixture business used offline.",
    stage: "early-revenue",
    offering: "A smoke offering.",
    targetCustomer: "Smoke customers.",
    primaryGoals: ["Grow revenue"],
    knownConstraints: ["Solo operator"],
  };
}

/**
 * ONBD-01 first-run gate signal. Returns `{ needsOnboarding: true }` for a tenant with no committed
 * business-profile doc, `false` once one exists (a `failed` ingest doesn't count — the user must
 * re-commit). Refs/booleans ONLY — no profile content crosses this boundary (§4).
 */
export const status = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ needsOnboarding: boolean }> => ({
    // Same predicate as `currentProfileDoc` (newest non-failed profile doc), so it IS that read
    // rather than a second copy of it. This runs on every authenticated page render — see the
    // `by_tenant_kind` note in schema.ts for why it must never widen to the whole vault again.
    needsOnboarding: !(await currentProfileDoc(ctx, ctx.tenantId)),
  }),
});

/**
 * ONBD-02 profile read — the edit-form loader. Returns the tenant's committed Lean-core profile as a
 * STRUCTURED object (parsed back from the vault doc's markdown via @pikar/core `deserializeProfile`,
 * the serializer's inverse), or `null` if none is committed yet. There is no separate structured copy
 * — the vault doc `text` is the record — so the parse is the read boundary. Content plane (§4): the
 * returned object is profile CONTENT for the owning tenant's own edit surface, tenant-scoped by
 * `ctx.tenantId`; it is NEVER written to a log.
 */
export const getProfile = tenantQuery({
  args: {},
  handler: async (ctx): Promise<BusinessProfile | null> => {
    const doc = await currentProfileDoc(ctx, ctx.tenantId);
    return doc?.text ? deserializeProfile(doc.text) : null;
  },
});

/**
 * ONBD-01 extraction. Loads the UNGATED business-profile skill (§5, fails closed unseeded) and runs
 * `generateObject` over the intake text, returning the Lean-core structured object to the CALLER
 * ONLY. SC#1: it NEVER auto-commits — no doc insert, no audit write — the draft is reviewed by a
 * human before `commitProfile` writes anything. It returns a `ProfileInput`: no tier, no persona,
 * no classification of any kind (defect 1a). A `SMOKE::profile::` sentinel short-circuits to a
 * deterministic fixture (no model call — the offline/test path).
 */
export const extractProfile = tenantAction({
  args: { intakeText: v.string() },
  handler: async (ctx, { intakeText }): Promise<ProfileInput> => {
    // Load the extraction prompt FIRST (no hardcoded prompt — §5); fails closed unseeded, so the
    // load is exercised even on the offline path.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: BUSINESS_PROFILE_SKILL },
    );

    if (intakeText.startsWith(SMOKE_PROFILE_PREFIX)) return smokeProfileFixture();

    const { object } = await generateObject({
      model: resolveModel(DEFAULT_MODEL),
      schema: profileSchema,
      system: skill.body,
      prompt: intakeText,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      maxRetries: 1,
    });
    return object;
  },
});

// ── The conversational onboarding turn (design §6, ONBD-01) ───────────────────
//
// ponytail: this turn does NOT ride `runAgentLoop` (owner decision Q1, plan 15.1-06). The ceiling
// is a conversation with NO TOOLS: there is no CKPT-05 activity trace for it and it does not draw
// on the shared per-tree cost rail `governedDispatch` maintains. That was priced deliberately —
// `runAgentLoop` takes a mandatory `planId: Id<"plans">` (and `plans.byThread` is `.unique()`, so a
// synthetic row breaks every workspace reader), its `toolNames` FILTERS `buildCockpitTools` rather
// than adding to it, and a new tool name also needs a new `agentSteps.tool` literal or the trace
// insert throws inside an SDK callback the SDK SWALLOWS: a blank activity card in prod with every
// test green, on the repo's hottest file. Upgrade path if onboarding ever needs REAL tools:
// generalize `runAgentLoop` with an optional `planId`, a merged extra-tools record, and the
// matching `agentSteps.tool` literal — then move this handler onto it.

// Arg validators derived from the table (the `tenantProfile.ts` rung-2 precedent) so the closed
// `revenueStage`/`funding` unions cannot drift from the schema. Q7: a free string here would
// reintroduce the string-matching defect class this phase exists to close. `oneLineDescription` is
// Phase-11 narrative that lives on the vault doc, not on the row, so it is the one hand-written
// field — but it is still a `REQUIRED_SLOTS` member and the conversation must fill it.
const tpFields = schema.tables.tenantProfiles.validator.fields;

const vSlots = v.object({
  oneLineDescription: v.optional(v.string()),
  headcount: tpFields.headcount,
  paidStaff: tpFields.paidStaff,
  revenueStage: tpFields.revenueStage,
  funding: tpFields.funding,
  yearsOperating: tpFields.yearsOperating,
});

/** What ONE turn returns. `slotUpdates` is what the user stated THIS turn — never the whole set. */
type TurnOutput = {
  reply: string;
  slotUpdates: Partial<Record<SlotName, string | number | null>>;
};

// The `generateObject` contract — `jsonSchema`, never zod (this V8 module stays off the TS
// circular-inference cliff, exactly like `profileSchema`). STRICT mode: `additionalProperties:
// false` and EVERY property also listed in `required`. That is why "not learned this turn" is an
// explicit `null` rather than an omission — a required property cannot be omitted, so the honest
// encoding of "the user did not say" has to be a value. The nulls are filtered out at the merge.
const turnSchema = jsonSchema<TurnOutput>({
  type: "object",
  additionalProperties: false,
  required: ["reply", "slotUpdates"],
  properties: {
    reply: { type: "string" },
    slotUpdates: {
      type: "object",
      additionalProperties: false,
      required: [...REQUIRED_SLOTS],
      properties: {
        oneLineDescription: { type: ["string", "null"] },
        headcount: { type: ["number", "null"] },
        paidStaff: { type: ["number", "null"] },
        revenueStage: { type: ["string", "null"], enum: [...REVENUE_STAGES, null] },
        funding: { type: ["string", "null"], enum: [...FUNDING_STATES, null] },
        yearsOperating: { type: ["number", "null"] },
      },
    },
  },
});

// The CODE-owned half of the turn: the slot's NAME and the shape of a valid answer. Deliberately
// NOT question text — the wording is the registry skill's job (§5), and writing questions here
// would put half the prompt in source. The two enums list their literals because the model must
// choose from the closed union, which is the whole point of Q7.
const SLOT_SHAPE = {
  oneLineDescription: "one plain sentence describing what the business does",
  headcount: "a number — everyone working on the business, paid or not, founders included",
  paidStaff: "a number — how many of those are PAID staff",
  revenueStage: `exactly one of: ${REVENUE_STAGES.join(" | ")}`,
  funding: `exactly one of: ${FUNDING_STATES.join(" | ")}`,
  yearsOperating: "a number — full years the business has been operating",
} as const satisfies Record<SlotName, string>;

/** How many prior turns ride along. Bounded so a long conversation cannot grow the prompt forever. */
const HISTORY_TURNS = 10;

/**
 * Admission test for ONE incoming slot value, expressed as `missingSlots` over a single-slot
 * object. Deliberately NOT a second copy of the presence rules: reusing the completion predicate
 * makes "was it merged" and "does it still count as missing" the SAME question, so `converse` can
 * never return a slot that is populated on the page and absent to the gate. It also inherits the
 * two properties that matter — `0` is an ANSWER, and an off-union enum is refused, never coerced.
 */
const admits = (slot: SlotName, value: unknown): boolean =>
  !missingSlots({ [slot]: value } as OnboardingSlots).includes(slot);

/** Provided-over-stored merge, nulls dropped, every admitted value checked. Never coerces. */
function mergeSlots(base: OnboardingSlots, updates: TurnOutput["slotUpdates"]): OnboardingSlots {
  const out: Record<string, unknown> = { ...base };
  for (const slot of REQUIRED_SLOTS) {
    const value = updates[slot];
    if (value === null || value === undefined) continue;
    if (!admits(slot, value)) continue; // a model (or a stale draft) can propose; it cannot impose
    out[slot] = value;
  }
  return out as OnboardingSlots;
}

/**
 * The USER-side prompt, assembled in CODE. It carries three things and no question text: what is
 * already known (the tenant's own data on the CONTENT plane — never logged, §4), the bounded
 * transcript, and the ONE fact to obtain next with its permitted shape. That split is what keeps
 * §5 satisfied (the wording is the registry row's) while the completion guarantee stays in code.
 */
function turnPrompt(
  slots: OnboardingSlots,
  userMessage: string,
  history: { role: string; text: string }[],
  nextSlot: SlotName | undefined,
): string {
  const known = REQUIRED_SLOTS.filter((s) => slots[s] !== undefined).map(
    (s) => `- ${s}: ${String(slots[s])}`,
  );
  const recent = history.slice(-HISTORY_TURNS).map((h) => `${h.role}: ${h.text}`);
  return [
    known.length > 0 ? `Already known:\n${known.join("\n")}` : "Already known: nothing yet.",
    recent.length > 0 ? `Conversation so far:\n${recent.join("\n")}` : "",
    `The user just said:\n${userMessage}`,
    nextSlot === undefined
      ? "Nothing left to obtain — this turn is the closing beat."
      : `Next fact to obtain: ${nextSlot} (${SLOT_SHAPE[nextSlot]})`,
  ]
    .filter((block) => block !== "")
    .join("\n\n");
}

// ── Offline SMOKE seam for the conversation (mirrors SMOKE_PROFILE_PREFIX) ────
// Grammar: `SMOKE::onboard::<slot>=<value>,<slot>=<value>|reply=<text>` — both halves optional.
// Content-free and PII-free, exactly like the profile sentinel: it carries slot NAMES and toy
// values, never a real answer. Unknown keys are dropped silently and off-union values are refused
// at the merge, because the sentinel stands in for a MODEL and must not be able to smuggle a value
// the real path would refuse.
const SMOKE_ONBOARD_PREFIX = "SMOKE::onboard::";

const REPLY_KEY = "reply=";

function smokeTurnFixture(userMessage: string): TurnOutput {
  const rest = userMessage.slice(SMOKE_ONBOARD_PREFIX.length);
  const bar = rest.indexOf("|");
  const factPart = bar < 0 ? rest : rest.slice(0, bar);
  const replyPart = bar < 0 ? "" : rest.slice(bar + 1);

  const slotUpdates: TurnOutput["slotUpdates"] = {};
  for (const pair of factPart.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    if (!(REQUIRED_SLOTS as readonly string[]).includes(key)) continue; // unknown key → dropped
    const slot = key as SlotName;
    // Numbers arrive as numbers so the merge's admission test sees what a model would send; a
    // non-numeric value stays a string and is refused there rather than coerced to NaN here.
    const num = Number(raw);
    slotUpdates[slot] = raw !== "" && Number.isFinite(num) ? num : raw;
  }

  return {
    reply: replyPart.startsWith(REPLY_KEY) ? replyPart.slice(REPLY_KEY.length) : "",
    slotUpdates,
  };
}

/** What one `converse` turn returns. Plan 07's onboarding page is written against this shape. */
export type ConverseResult = {
  reply: string;
  slots: OnboardingSlots;
  missing: SlotName[];
  /** The slot the NEXT turn must obtain — `missingSlots(slots)[0]`, `null` when nothing is left. */
  nextSlot: SlotName | null;
  done: boolean;
};

/**
 * ONE conversational onboarding turn (design §6). **The code owns the state machine and picks the
 * next question; the model owns only the wording.**
 *
 * Design §6's non-negotiable is that the conversation *"simply cannot COMPLETE with a required slot
 * empty"*, and that guarantee must not live in the prompt: a skill body saying "always ask about
 * headcount" is a model-temperature guarantee, which is defect 1a itself. So `nextSlot` comes from
 * `missingSlots` in `REQUIRED_SLOTS` order and **`done` is `canComplete(slots)`, never read off the
 * model's reply** — a turn that announces the conversation is over cannot make it over.
 *
 * The system prompt is the UNGATED `onboarding-agent` registry row (§5), loaded FIRST — before the
 * SMOKE short-circuit — so the fail-closed load is exercised on the offline path too (the
 * `extractProfile` ordering; SC#3c). An unseeded deployment gets `NO_ACTIVE_SKILL`, not a turn.
 *
 * **STATELESS: this writes NOTHING.** The caller owns the transcript and the draft; the finished
 * facts land through `api.tenantProfile.saveFacts` (the ONLY tier writer) and the narrative through
 * `commitProfile` (the completion gate that makes the guarantee true, SC#3b), both from the UI. Do
 * not add a write here — it would re-open "who owns the state" and put conversational prose on the
 * log plane, which §4 forbids.
 */
export const converse = tenantAction({
  args: {
    slots: vSlots,
    userMessage: v.string(),
    history: v.optional(v.array(v.object({ role: v.string(), text: v.string() }))),
  },
  handler: async (ctx, a): Promise<ConverseResult> => {
    // §5, FAIL CLOSED, and FIRST — see the doc comment. Moving this below the SMOKE branch would
    // make every offline turn run without a governed prompt (SC#3c is mutation-checked on exactly
    // that reordering).
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: ONBOARDING_AGENT_SKILL },
    );

    const missingBefore = missingSlots(a.slots);
    const nextSlot = missingBefore[0];
    const prompt = turnPrompt(a.slots, a.userMessage, a.history ?? [], nextSlot);

    const object = a.userMessage.startsWith(SMOKE_ONBOARD_PREFIX)
      ? smokeTurnFixture(a.userMessage)
      : (
          await generateObject({
            model: resolveModel(DEFAULT_MODEL),
            schema: turnSchema,
            system: skill.body,
            prompt,
            abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            maxRetries: 1,
          })
        ).object;

    const slots = mergeSlots(a.slots, object.slotUpdates);
    const missing = missingSlots(slots);
    return {
      reply: object.reply,
      slots,
      missing,
      nextSlot: missing[0] ?? null,
      done: canComplete(slots),
    };
  },
});

// ── Commit / edit — the persistBrief clone (SC#2/#3, ONBD-02) ─────────────────

// Count populated Lean-core fields (the 5 supplied strings + the 2 lists when non-empty). A refs-only
// audit signal (§4) — a NUMBER, never a field value — so the ops plane can see "a profile landed"
// without the profile becoming a log. Phase 15.1: `persona` left the count because it left the
// INPUT — counting a field the caller cannot supply would report the same +1 on every write.
function populatedFieldCount(p: ProfileInput): number {
  const strings = [p.name, p.oneLineDescription, p.stage, p.offering, p.targetCustomer];
  return (
    strings.filter((s) => s.trim() !== "").length +
    (p.primaryGoals.length > 0 ? 1 : 0) +
    (p.knownConstraints.length > 0 ? 1 : 0)
  );
}

// The SHARED persistBrief clone (voice.ts:299) — the profile is "just another vault doc", so embed +
// tenant scope + retrieval come FREE from startIngest / vaultGroundHydrated (§1). `existing` re-embeds
// an edit IN PLACE on the same row: the stale rag entry is deleted (clean replace) and the row is
// reset to `processing` before re-ingest. `text` is vault CONTENT (§4) — kept on the row, never a log.
// ponytail: an edit re-attributes the graph to the SAME sourceDocId but doesn't GC the prior version's
// edges (upsertGraph dedups new ones; a short structured profile yields few) — the ceiling is routing
// through vault.deleteVaultDoc's full cascade if profile-graph staleness ever matters.
/** NOT exported. `validateProfile` lives at the CALL site, not in here — every caller used to have
 *  to remember to run it first, and the `proposals.ts` applier didn't (fix, finding 1: it wrote a
 *  blank-skeleton profile straight through this function with no validation at all, while a
 *  now-corrected comment here claimed it "inherited `validateProfile` either way"). The only way to
 *  reach this function is now `validateAndWriteProfile` below, so a validation-free write is a
 *  compile error (no import), not a caller that forgot a line. */
async function writeProfileDoc(
  ctx: MutationCtx,
  tenantId: string,
  profile: BusinessProfile,
  existing?: Doc<"vaultDocuments">,
): Promise<Id<"vaultDocuments">> {
  const text = serializeProfile(profile);
  const hash = await contentHash(text);
  const size = new TextEncoder().encode(text).length;
  const title = profile.name || "Business profile";

  let vaultDocId: Id<"vaultDocuments">;
  if (existing) {
    if (existing.ragEntryId)
      await rag.deleteAsync(ctx, { entryId: existing.ragEntryId as EntryId }); // replace, not orphan
    await ctx.db.patch(existing._id, {
      title,
      text,
      contentHash: hash,
      size,
      status: "processing",
      ragEntryId: undefined,
      failureReason: undefined,
    });
    vaultDocId = existing._id;
  } else {
    vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: PROFILE_KIND, // NEW free-string kind — ZERO schema migration
      category: categoryFor({ source: "agent" }), // → "workspace-docs"
      source: "agent",
      mimeType: "text/markdown",
      size,
      contentHash: hash,
      text, // serializeProfile output — content plane (§4)
      status: "processing",
      createdAt: Date.now(),
    });
  }
  await startIngest(ctx, { vaultDocId, tenantId, correlationId: crypto.randomUUID() });
  return vaultDocId;
}

/**
 * The profile store's ONE entry point (fix, finding 1). `validateProfile` then `writeProfileDoc` —
 * always in that order, always together — so every validator that guards a manual entry guards a
 * proposal-applied one too, BY CONSTRUCTION: there is no way to reach `writeProfileDoc` without
 * going through this, because `writeProfileDoc` is not exported. A caller that wants to reject
 * loudly (`commitProfile`, `updateProfile`) throws on a `false` result immediately; `proposals.ts`'s
 * applier cannot throw a `ConvexError` past its own `ok/reason` contract, so it turns a `false`
 * result into its own `"invalid_profile"` refusal instead — same rule, two calling conventions.
 *
 * Exported for `proposals.ts`, which is the third caller.
 */
export async function validateAndWriteProfile(
  ctx: MutationCtx,
  tenantId: string,
  profile: BusinessProfile,
  existing?: Doc<"vaultDocuments">,
): Promise<{ ok: true; vaultDocId: Id<"vaultDocuments"> } | { ok: false; errors: string[] }> {
  const check = validateProfile(profile);
  if (!check.ok) return { ok: false, errors: check.errors };
  const vaultDocId = await writeProfileDoc(ctx, tenantId, profile, existing);
  return { ok: true, vaultDocId };
}

/**
 * The tenant's tier row — the RECORD (design §4.2). Both write paths read it here and splice
 * `row.tier` into the serialized markdown, which is only ever a PROJECTION of it.
 *
 * A direct `ctx.db` read, deliberately NOT `ctx.runQuery(internal.tenantProfile.forTenant, …)`: this
 * runs inside a mutation, so it is the SAME transaction either way and the query hop buys nothing.
 * `.unique()` mirrors `tenantProfile.byTenant` — one row per tenant is THE invariant of that table,
 * so a duplicate is LOUD rather than silently shadowed.
 *
 * Exported for `proposals.ts`: the applier refuses a profile proposal rather than fabricate a
 * `persona` when this returns `null`, mirroring `updateProfile`'s own `INCOMPLETE_FACTS` gate. */
export const currentTierRow = (
  ctx: QueryCtx | MutationCtx,
  tenantId: string,
): Promise<Doc<"tenantProfiles"> | null> =>
  ctx.db
    .query("tenantProfiles")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();

// The tenant's current committed profile doc (newest non-failed), or null. The edit target, the
// re-commit guard, AND the `status` first-run gate — every profile read in this module lands here.
//
// Reads `by_tenant_kind`, NOT `by_tenant`. The old shape collected the tenant's ENTIRE vault
// (every row, `text` blob included) to find at most a handful of profile rows, and timed out the
// 1s query budget on `status` once a vault grew. blueprint.ts:212 forbids cloning that shape;
// this is the site it was pointing at.
export async function currentProfileDoc(
  ctx: QueryCtx | MutationCtx,
  tenantId: string,
): Promise<Doc<"vaultDocuments"> | null> {
  const profiles = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_kind", (q) => q.eq("tenantId", tenantId).eq("kind", PROFILE_KIND))
    .collect();
  const newest = profiles
    .filter((d) => d.status !== "failed")
    .sort((a, b) => b.createdAt - a.createdAt);
  return newest[0] ?? null;
}

/**
 * WHEN this tenant finished onboarding — the FIRST committed profile doc, or `null` if none is.
 *
 * The OLDEST, deliberately, and NOT `currentProfileDoc().createdAt`. Onboarding completes once;
 * `/dashboard/profile` then edits the same concept for the life of the account, and the newest doc
 * moves forward with every edit. Reading the newest would make every measure that starts at
 * onboarding shrink each time the user touched their profile — and, in Phase 27's
 * `timeToFirstUsefulOutcome`, would report a real earlier outcome as `useful_precedes_onboarding`,
 * a reason reserved for a broken clock.
 *
 * Same index and same `failed` filter as `currentProfileDoc` above, for the reason recorded there:
 * `by_tenant_kind`, never `by_tenant`.
 */
export async function onboardingCompletedAt(
  ctx: QueryCtx | MutationCtx,
  tenantId: string,
): Promise<number | null> {
  const profiles = await ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_kind", (q) => q.eq("tenantId", tenantId).eq("kind", PROFILE_KIND))
    .collect();
  const committed = profiles.filter((d) => d.status !== "failed").map((d) => d.createdAt);
  return committed.length === 0 ? null : Math.min(...committed);
}

/**
 * ONBD-02 commit — and the design §6 COMPLETION GATE.
 *
 * The reviewed profile becomes a `business_profile` vault doc and is embedded via startIngest —
 * retrievable through searchVault / vaultGroundHydrated (SC#2), tenant-scoped so tenant A's profile
 * never reaches tenant B (SC#3).
 *
 * **First-time onboarding cannot complete while a required fact slot is empty (SC#3b).** The
 * guarantee lives HERE, in code, never in a prompt: "always ask about headcount" in a skill body is
 * a model-temperature guarantee, which is precisely the defect (1a) this phase exists to close. A
 * free-roaming conversation will sometimes get absorbed in the user's product idea and wrap up warm
 * and useless. The refusal is also what makes the tier splice below TOTAL — past this line there is
 * always a row, so the markdown can never project an `undefined` tier.
 *
 * `updateProfile` deliberately carries NO such gate — design §10 forbids forced re-onboarding of a
 * legacy tenant (SC#6c).
 *
 * Emits ONE insert-only audit (§3) whose payload is refs/counts/enums ONLY —
 * `{vaultDocId, fieldCount, tierSource}` — never a field value (§4, SC#4). The old
 * `personaConfirmed: true` is DELETED rather than corrected: the audit table is append-only, so a
 * historical row that claimed a confirmation cannot be repaired; the fix is to stop writing it.
 */
/**
 * BETA-03: is this tenant ready to be offered a first governed send, and to what address.
 *
 * A PROJECTION, NOT STATE. There is deliberately no onboarding-progress table, no `firstSendDone`
 * column and no checklist row — the whole answer is derived from rows that already exist, so
 * refreshing, navigating back, or signing in on another device cannot produce a stale checklist
 * that outlives the thing it describes. Phase 11/15.1's completion contract is untouched:
 * `missingSlots`, `canComplete`, `converse.done` and the saveFacts→commitProfile ordering all mean
 * exactly what they meant before.
 *
 * THE ADDRESS IS READ FROM THE AUTHENTICATED IDENTITY AND IS NOT AN ARGUMENT. This query takes no
 * args at all, which is the point: a first-send offer that accepted a recipient would be an open
 * relay wearing an onboarding hat.
 *
 * `users.email` is `v.optional`, so it can legitimately be absent — an OAuth profile that carried
 * no email claim, or a row created before the field was written. An absent address makes the offer
 * INELIGIBLE rather than falling back to anything; there is nothing safe to fall back to.
 *
 * `emailVerified` is reported, not enforced. A password signup's address is self-asserted
 * (`auth.ts` records email verification as the security fast-follow), and the first send goes to
 * that same self-asserted address — which is the one recipient for whom that is acceptable, since
 * it is the account holder writing to themselves. The flag exists so the UI can say so and so a
 * later plan can tighten it without having to rediscover the fact.
 */
export const firstSendOffer = tenantQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    eligible: boolean;
    recipient: string | null;
    emailVerified: boolean;
    reason: "ok" | "onboarding_incomplete" | "no_address";
  }> => {
    const user = await ctx.db.get(ctx.userId);
    const email = user?.email?.trim() ?? "";
    // Same predicate as `status.needsOnboarding` — IS that read, not a second copy of it.
    const onboarded = Boolean(await currentProfileDoc(ctx, ctx.tenantId));

    if (!onboarded) {
      return {
        eligible: false,
        recipient: null,
        emailVerified: false,
        reason: "onboarding_incomplete",
      };
    }
    if (!email) {
      return { eligible: false, recipient: null, emailVerified: false, reason: "no_address" };
    }
    return {
      eligible: true,
      recipient: email,
      emailVerified: typeof user?.emailVerificationTime === "number",
      reason: "ok",
    };
  },
});

export const commitProfile = tenantMutation({
  args: { profile: vProfile },
  handler: async (ctx, { profile }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    // Validated FIRST, same order as before this fix — an empty/whitespace `oneLineDescription` is
    // BOTH invalid (`validateProfile`) and a missing fact slot (`missingSlots`, below), and
    // `INVALID_PROFILE` is the more specific, actionable refusal of the two. `validateAndWriteProfile`
    // re-runs this same check right before the write; calling it here too is what lets this refusal
    // fire before the tier-completeness gate rather than after.
    const preCheck = validateProfile(profile);
    if (!preCheck.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: preCheck.errors });

    const row = await currentTierRow(ctx, ctx.tenantId);
    const missing = missingSlots({
      ...(row ?? {}),
      oneLineDescription: profile.oneLineDescription,
    });
    // `!row` is redundant at runtime (a missing row leaves all five fact slots missing) and is
    // there so the splice below type-checks without a non-null assertion. Both halves say the same
    // thing: there is no completion without facts.
    if (!row || missing.length > 0) {
      throw new ConvexError({ code: "INCOMPLETE_ONBOARDING", missing });
    }

    // §4.2 — the markdown is a PROJECTION, the table is the record. Validate-then-write, together —
    // see `validateAndWriteProfile`'s doc comment.
    const result = await validateAndWriteProfile(ctx, ctx.tenantId, {
      ...profile,
      persona: row.tier,
    });
    if (!result.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: result.errors });
    const { vaultDocId } = result;

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.profile_committed",
      actor: "user",
      payload: {
        vaultDocId,
        fieldCount: populatedFieldCount(profile),
        tierSource: row.tierSource,
      },
    });
    return { vaultDocId };
  },
});

/**
 * E2E HARNESS SEED — the ONLY way to reach the cockpit without a model call.
 *
 * Why it has to exist. Every `apps/web/e2e` spec lives behind the `(app)` auth gate AND behind
 * `status.needsOnboarding`, and a freshly signed-up user has neither a profile doc nor a tier row —
 * so all 25 specs land on `/dashboard/onboarding` and fail identically (measured: 1 passed,
 * 24 failed). The onboarding UI drives `converse`, which calls the model, so with no API credits
 * the entire UI suite is unreachable. `commitProfile` cannot stand in for this: it is a
 * `tenantMutation` and derives its tenant from a browser identity, which `npx convex run` does not
 * have. Hence internal + explicit `tenantId`, the `vaultSmoke.ts` idiom.
 *
 * `__` prefix + `internalMutation` is this repo's test-support convention (`__runSpecialistWithScript`
 * in dispatch.ts, `__runCockpitAgentWithScript` in llm.ts): a seam that ships in the production
 * module, reachable only from internal callers, never from a tenant surface.
 *
 * IT DELIBERATELY DOES NOT CALL `writeProfileDoc`, and that is the whole design. That helper ends in
 * `startIngest`, which embeds — a REAL OpenAI call. Without credits the ingest fails and flips the
 * row to `status: "failed"`, which `status` reads as *not onboarded*, so the seeder would
 * un-onboard the tenant it just seeded. The row is therefore inserted directly at `ready`, the
 * `vaultSmoke.insertBrief` shape, with NO rag entry.
 *
 * CONSEQUENCE, stated so no one debugs it twice: the seeded profile is BROWSABLE but NOT
 * RETRIEVABLE — it has no `ragEntryId`, so `searchVault` and `vaultGroundHydrated` will never
 * return it. Specs asserting the cockpit is GROUNDED IN the profile need a real commit and real
 * credits; specs asserting the cockpit RENDERS do not. This is also why it does not touch
 * `startIngest`: that call-site count in `vault.ts` is a counted exclusion invariant (5), and a
 * sixth from a seeder would corrupt the thing that count exists to protect.
 *
 * Idempotent: re-running patches rather than duplicating, so a re-seed cannot leave two profile
 * docs and make `currentProfileDoc`'s pick ambiguous.
 */
export const __seedOnboardedTenant = internalMutation({
  args: { tenantId: v.string() },
  handler: async (
    ctx,
    { tenantId },
  ): Promise<{ vaultDocId: Id<"vaultDocuments">; tier: string }> => {
    // The same fixture `extractProfile`'s SMOKE:: sentinel returns, so the seeded tenant and the
    // offline extraction path describe the same business rather than two invented ones.
    const profile = smokeProfileFixture();

    // The five tier facts `missingSlots` requires. Chosen to satisfy REQUIRED_SLOTS exactly;
    // `paidStaff: 0` is the solo signal and is a real ANSWER, not an absence (the SLOT_PRESENT rule).
    const facts = {
      headcount: 1,
      paidStaff: 0,
      revenueStage: "early-revenue",
      funding: "bootstrapped",
      yearsOperating: 2,
    } as const;
    // deriveTier is the ONLY writer of the tier (design §5) — never hardcode "solopreneur" here,
    // which is defect 1d in a new costume.
    const tier = deriveTier(facts);
    // 19-05: an onboarded tenant that cannot send is not an onboarded tenant. `executePlan` refuses
    // an email plan with `no_postal_address` and `gmail.send` refuses to build the CAN-SPAM footer
    // without one, so every e2e spec that approves an email plan needs this field on the harness
    // tenant. Seeded HERE, at the one tenant seeder, rather than in each spec.
    const postalAddress = "Pikar AI, 12 Samora Avenue, Dar es Salaam, Tanzania";

    const existingRow = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (existingRow) {
      await ctx.db.patch(existingRow._id, {
        ...facts,
        tier,
        tierSource: "derived",
        derivedAt: Date.now(),
        postalAddress: existingRow.postalAddress ?? postalAddress, // never clobber a real one
      });
    } else {
      await ctx.db.insert("tenantProfiles", {
        tenantId,
        ...facts,
        tier,
        tierSource: "derived",
        derivedAt: Date.now(),
        postalAddress,
      });
    }

    const full: BusinessProfile = { ...profile, persona: tier };
    const text = serializeProfile(full);
    const hash = await contentHash(text);
    const size = new TextEncoder().encode(text).length;
    const title = full.name || "Business profile";

    const existingDoc = await currentProfileDoc(ctx, tenantId);
    if (existingDoc) {
      await ctx.db.patch(existingDoc._id, {
        title,
        text,
        contentHash: hash,
        size,
        status: "ready",
        failureReason: undefined,
      });
      return { vaultDocId: existingDoc._id, tier };
    }
    const vaultDocId = await ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: PROFILE_KIND,
      category: categoryFor({ source: "agent" }),
      source: "agent",
      mimeType: "text/markdown",
      size,
      contentHash: hash,
      text,
      // `ready`, not `processing`: nothing will ever move it on, because nothing is ingesting it.
      status: "ready",
      createdAt: Date.now(),
    });
    return { vaultDocId, tier };
  },
});

/**
 * ONBD-02 edit. Re-embeds the tenant's profile on change so grounding stays current: the prior rag
 * entry is replaced (writeProfileDoc), and searchVault / vaultGroundHydrated return the updated
 * content. Falls back to a fresh commit when no profile doc exists yet (edit-before-commit is a
 * no-throw first commit).
 *
 * **No slot gate here (SC#6c).** A pre-15.1 tenant has a `tierSource: "legacy"` row with no facts at
 * all, and design §10 forbids forcing them back through onboarding — they must still be able to
 * correct their own profile. The gate lives on `commitProfile`, which such a tenant never reaches.
 *
 * A MISSING tier row is still fatal (`INCOMPLETE_FACTS`): after the plan-02 backfill every tenant
 * with a committed profile has one, so its absence means something is wrong — and defaulting to
 * `"solopreneur"` here would be defect 1d in a new costume.
 *
 * Same refs/counts/enums-only audit (§4, SC#4), tagged `reembed`. `personaConfirmed` is gone: on an
 * EDIT it was not merely redundant but FALSE — nothing was confirmed.
 */
export const updateProfile = tenantMutation({
  args: { profile: vProfile },
  handler: async (ctx, { profile }): Promise<{ vaultDocId: Id<"vaultDocuments"> }> => {
    // Same ordering rationale as `commitProfile`'s pre-check: validate first, so an invalid profile
    // reports `INVALID_PROFILE` even when the tenant also has no tier row.
    const preCheck = validateProfile(profile);
    if (!preCheck.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: preCheck.errors });

    const row = await currentTierRow(ctx, ctx.tenantId);
    if (!row) {
      // The same `missing` shape `commitProfile` reports, so one UI branch renders both.
      throw new ConvexError({
        code: "INCOMPLETE_FACTS",
        missing: missingSlots({ oneLineDescription: profile.oneLineDescription }),
      });
    }

    const existing = await currentProfileDoc(ctx, ctx.tenantId);
    // §4.2 — the markdown follows the TABLE, on an edit exactly as on a commit. Validate-then-write,
    // together — see `validateAndWriteProfile`'s doc comment.
    const result = await validateAndWriteProfile(
      ctx,
      ctx.tenantId,
      { ...profile, persona: row.tier },
      existing ?? undefined,
    );
    if (!result.ok) throw new ConvexError({ code: "INVALID_PROFILE", errors: result.errors });
    const { vaultDocId } = result;

    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: crypto.randomUUID(),
      eventType: "onboarding.profile_updated",
      actor: "user",
      payload: {
        vaultDocId,
        fieldCount: populatedFieldCount(profile),
        tierSource: row.tierSource,
        reembed: existing !== null,
      },
    });
    return { vaultDocId };
  },
});
