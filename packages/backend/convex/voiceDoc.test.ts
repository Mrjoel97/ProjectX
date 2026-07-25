// Voice-doc discussion (DOCV-01) — convex-test. Wave-0 coverage: this file exists to prove the
// 14-01 schema widening actually reached the SCHEMA-DERIVED write validator, with zero edits to
// `insertEvaluation`. SC1 / SC2 / BETA-05 assertions land here in plans 14-03 and 14-05.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// The evaluation write path's refs-only audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier), the evaluations.test.ts idiom.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { DOC_REVIEW_FRAMEWORK, voiceDocThreadId } from "@pikar/voice";
import { internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";

function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

describe("document-review evaluations row", () => {
  test("insertEvaluation accepts the widened framework literal, with zero evaluations.ts edits", async () => {
    const t = newTest();
    const threadId = voiceDocThreadId("session_1");

    await t.mutation(internal.evaluations.insertEvaluation, {
      tenantId: TENANT,
      threadId,
      framework: DOC_REVIEW_FRAMEWORK,
      findings: [
        {
          label: "Churn is attributed to onboarding, not price",
          section: "findings",
          citationDocId: "doc_1",
          citationTitle: "Q3 Performance Report",
          // The persisted half of the LOCKED citation decision — a capped, verified quote.
          citationExcerpt: "Exit interviews cite setup friction in 7 of 9 cancellations.",
          confidence: "high",
          source: "vault",
        },
      ],
      gaps: [],
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict: "gaps",
    });

    const row = await t.query(internal.evaluations.lastForThread, { tenantId: TENANT, threadId });
    expect(row).not.toBeNull();
    expect(row?.framework).toBe("document-review");
    expect(row?.threadId).toBe("voice-doc:session_1");
  });

  test("citationExcerpt is optional — an absent excerpt is a valid, non-degraded finding", async () => {
    const t = newTest();
    const threadId = voiceDocThreadId("session_2");

    await t.mutation(internal.evaluations.insertEvaluation, {
      tenantId: TENANT,
      threadId,
      framework: DOC_REVIEW_FRAMEWORK,
      findings: [
        {
          label: "Revenue concentration in two accounts",
          section: "findings",
          citationDocId: "doc_1",
          citationTitle: "Q3 Performance Report",
          confidence: "medium",
          source: "vault",
        },
      ],
      gaps: [],
      notEnoughData: [],
      scorecard: {},
      userProvided: [],
      verdict: "gaps",
    });

    const row = await t.query(internal.evaluations.lastForThread, { tenantId: TENANT, threadId });
    expect(row?.findings[0]?.citationExcerpt).toBeUndefined();
    // Absent, not empty-string: the render path branches on presence.
    expect(row?.findings[0]).not.toHaveProperty("citationExcerpt");
  });
});
