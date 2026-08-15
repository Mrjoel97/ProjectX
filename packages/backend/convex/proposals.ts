// The applier — the ONLY place a proposed fact reaches a target store. It NEVER writes a target
// store via `ctx.db`: every write goes through that store's existing single writer
// (`applyFinanceClaims`, `writeProfileDoc`), so every validator, range check, consent rule and
// provenance stamp that guards a manual entry guards a proposal-applied one too, by construction —
// there is no second route in. The only `ctx.db` write here is the `proposals` row's own `status`.
//
// TWO PASSES, matching `applyFinanceClaims`'s discipline (cash.ts): validate every accepted item
// with zero writes, then write. A `return` does NOT roll back a Convex transaction — only a throw
// does — so a refusal discovered mid-write would leave the batch half-applied.
import {
  type BusinessProfile,
  type CashInputField,
  type CurrentValue,
  classifyProposal,
  deserializeProfile,
  type FigureClaim,
  proposalTarget,
} from "@pikar/core";
import { v } from "convex/values";
import { applyFinanceClaims, inputStatesFor } from "./cash";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { currentProfileDoc, writeProfileDoc } from "./onboarding";

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

    // `i` was checked against `row.items.length` and de-duplicated in the loop above, so this
    // lookup cannot miss — but `noUncheckedIndexedAccess` still types it as possibly `undefined`.
    const itemAt = (i: number) => {
      const item = row.items[i];
      if (item === undefined) throw new Error("unreachable: acceptedIndices was pre-validated");
      return item;
    };
    const chosen = acceptedIndices.map((i) => {
      const item = itemAt(i);
      return {
        ...item,
        value: editByIndex.get(i) ?? item.value,
        // §3.2: `actor` is a fact about which DOOR the write came through, not data to be read off
        // a content-plane row. The applier IS the agent door, so it is STAMPED. A stored item
        // claiming `actor: "user"` is a staging bug or a lie; either way it is overwritten.
        actor: "agent" as const,
      };
    });
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
      // The ONE read of "what is stored and who said it" — the same call the finance page renders
      // from (cash.ts's own doc comment). No second definition to drift.
      const states = (await inputStatesFor(ctx, ctx.tenantId, Date.now())).inputs;
      const byField = new Map(states.map((s) => [s.field, s]));
      const claims: FigureClaim[] = [];
      for (const f of financeFacts) {
        const state = byField.get(f.target.field as CashInputField);
        const current: CurrentValue | null =
          state === undefined || state.value === null
            ? null
            : {
                value: state.value,
                statedByUser: state.actor === "user",
                statedAt: state.statedAt,
              };
        const guard = classifyProposal(
          {
            target: f.target,
            value: f.value,
            confidence: f.confidence,
            origin: f.origin,
            actor: f.actor,
            basis: f.basis,
            observedAt: f.observedAt,
            sourceLocator: f.sourceLocator,
          },
          current,
        );
        // Staleness is a temporal-correctness fact, not a consent question — no explicit click can
        // make an old fact newer than what is stored. `applyFinanceClaims` enforces this too
        // (isNewerThan); dropping it here keeps `skipped` honest even for a batch that never
        // reaches the writer because every remaining claim was stale.
        if (guard === "stale") {
          skipped += 1;
          continue;
        }
        claims.push({
          field: f.target.field as CashInputField,
          value: f.value as number,
          origin: f.origin,
          actor: f.actor,
          basis: f.basis,
          observedAt: f.observedAt,
          confidence: f.confidence,
        });
      }
      if (claims.length > 0) {
        const result = await applyFinanceClaims(ctx, ctx.tenantId, claims);
        if (!result.ok) return { ok: false, reason: "writer_refused" };
        applied += result.applied;
        skipped += result.skipped;
      }
    }

    const profileFacts = chosen.filter((f) => f.target.store === "profile");
    if (profileFacts.length > 0) {
      const existingDoc = await currentProfileDoc(ctx, ctx.tenantId);
      const existingProfile: BusinessProfile = existingDoc?.text
        ? deserializeProfile(existingDoc.text)
        : {
            name: "",
            oneLineDescription: "",
            persona: "solopreneur",
            stage: "",
            offering: "",
            targetCustomer: "",
            primaryGoals: [],
            knownConstraints: [],
          };
      // Merge ONLY the proposed fields over the existing profile — a field nobody proposed stays
      // absent, never becomes "".
      // ponytail: a straight per-field assignment. Two registry targets (`revenueModel`,
      // `bindingConstraint`) have no home on `BusinessProfile` yet (blueprint.ts: "nothing types
      // them today"), so a proposal for either lands on the merged object but `serializeProfile`
      // silently drops it on write. Upgrade path: widen `BusinessProfile` when a caller needs to
      // persist them.
      const merged = { ...existingProfile } as Record<string, unknown>;
      for (const f of profileFacts) merged[f.target.field] = f.value;
      await writeProfileDoc(
        ctx,
        ctx.tenantId,
        merged as unknown as BusinessProfile,
        existingDoc ?? undefined,
      );
      applied += profileFacts.length;
    }

    await ctx.db.patch(proposalId, { status: "accepted" });
    return { ok: true, applied, skipped };
  },
});

export const discardProposal = tenantMutation({
  args: { proposalId: v.id("proposals") },
  handler: async (
    ctx,
    { proposalId },
  ): Promise<{ ok: true } | { ok: false; reason: ProposalRefusal }> => {
    const row = await ctx.db.get(proposalId);
    if (!row || row.tenantId !== ctx.tenantId) return { ok: false, reason: "not_found" };
    if (row.status !== "pending") return { ok: false, reason: "not_pending" };
    await ctx.db.patch(proposalId, { status: "discarded" });
    return { ok: true };
  },
});

export const listPending = tenantQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("proposals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "pending"))
      .collect(),
});
