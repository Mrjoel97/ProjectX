/**
 * The media LANDING plane (MEDIA-01, D10, plan 20-06) — the terminal for a fal callback.
 *
 * A sibling terminal module, the `calendarComplete.ts` rule: `media.ts` owns the submit and this
 * file owns the landing, so the two halves of a job's lifecycle can be reasoned about — and
 * statically scanned — separately.
 *
 * **This module and `media.ts` are the ONLY writers of a terminal `mediaJobs.status`, and
 * `"succeeded"` is reachable from HERE ALONE.** That is a deliberate CORRECTION to research's SC2
 * line, which says the webhook is the only writer of `succeeded`/`failed`/`blocked`: a 422
 * `content_policy_violation` is **synchronous at submit** and produces no webhook at all, so
 * `media.ts` must be able to write `blocked`/`failed`. Both halves are pinned by a scan in
 * `llmRedaction.test.ts`.
 *
 * NOT "use node" — this is an internalQuery + an internalMutation, and `http.ts` (which holds the
 * route) cannot be "use node" either.
 */
import { onCompleteValidator } from "@convex-dev/action-retrier";
import type { MediaSpec, VideoRes } from "@pikar/cost/media";
import { estimateMediaUsd } from "@pikar/cost/media";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { hmacHex } from "./gmailAuth";
import { rateLimiter } from "./guardrails";

/** A row past this point is finished. Re-delivery of its webhook must change NOTHING — fal's retry
 *  policy is undocumented, so at-least-once is the only safe assumption. */
const TERMINAL = new Set<Doc<"mediaJobs">["status"]>(["succeeded", "failed", "blocked"]);

export type ResolvedJob = {
  jobId: Id<"mediaJobs">;
  tenantId: string;
  planId: Id<"plans">;
  batchId: string;
  kind: Doc<"mediaJobs">["kind"];
  model: string;
  terminal: boolean;
};

/**
 * Prove the caller knows the secret we minted for THIS job, then hand the route the row's own
 * facts. Returns `null` for every refusal — the route turns that into one 401 with no detail.
 *
 * **Everything security-relevant comes from the ROW.** `tenantId`, `planId`, `kind` and `model` are
 * read here and never taken from the callback body — the `/skillopt/writeback` rule verbatim
 * (`http.ts:123-129`): a body-supplied tenant is attacker-controllable and is a cross-tenant write.
 */
export const resolveJob = internalQuery({
  args: { raw: v.string(), digest: v.string() },
  handler: async (ctx, { raw, digest }): Promise<ResolvedJob | null> => {
    // FAIL CLOSED on the env, and this is the ONLY copy of that guard on purpose. A second one at
    // the route would make the mutation check for this one vacuous, and this is the place that
    // matters: without it `hmacHex(raw, "")` still yields a digest, which anyone can compute.
    const secret = process.env.FAL_WEBHOOK_SECRET;
    if (!secret) return null;

    // A malformed or FOREIGN-TABLE id must never reach `ctx.db.get` — `normalizeId` returning null
    // is the fail-closed shape (`schema.ts:1034`, where 20-02 recorded this exact contract).
    const jobId = ctx.db.normalizeId("mediaJobs", raw);
    if (!jobId) return null;

    // `gmailAuth.verifyState:70`'s comparison verbatim, including the plain `===`. That precedent
    // has guarded the OAuth `state` in production since Phase 2; introducing a second, different
    // HMAC-comparison idiom here would be the thing to justify, not this.
    if (digest !== (await hmacHex(raw, secret))) return null;

    const row = await ctx.db.get(jobId);
    if (!row) return null;
    return {
      jobId,
      tenantId: row.tenantId,
      planId: row.planId,
      batchId: row.batchId,
      kind: row.kind,
      model: row.model,
      terminal: TERMINAL.has(row.status),
    };
  },
});

/**
 * Kinds whose spend is a pure function of what WE SUBMITTED, so actual == estimate BY CONSTRUCTION.
 *
 * `fal-ai/inworld-tts` bills per **submitted character**, and its response carries no duration and
 * no character count; `scribe-v2` bills per **input audio minute**, of audio we generated and
 * therefore already measured. There is literally nothing to reconcile.
 *
 * **This is NOT an optimisation and NOT a trust decision.** Re-pricing here would mean INVENTING an
 * actual from a value the provider never returned — the exact guess this whole phase forbids. The
 * difference is visible in the audit: a member lands `reconciled: "exact_by_construction"`, a
 * non-member lands `"repriced"`, and a non-member the table could not price lands
 * `"reprice_failed"`. **Reconciliation with nothing to reconcile is SKIPPED, not FAKED.**
 */
export const EXACT_SPEND_KINDS = new Set<string>(["tts", "stt"]);

/** 24 kHz mono 16-bit PCM. The submit arm PINS `sample_rate_hertz` to 24000 precisely so this
 *  constant can be a constant — if that pin is ever removed, this number is wrong. */
