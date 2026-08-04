import { classifyReviewDecision, MAX_REGENERATE, notificationMessage } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via import.meta.glob; exclude *.test.ts.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// The escalate terminal's review.escalated audit hits the auditCounts aggregate; register
// the component so the REAL audit path runs (gmail.test.ts / cockpitTools.test.ts precedent).
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";

const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "user_esc";
const NOW = 1_800_000_000_000;

type T = ReturnType<typeof convexTest>;

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

async function seedRequest(t: T) {
  return await t.run(async (ctx) =>
    ctx.db.insert("requests", {
      tenantId: TENANT,
      correlationId: `cid-${crypto.randomUUID()}`,
      goal: "goal",
      recipient: "r@example.com",
      status: "awaiting_review",
      attachmentRefs: [],
      createdAt: NOW,
    }),
  );
}

describe("REVW-02 fail-closed review gate (classifyReviewDecision wiring)", () => {
  test("a regenerate AT the cap classifies as escalate, never proceed — the bug fix", () => {
    // The exact input the pipeline loop hands the classifier once the cap is reached.
    // Pre-fix, this path fell through to `break` → DELIVER (an unapproved send).
    expect(
      classifyReviewDecision({ decision: "regenerate", regenerateCount: MAX_REGENERATE }),
    ).toEqual({ action: "escalate", reason: "regenerate_limit" });
    // One below the cap still loops (unchanged behaviour).
    expect(
      classifyReviewDecision({ decision: "regenerate", regenerateCount: MAX_REGENERATE - 1 }),
    ).toEqual({ action: "regenerate" });
    // approve / edit_text proceed to DELIVER; reject terminates. None can escalate.
    expect(classifyReviewDecision({ decision: "approve", regenerateCount: 0 }).action).toBe(
      "proceed",
    );
    expect(classifyReviewDecision({ decision: "edit_text", regenerateCount: 0 }).action).toBe(
      "proceed",
    );
    expect(classifyReviewDecision({ decision: "reject", regenerateCount: 0 }).action).toBe(
      "terminate",
    );
  });

  test("the escalated terminal writes status + audit + notify + telemetry (the seam the loop composes)", async () => {
    const t = harness();
    const requestId = await seedRequest(t);
    const correlationId = `cid-esc-${crypto.randomUUID()}`;

    // The four mutations the pipeline's escalate terminal fires, in stopBlocked order.
    // If schema.ts / telemetry.ts weren't widened for "escalated", these arg validators throw.
    await t.mutation(internal.pipeline.setStatus, { requestId, status: "escalated" });
    await t.mutation(internal.audit.log, {
      tenantId: TENANT,
      correlationId,
      eventType: "review.escalated",
      actor: "system",
      payload: { requestId }, // refs-only (§4)
    });
    await t.mutation(internal.notifications.notify, {
      tenantId: TENANT,
      kind: "retry.limit",
      requestId,
      message: notificationMessage("retry.limit"),
    });
    await t.mutation(internal.telemetry.writeTerminal, {
      requestId,
      correlationId,
      outcome: {
        reviewOutcome: "escalated",
        durationMs: 1,
        decisionCounts: { regenerate: 4 },
        regenerateCount: 4,
        usages: [],
      },
    });

    // Status accepted "escalated" (schema + REQUEST_STATUS union widened).
    const req = await t.run((ctx) => ctx.db.get(requestId));
    expect(req?.status).toBe("escalated");

    // review.escalated audit present.
    const audits = await t.run((ctx) =>
      ctx.db
        .query("audit")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .collect(),
    );
    expect(audits.some((a) => a.eventType === "review.escalated")).toBe(true);

    // retry.limit notification present, static §4 label (no interpolated content).
    const notes = await t.run((ctx) => ctx.db.query("notifications").collect());
    const note = notes.find((n) => n.requestId === requestId);
    expect(note?.kind).toBe("retry.limit");
    expect(note?.message).toBe(notificationMessage("retry.limit"));

    // Exactly one telemetry row, reviewOutcome escalated (write-once terminal).
    const tels = await t.run((ctx) =>
      ctx.db
        .query("telemetry")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .collect(),
    );
    expect(tels).toHaveLength(1);
    expect(tels[0]?.reviewOutcome).toBe("escalated");
  });
});
