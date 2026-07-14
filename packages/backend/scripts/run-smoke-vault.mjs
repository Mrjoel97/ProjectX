// Live vault gate (VALT-01/03): the dev-deployment phase proof that convex-test cannot give (the
// rag/workflow components don't run under it). Drives the REAL embed + hybrid search + graph-expand
// grounding for tenant "smoke" against a running `convex dev` deployment (whose OPENAI_API_KEY
// covers the embedding call — RESEARCH). Mirrors run-smoke-fanout.mjs: must/pollPass from
// ./smokeRun.mjs, pass/fail judged by the CLI OUTPUT banner (never the exit code — Windows/Node24).
//
// Flow: seed two briefs sharing an entity (real rag.add) → poll until ready → assert the hybrid
// search returns a non-empty ranked result with the seed doc → assert vaultGround's live path merges
// the graph neighbor reached via the shared entity (proves hybrid vector+graph live) → assert NO raw
// brief text landed in any audit/deadLetters row (§4). A try/finally purges the seeded rows.
import { randomUUID } from "node:crypto";
import { must, pollPass } from "./smokeRun.mjs";

const parse = (out) => JSON.parse(out);
const TENANT = "smoke";
const needle = `VAULT-SECRET-${randomUUID().slice(0, 8)}`;

console.log(`[smoke:vault] seeding 2 briefs sharing an entity (real embed) — needle ${needle}`);
const { docIds, seedDocId, neighborDocId, query, shared } = parse(
  must("vaultSmoke:seedCorpus", { tenantId: TENANT, needle }),
);

try {
  console.log("[smoke:vault] polling: both briefs embedded + graph-extracted → ready...");
  await pollPass("vaultSmoke:assertReady", { tenantId: TENANT, docIds });

  console.log("[smoke:vault] asserting: REAL hybrid search returns a ranked result with the seed doc...");
  await pollPass("vaultSmoke:assertSearchReturns", { tenantId: TENANT, query, expectDocId: seedDocId });

  console.log(`[smoke:vault] asserting: vaultGround merges the "${shared}" graph neighbor (hybrid vector+graph)...`);
  await pollPass("vaultSmoke:assertGroundNeighbor", { tenantId: TENANT, query, neighborDocId });

  console.log("[smoke:vault] asserting: NO raw brief text in any audit/deadLetters row (§4)...");
  must("vaultSmoke:assertNoRawText", { tenantId: TENANT, needles: [needle, shared] });

  console.log("[smoke:vault] PASSED");
} finally {
  console.log("[smoke:vault] cleanup: purging seeded rows + rag entries + graph...");
  must("vaultSmoke:purge", { tenantId: TENANT, docIds });
}