const TTS_BYTES_PER_SECOND = 48_000;
/** A voice take may run slightly past its clip; the render ducks and pads. Two seconds is slack for
 *  a trailing consonant, not a licence to overrun a block. */
const TAKE_OVERRUN_GRACE_S = 2;

/** What fal said it actually produced. Every field OPTIONAL because absence is the normal case —
 *  Wan 2.5's success payload carries `{url, content_type, file_name, file_size}` and no dimensions
 *  at all, and an absent field means the submitted spec stands, never a zero. */
const actualValidator = v.object({
  resolution: v.optional(v.string()),
  seconds: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});
type Actual = { resolution?: string; seconds?: number; width?: number; height?: number };

/** Re-price from the SAME `@pikar/cost/media` table the estimate came from, using what fal actually
 *  produced. `null` means the table could not price it — which is recorded as `reprice_failed`, not
 *  quietly swallowed. */
function repriceUsd(row: Doc<"mediaJobs">, actual: Actual | undefined): number | null {
  let spec: MediaSpec;
  if (row.spec.kind === "video") {
    spec = {
      kind: "video",
      model: row.model,
      // An UNTRUSTED string off the payload, and passing it straight to the table is deliberate:
      // a value the table does not price returns `unknown_model`, which surfaces as
      // `reprice_failed` with the resolution in the audit — rather than silently falling back to
      // the tier we submitted and hiding the drift.
      resolution: (actual?.resolution ?? row.spec.resolution) as VideoRes,
      seconds: actual?.seconds ?? row.spec.seconds,
    };
  } else if (row.spec.kind === "image") {
    spec = {
      kind: "image",
      model: row.model,
      width: actual?.width ?? row.spec.width,
      height: actual?.height ?? row.spec.height,
    };
  } else {
    return null;
  }
  const priced = estimateMediaUsd(spec);
  return priced.ok ? priced.value : null;
}

/** The effective resolution ref for the audit — the ACTUAL when fal named one, so a tier drift is
 *  visible in the log plane rather than only in the invoice. */
function resolutionRef(row: Doc<"mediaJobs">, actual: Actual | undefined): string | undefined {
  if (row.spec.kind !== "video") return undefined;
  return actual?.resolution ?? row.spec.resolution;
}

/**
 * The terminal. Writes the row, reconciles the spend, and emits exactly ONE audit line.
 *
 * **The verdict is the honest four (research §3) and is derived ONLY from what the provider
 * actually said.** `none_reported` means the provider reported NOTHING. **It is not "clean".**
 * Every Wan 2.5 video and every TTS take lands here — neither model publishes a per-output
 * moderation field. Rendering it as a pass would be a compliance claim fal never made. Do not add a
 * fifth value meaning "probably fine".
 */
