// 27-08 Task 2 (PACK-01): the code-owned MIRROR of `third_party/knowledge-work-plugins/manifest.json`,
// for the one consumer that cannot read it — `skills.ts` runs inside Convex, which has no filesystem.
//
// The manifest is still the AUTHORITY. This file is derived from it exactly the way
// `packages/contracts/src/skills/pack-*.ts` are derived from their canonical `.md`, and
// `knowledgeWorkProvenance.test.ts` asserts the pair agrees field-by-field — so an edit to one side
// is a failure rather than a candidate published against a source record nothing pins.
//
// WHY THERE IS NO `ts: Date.now()` HERE. `publishPackCandidate` treats `(body, provenance)` as the
// identity of a version: a re-run whose provenance string differs by so much as a millisecond is
// NOT a duplicate, and it mints candidate N+1. Provenance is also written at insert and never
// patched, so it must be a pure function of the pinned material. `pinnedAt` is therefore the
// UPSTREAM COMMIT's timestamp — a fact about the material, deterministic, and the only date that
// means anything about where these bodies came from. The publication moment is `skills.createdAt`,
// which the row already carries.

/** Immutable upstream record for one adapted pack body, minus the per-version pin. */
export type KnowledgeWorkProvenance = {
  readonly sourceRepo: string;
  /** Exact upstream commit, 40 hex. A branch or a tag is not provenance. */
  readonly sourceCommit: string;
  /** Upstream paths this body was adapted from, repo-relative. */
  readonly sourcePaths: readonly string[];
  /** SHA-256 of the LF-NORMALIZED canonical `.md` — see the manifest's `adaptedBodies` note. */
  readonly bodySha256: string;
  readonly license: "Apache-2.0";
  /** Apache-2.0 §4(b), machine-readable. The human-readable half is THIRD_PARTY_NOTICES.md. */
  readonly modificationNotice: string;
};

const REPO = "https://github.com/anthropics/knowledge-work-plugins";
const COMMIT = "5267cf7bff3031921d4474b8e8f86ad02d2b8f6d";

/** The pinned commit's own timestamp (`upstream.commitDate`), epoch ms. NOT the publication time. */
export const KNOWLEDGE_WORK_PINNED_AT = Date.parse("2026-08-20T19:55:20Z");

/**
 * Keyed by REGISTRY NAME (`pack-<id>`), not by pack id, because that is what `publishPackCandidate`
 * and the activation gate key on — a second mapping from id to name is a second thing to drift.
 */
export const KNOWLEDGE_WORK_PROVENANCE: Readonly<Record<string, KnowledgeWorkProvenance>> = {
  "pack-business-pulse": {
    sourceRepo: REPO,
    sourceCommit: COMMIT,
    sourcePaths: [
      "small-business/skills/business-pulse/SKILL.md",
      "small-business/skills/business-pulse/reference/data_sources.md",
      "small-business/skills/business-pulse/reference/gotchas.md",
      "small-business/skills/business-pulse/reference/output_template.md",
      "small-business/skills/business-pulse/reference/thresholds.md",
    ],
    bodySha256: "7d0c9b03b1ca6f4e0ad408f79a4d60acdbd440663d5ab7d2ec6668a3ab58eea0",
    license: "Apache-2.0",
    modificationNotice:
      "Connector sections (QuickBooks/PayPal/Square/HubSpot) removed: those sources are MISSING in Pikar and are named to the user instead. Output is an in-thread briefing, not a saved report.",
  },
  "pack-campaign-plan": {
    sourceRepo: REPO,
    sourceCommit: COMMIT,
    sourcePaths: ["marketing/skills/campaign-plan/SKILL.md"],
    bodySha256: "2d04b66d98fb54feaaec911b1f46f7452af64d04ebf567eca579a93adf12f71e",
    license: "Apache-2.0",
    modificationNotice:
      "Rewritten to PRODUCE a plan only. The upstream brief implies executing the campaign; a Pikar pack carries a tool allow-list and structurally cannot dispatch a specialist or send anything.",
  },
  "pack-customer-complaint": {
    sourceRepo: REPO,
    sourceCommit: COMMIT,
    sourcePaths: [
      "small-business/skills/ticket-deflector/SKILL.md",
      "small-business/skills/ticket-deflector/reference/examples/respond-refund-request.md",
      "small-business/skills/ticket-deflector/reference/gotchas.md",
    ],
    bodySha256: "b512c3e69fd6b1a970e2fe75ae9b435566890f17b2dfd2060baabafd5e4407ab",
    license: "Apache-2.0",
    modificationNotice:
      "Refund issuance and every send removed. Pikar drafts a reply through replyToMessage and stages it with proposePlan for the one human Approve gate; order/refund and CRM history are MISSING.",
  },
  "pack-sales-call-prep": {
    sourceRepo: REPO,
    sourceCommit: COMMIT,
    sourcePaths: ["sales/skills/call-prep/SKILL.md"],
    bodySha256: "9843a2d0277d9e0e53caa97eb1cd4283d12d95759b1178c720c9469617eb914b",
    license: "Apache-2.0",
    modificationNotice:
      "CRM account/deal lookups removed and named as MISSING. Keeps the standalone user-input plus web-research path, which is what Pikar can actually serve.",
  },
  "pack-process-sop": {
    sourceRepo: REPO,
    sourceCommit: COMMIT,
    sourcePaths: ["operations/skills/process-doc/SKILL.md"],
    bodySha256: "bf1166a452a52858f6b0838a9c124d4bfd30b7474ed32746e993fd637b167386",
    license: "Apache-2.0",
    modificationNotice:
      "Publishing, task-system export and owner assignment removed and named as MISSING. Produces a durable vault document only.",
  },
  "pack-brand-review": {
    sourceRepo: REPO,
    sourceCommit: COMMIT,
    sourcePaths: ["marketing/skills/brand-review/SKILL.md"],
    bodySha256: "1d2261fe18e248a9159b220768f1eebff2e49542d210433cc9b6759732a0c85f",
    license: "Apache-2.0",
    modificationNotice:
      "Rewritten to review against general principles, because Pikar has no tenant brand store; the pack says so and names what would unlock the stronger review.",
  },
};
