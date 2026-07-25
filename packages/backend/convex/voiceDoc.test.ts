// Voice-doc discussion (DOCV-01) — convex-test. Wave-0 coverage: this file exists to prove the
// 14-01 schema widening actually reached the SCHEMA-DERIVED write validator, with zero edits to
// `insertEvaluation`. SC1 / SC2 / BETA-05 assertions land here in plans 14-03 and 14-05.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// The evaluation write path's refs-only audit hits the auditCounts aggregate; register the
// component (relative import — the package blocks the deep specifier), the evaluations.test.ts idiom.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { DOC_REVIEW_FRAMEWORK, voiceDocThreadId } from "@pikar/voice";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_a";
const TENANT_B = "tenant_b";

function newTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

// ── 14-03: the doc-scoped retrieval action (SC1 drill-in · SC4 refs-only audit · BETA-05) ────────
//
// Everything below rides the `SMOKE::<docId,…>` grounding seam that `vaultGround.ts` already
// honours: the sentinel bypasses `rag.search` entirely (no embedding network, no OPENAI_API_KEY)
// and resolves the seed doc ids through the TENANT-SCOPED `internal.vault.ownedDocsMeta` — which is
// exactly why a cross-tenant seed drops out here the same way `namespace = tenantId` would exclude
// it in a real search. That is what makes the BETA-05 assertion below a real isolation proof rather
// than an assertion about an error string.

const REPORT_TEXT =
  "Churn rose to 9% in Q3, concentrated in the self-serve tier.\n\n" +
  "Exit interviews cite setup friction in 7 of 9 cancellations.\n\n" +
  "Enterprise renewals held at 96% with no discounting.";

const OTHER_TEXT = "Warehouse throughput fell 12% after the Leeds depot move.";

/** A groundable (`ready`, non-blank text) vault doc — the only shape startSession will accept. */
function seedReadyDoc(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  text: string,
  title = "Q3 Performance Report",
): Promise<Id<"vaultDocuments">> {
  return t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: "upload",
      category: "business",
      source: "seam",
      mimeType: "text/markdown",
      size: text.length,
      contentHash: `hash_${Math.random().toString(36).slice(2)}`,
      text,
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
}

const asTenant = (t: ReturnType<typeof convexTest>, subject: string) => t.withIdentity({ subject });

/** Open a doc-scoped session through the REAL public entry point (so the docRef guard runs too). */
async function startDocSession(
  t: ReturnType<typeof convexTest>,
  tenantId: string,
  docRef: Id<"vaultDocuments">,
): Promise<Id<"voiceSessions">> {
  const { sessionId } = await asTenant(t, tenantId).mutation(api.voice.startSession, {
    callId: `call_${tenantId}`,
    docRef,
  });
  return sessionId;
}

describe("voiceDoc.searchDocument (SC1 — the mid-call drill-in)", () => {
  test("returns passages from THIS document, offline over the SMOKE:: seam", async () => {
    const t = newTest();
    const docId = await seedReadyDoc(t, TENANT, REPORT_TEXT);
    const sessionId = await startDocSession(t, TENANT, docId);

    const res = await asTenant(t, TENANT).action(api.voiceDoc.searchDocument, {
      sessionId,
      query: `SMOKE::${docId}`,
    });

    expect(res.found).toBe(true);
    expect(res.passages.length).toBeGreaterThan(0);
    // An answer the agent did NOT have at connect — grounded in the report's own words.
    expect(res.passages.join("\n")).toContain("setup friction");
  });
});

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