export const landResult = internalMutation({
  args: {
    jobId: v.id("mediaJobs"),
    outcome: v.union(
      v.object({
        ok: v.literal(true),
        assetStorageId: v.id("_storage"),
        assetHash: v.string(),
        mimeType: v.string(),
        bytes: v.number(),
        // `null` = the response carried NO moderation field. Never collapse it into `false`.
        moderation: v.union(v.boolean(), v.null()),
        actual: v.optional(actualValidator),
      }),
      v.object({ ok: v.literal(false), code: v.string() }),
    ),
  },
  handler: async (ctx, { jobId, outcome }): Promise<null> => {
    const row = await ctx.db.get(jobId);
    if (!row) return null;
    // IDEMPOTENCY. A re-delivered webhook stores nothing a second time and consumes nothing a
    // second time — the store already happened upstream, but the spend and the audit are here.
    if (TERMINAL.has(row.status)) return null;

    const updatedAt = Date.now();
    // The row's own share of the reservation. Note the BATCH floor was applied once, across all
    // lines plus the render line, so this is not "the reserved amount" — it is this row's estimate.
    const estCents = Math.round(row.estUsd * 100);

    const audit = (payload: Record<string, unknown>) =>
      ctx.runMutation(internal.audit.log, {
        tenantId: row.tenantId,
        correlationId: row.batchId,
        eventType: "media.landed",
        actor: "fal",
        payload: {
          jobId,
          batchId: row.batchId,
          planId: row.planId,
          falRequestId: row.falRequestId,
          kind: row.kind,
          model: row.model,
          promptHash: row.promptHash,
          estCents,
          ...payload,
        },
      });

    const landFailure = async (code: string) => {
      await ctx.db.patch(jobId, { status: "failed", failureReason: code, updatedAt });
      await audit({ failureReason: code });
      return null;
    };

    if (!outcome.ok) return await landFailure(outcome.code);

    // 20-14 — the SECOND net under an over-long voice take, and only the second.
    //
    // ponytail: a byte-count heuristic, not a measurement. 24 kHz mono 16-bit PCM is ~48 KB/s, so
    // bytes / TTS_BYTES_PER_SECOND is a duration ESTIMATE. It catches a grossly over-long take before
    // the sandbox ever sees it, at the cost of one division. It does NOT replace the 140-character
    // pre-flight ceiling, which is the only check that runs BEFORE money moves — by the time this
    // runs the take is already paid for. A compressed container reads far smaller per second and
    // will simply not trip it, which is the safe direction for a heuristic. Upgrade path if it ever
    // fires falsely: read the WAV header's byte rate instead of assuming it.
    //
    // Failing the line leaves the reel un-renderable rather than producing a reel with a word cut
    // off — D8's hard-error direction.
    if (row.spec.kind === "tts") {
      // No `clipSeconds` means no window to measure against, so there is NOTHING to compare and the
      // net is skipped — never "0 seconds, therefore too long", which would fail every take on a
      // plan shape this phase did not write.
      const clipSeconds = (await ctx.db.get(row.planId))?.clipSeconds;
      const budgetSeconds = clipSeconds === undefined ? null : clipSeconds + TAKE_OVERRUN_GRACE_S;
      if (budgetSeconds !== null && outcome.bytes / TTS_BYTES_PER_SECOND > budgetSeconds) {
        return await landFailure("take_too_long");
      }
    }

    const verdict =
      outcome.moderation === null
        ? ("none_reported" as const)
        : outcome.moderation
          ? ("checker_flagged" as const)
          : ("checker_clear" as const);

    let actualCents = estCents;
    let reconciled = "exact_by_construction";
    if (!EXACT_SPEND_KINDS.has(row.kind)) {
      const usd = repriceUsd(row, outcome.actual);
      if (usd === null) {
        reconciled = "reprice_failed";
      } else {
        reconciled = "repriced";
        actualCents = Math.round(usd * 100);
      }
    }

    await ctx.db.patch(jobId, {
      status: "succeeded",
      verdict,
      assetStorageId: outcome.assetStorageId,
      assetHash: outcome.assetHash,
      mimeType: outcome.mimeType,
      bytes: outcome.bytes,
      actualCents,
      updatedAt,
    });

    // ONLY a POSITIVE delta is consumed, on BOTH windows, with the same `reserve: true` the
    // reservation used. `actual <= est` consumes nothing and REFUNDS nothing — plan 20-04's
    // `ponytail:` no-refunds rule; the argument lives there, this is the pointer. The 2x voice
    // over-reservation is therefore never returned, which is intended: it is the rewrite budget,
    // and it is $0.012.
    const delta = actualCents - estCents;
    if (delta > 0) {
      await rateLimiter.limit(ctx, "mediaSpendCents", {
        key: row.tenantId,
        count: delta,
        reserve: true,
      });
      await rateLimiter.limit(ctx, "deploymentMediaSpendCents", { count: delta, reserve: true });
    }

    // Hoisted rather than inlined so that NO value inside an audit-payload literal in this module
    // contains a comma. That keeps `llmRedaction.test.ts`'s allow-list scan a simple split instead
    // of a depth-tracking parser — the code bends to make the guard cheap, not the other way round.
    const resolution = resolutionRef(row, outcome.actual);
    await audit({ assetHash: outcome.assetHash, verdict, actualCents, reconciled, resolution });
    return null;
  },
});

/**
 * The action-retrier terminal for the SUBMIT run (plan 20-07's `EXTERNAL_TARGETS.media`).
 *
 * **It does NOT land assets — the webhook does — and it does NOT render.** Its only job is the
 * failure case: when the retrier finally gives up, a batch that never reached fal would otherwise
 * sit at `queued` forever while `plans.renderStatus` said `pending`, and the canvas would promise a
 * reel that will never arrive. So it fails the still-`queued` rows with a code and says so on the
 * plan.
 *
 * A SUCCESS is deliberately a no-op here: `submitBatch` already recorded every line's outcome, and
 * the rows it left at `submitted` are waiting on the webhook, not on this.
 *
 * The retrier terminal receives ONLY `{runId, result}` — no context bag (verified against
 * `@convex-dev/action-retrier@0.3.1`'s `RunOptions`), so the run id is the sole correlation handle.
 * `plans.by_media_run` is what makes it resolvable, exactly as `by_calendar_run` does for calendar.
 * Rows already at `submitted` are LEFT ALONE: they reached fal, and their webhook may still land.
 */
export const onSubmitComplete = internalMutation({
  args: onCompleteValidator,
  handler: async (ctx, { runId, result }): Promise<void> => {
    if (result.type === "success") return;

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_media_run", (q) => q.eq("mediaRunId", String(runId)))
      .unique();
    if (!plan) return;

    // A CODE, never the retrier's error string — it can carry a URL or an env name (§4).
    const code = result.type === "canceled" ? "submit_canceled" : "submit_failed";
    for (const row of await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan", (q) => q.eq("tenantId", plan.tenantId).eq("planId", plan._id))
      .collect()) {
      if (row.status !== "queued") continue; // `submitted` reached fal; its webhook may still land
      await ctx.db.patch(row._id, {
        status: "failed",
        failureReason: code,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(plan._id, { renderStatus: "failed", renderReason: code });
  },
});
