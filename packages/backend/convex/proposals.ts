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
  type ProposalGuard,
  proposalTarget,
} from "@pikar/core";
import { v } from "convex/values";
import { applyFinanceClaims, inputStatesFor } from "./cash";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { currentProfileDoc, currentTierRow, writeProfileDoc } from "./onboarding";

export type ProposalRefusal =
  | "not_found"
  | "not_pending"
  | "unknown_item"
  | "unknown_target"
  | "writer_refused"
  // A profile fact was accepted for a tenant with no `tenantProfiles` row yet. Distinct from
  // `writer_refused`: this is not a consent problem, it is a missing FACT this function will not
  // guess — `persona`/tier has no honest default, so `writeProfileDoc` is never called without one.
  // Mirrors `updateProfile`'s own `INCOMPLETE_FACTS` refusal for the same missing row.
  | "incomplete_facts";

type AcceptResult =
  | { ok: true; applied: number; skipped: number; guards: Record<ProposalGuard, number> }
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

    const financeFacts = chosen.filter(
      (f) => f.target.store === "financeInputs" || f.target.store === "scorecard",
    );
    const profileFacts = chosen.filter((f) => f.target.store === "profile");

    // Still PASS 1 — a READ, not a write. HOISTED here (fix round 2, finding A): this gate used to
    // sit inside PASS 2, AFTER the finance write block below. A batch mixing finance and profile
    // facts, for a tenant with no `tenantProfiles` row, would run `applyFinanceClaims` to completion
    // — committing figure rows and the `finance.claims_applied` audit insert — and only THEN hit
    // this refusal. A `return` does not roll back a Convex transaction (see the file header), so the
    // finance half would stay written while the mutation reported a refusal and left `status`
    // `"pending"` — re-acceptable, which would double-apply the already-written finance facts on a
    // retry. PASS 1 exists precisely so every refusal is cheap and total; a tier check is a read, so
    // it belongs here, before any writer runs — same reasoning as the loop just above.
    const tierRow = profileFacts.length > 0 ? await currentTierRow(ctx, ctx.tenantId) : null;
    if (profileFacts.length > 0 && !tierRow) return { ok: false, reason: "incomplete_facts" };

    // ── PASS 2: every item cleared; now read current state, classify, and write. ─────────────
    let applied = 0;
    let skipped = 0;
    // Reporting only — see the doc comment above `classifyProposal`'s call below. Never gates a
    // write here; `applyFinanceClaims` is the sole authority on whether a claim is too old to apply.
    const guards: Record<ProposalGuard, number> = { blank: 0, overwrite: 0, stale: 0 };

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
        // Classified for REPORTING only (a future UI can render "N of these overwrite a stated
        // figure"), never to gate the write: `acceptedIndices` IS the deliberate click design §6.1
        // asks for, so a non-blank guard does not refuse here. Staleness in particular must not be
        // enforced a second time in THIS function — `applyFinanceClaims` already skips a stale claim
        // at write time (cash.ts, `isNewerThan`), inside the same transaction that reads the
        // authoritative stored time; a second, separately-derived "is this stale" here would be two
        // implementations of one rule with no guarantee they keep agreeing (ruling 2026-08-15,
        // fix round 1). Also redundant BY CONSTRUCTION for `profile` (not reached in this branch):
        // its `CurrentValue.statedAt` is always `null`, so `classifyProposal` can never return
        // `"stale"` for it.
        guards[
          classifyProposal(
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
          )
        ] += 1;
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
        // The skipped count comes ONLY from what `applyFinanceClaims` actually reports — never from
        // a pre-pass guess — so the two can never disagree about what was skipped and why.
        applied += result.applied;
        skipped += result.skipped;
      }
    }

    if (profileFacts.length > 0) {
      // `tierRow` was read and gated on in PASS 1 above (`profileFacts.length > 0` here is the same
      // condition that gated it there, so this cannot miss) — re-checked rather than asserted with
      // `!`, mirroring `itemAt`'s pattern, because `noUncheckedIndexedAccess`-style correlation
      // across two variables is not something the type-checker tracks on its own.
      if (!tierRow) throw new Error("unreachable: profile facts were gated on tierRow in PASS 1");

      const existingDoc = await currentProfileDoc(ctx, ctx.tenantId);
      const existingProfile: BusinessProfile = existingDoc?.text
        ? deserializeProfile(existingDoc.text)
        : {
            name: "",
            oneLineDescription: "",
            persona: tierRow.tier,
            stage: "",
            offering: "",
            targetCustomer: "",
            primaryGoals: [],
            knownConstraints: [],
          };
      // Merge ONLY the proposed fields over the existing profile — a field nobody proposed stays
      // absent, never becomes "". `persona` is always the FRESH tier (§4.2: the markdown is a
      // projection, `tenantProfiles` is the record), matching `updateProfile`'s own splice — never
      // trusted off a possibly-stale doc. `PROPOSAL_TARGETS` only ever names a real `BusinessProfile`
      // key here (proposal.ts's `PROFILE_WRITABLE_FIELDS` intersection), so this assignment can no
      // longer silently drop a field the way an unwritable target once did.
      const merged = { ...existingProfile, persona: tierRow.tier } as Record<string, unknown>;
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
    return { ok: true, applied, skipped, guards };
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
