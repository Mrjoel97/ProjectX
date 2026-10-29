import { assessWebBrowserQuality, type WebBrowserPageReport } from "@pikar/core/webBrowserQuality";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import {
  artifactHashes,
  canonicalArtifactHashes,
  providerReceiptHash,
  validateProviderReceipt,
} from "./lib/presencePublication";
import { internalMutation } from "./lib/tenantLifecycle";

const scope = { tenantId: v.string(), versionId: v.id("webProjectVersions") };

/** Private worker input: never exposes reference blobs or unapproved pages publicly. */
export const inputs = internalQuery({
  args: scope,
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      !version.providerReceipt ||
      !version.artifacts
    )
      return null;
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    return {
      versionId: version._id,
      contentHash: version.contentHash,
      providerReceiptHash: providerReceiptHash(version.providerReceipt),
      artifacts: version.artifacts,
      providerReceipt: version.providerReceipt,
    };
  },
});

/** Only a trusted server worker can submit reports. Client status flags are never accepted. */
export const complete = internalMutation({
  args: {
    ...scope,
    contentHash: v.string(),
    providerReceiptHash: v.string(),
    artifactHashes: v.array(v.object({ pageSlug: v.string(), contentHash: v.string() })),
    reports: v.any(),
    fidelity: v.object({ matched: v.boolean(), evidenceHash: v.string() }),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (
      !version ||
      version.tenantId !== args.tenantId ||
      !version.providerReceipt ||
      !version.artifacts
    )
      throw Error("PRESENCE_REVIEW_SCOPE_MISMATCH");
    validateProviderReceipt(version.providerReceipt, version.artifacts);
    const hashes = artifactHashes(version.artifacts);
    if (
      args.contentHash !== version.contentHash ||
      args.providerReceiptHash !== providerReceiptHash(version.providerReceipt) ||
      canonicalArtifactHashes(args.artifactHashes) !== canonicalArtifactHashes(hashes)
    )
      throw Error("PRESENCE_REVIEW_STALE");
    if (
      !Array.isArray(args.reports) ||
      args.reports.length > 150 ||
      !/^[a-f0-9]{64}$/.test(args.fidelity.evidenceHash)
    )
      throw Error("PRESENCE_REVIEW_INVALID");
    const assessment = assessWebBrowserQuality({
      pageSlugs: hashes.map((page) => page.pageSlug),
      reports: args.reports as WebBrowserPageReport[],
    });
    const status =
      assessment.status === "pass" && args.fidelity.matched
        ? ("passed" as const)
        : ("failed" as const);
    const reportHash = sha256Bytes(
      new TextEncoder().encode(
        JSON.stringify({ reports: args.reports, fidelity: args.fidelity, assessment }),
      ),
    );
    await ctx.db.patch(version._id, {
      browserReview: {
        contentHash: version.contentHash,
        providerReceiptHash: args.providerReceiptHash,
        artifactHashes: hashes,
        status,
        reportHash,
        checkedAt: Date.now(),
      },
    });
    return { status, assessment };
  },
});
