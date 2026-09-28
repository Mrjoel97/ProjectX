// Disposable, loopback-only fixture for a CLI-driven authenticated vertical review.
// No admin key, JWT, password or artifact prose is printed. The Phase 49 stack owns cleanup.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { internal } from "@pikar/backend/api";
import { ConvexHttpClient } from "convex/browser";
import { OWNERSHIP_MARKER } from "./phase49-stack-lifecycle.mjs";

const [mode, suppliedRoot, email, artifactId] = process.argv.slice(2);
if (
  !["invite", "artifact", "verify"].includes(mode) ||
  !suppliedRoot ||
  !/^phase30-[a-f0-9-]+@example\.test$/.test(email ?? "") ||
  (mode === "verify" && !artifactId)
)
  throw new Error(
    "expected invite|artifact|verify, exact disposable root and synthetic example.test email",
  );
const root = realpathSync(suppliedRoot);
const fromTemp = relative(tmpdir(), root);
if (
  !/^pikar-phase49-[A-Za-z0-9]+$/.test(basename(root)) ||
  !fromTemp ||
  fromTemp.startsWith("..") ||
  dirname(root) !== realpathSync(tmpdir()) ||
  !existsSync(join(root, OWNERSHIP_MARKER))
)
  throw new Error("fixture requires an owned disposable Phase 49 root");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
if (
  !/^phase49-[a-f0-9]{12}$/.test(config.deploymentName ?? "") ||
  config.ports?.cloud !== 3410 ||
  config.ports?.site !== 3411 ||
  typeof config.adminKey !== "string"
)
  throw new Error("fixture config is not the expected local instance");
const origin = "http://127.0.0.1:3410";
const identity = await fetch(`${origin}/instance_name`);
if (!identity.ok || (await identity.text()) !== config.deploymentName)
  throw new Error("disposable instance identity mismatch");
const client = new ConvexHttpClient(origin);
client.setAdminAuth(config.adminKey);

if (mode === "invite") {
  const invite = await client.mutation(internal.invites.__seedInvite, { email });
  process.stdout.write(`invite=${invite.code}\n`);
} else if (mode === "artifact") {
  const found = await client.query(internal.owner.findUserIdByEmailForProvisioning, { email });
  const tenantId = found.result?.userId;
  if (!tenantId) throw new Error("synthetic browser signup has not completed");
  await client.mutation(internal.owner.bootstrapOwner, { userId: tenantId });
  await client.mutation(internal.onboarding.__seedOnboardedTenant, { tenantId });
  await client.mutation(internal.skills.seedVerticalCandidates, {});
  const candidate = await client.query(internal.skills.getSkillVersion, {
    name: "vertical-product",
    version: 1,
  });
  const markdown = "# Disposable product review\n\nOriginal synthetic draft.";
  const artifactId = await client.mutation(internal.vault.insertCreatedDoc, {
    tenantId,
    title: "Disposable product review",
    form: "long",
    markdown,
    contentHash: createHash("sha256").update(markdown).digest("hex"),
  });
  await client.mutation(internal.verticalPackTelemetry.record, {
    tenantId,
    verticalId: "product",
    candidateId: candidate.skillId,
    event: "artifact_created",
    artifactId,
  });
  const threadId = `phase30-review-${randomUUID()}`;
  await client.mutation(internal.vaultSources.insert, {
    tenantId,
    threadId,
    docIds: [artifactId],
    titles: ["Disposable product review"],
    count: 1,
    role: "created",
    form: "long",
    createdAt: Date.now(),
  });
  process.stdout.write(`artifact=${artifactId} thread=${threadId}\n`);
} else {
  const found = await client.query(internal.owner.findUserIdByEmailForProvisioning, { email });
  const tenantId = found.result?.userId;
  if (!tenantId) throw new Error("synthetic browser signup missing at readback");
  const expected = "# Human-edited synthetic product draft";
  const doc = await client.query(internal.vault.getDoc, { tenantId, vaultDocId: artifactId });
  const storage = await client.query(internal.vault.getDocForExtraction, {
    tenantId,
    vaultDocId: artifactId,
  });
  const outcomes = await client.query(internal.audit.recentByType, {
    eventType: "vertical_pack.outcome",
    sinceMs: Date.now() - 60 * 60_000,
    limit: 100,
  });
  const edits = outcomes.filter(
    (row) =>
      row.tenantId === tenantId &&
      row.payload?.artifactId === artifactId &&
      row.payload?.event === "review_edited" &&
      row.payload?.contentRevision === 1,
  );
  if (
    doc.text !== expected ||
    doc.contentHash !== createHash("sha256").update(expected).digest("hex") ||
    !storage.storageId ||
    storage.status !== "ready" ||
    edits.length !== 1 ||
    JSON.stringify(edits).includes(expected)
  )
    throw new Error("synthetic artifact edit readback did not match UI outcome");
  process.stdout.write("verified=true textHash=match pdfStorage=present reviewEdited=1\n");
}
