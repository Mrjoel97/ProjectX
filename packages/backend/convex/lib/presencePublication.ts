import { sha256Bytes } from "@pikar/core/webRuntime";
import type { Id } from "../_generated/dataModel";

export type PresenceProviderReceipt = {
  pipelineVersion: "stitch-kimi-required-v1";
  runRef: string;
  stitchHash: string;
  kimiHash: string;
  sourceFingerprint: string;
  briefHash: string;
  layoutHash: string;
  artifactHashes: { pageSlug: string; contentHash: string }[];
  pendingBrowser: true;
  stitchHtmlStorageId?: Id<"_storage">;
  stitchImageStorageId?: Id<"_storage">;
};
export const artifactHashes = (artifacts: readonly { pageSlug: string; html: string }[]) =>
  artifacts.map(({ pageSlug, html }) => ({
    pageSlug,
    contentHash: sha256Bytes(new TextEncoder().encode(html)),
  }));
export const canonicalArtifactHashes = (
  artifacts: readonly { pageSlug: string; contentHash: string }[],
) => JSON.stringify(artifacts.map(({ pageSlug, contentHash }) => ({ pageSlug, contentHash })));
export function validateProviderReceipt(
  receipt: PresenceProviderReceipt,
  artifacts: readonly { pageSlug: string; html: string }[],
) {
  const hash = /^[a-f0-9]{64}$/;
  if (
    receipt.pipelineVersion !== "stitch-kimi-required-v1" ||
    !/^[a-zA-Z0-9_-]{8,96}$/.test(receipt.runRef) ||
    ![
      receipt.stitchHash,
      receipt.kimiHash,
      receipt.sourceFingerprint,
      receipt.briefHash,
      receipt.layoutHash,
    ].every((value) => hash.test(value)) ||
    receipt.pendingBrowser !== true ||
    canonicalArtifactHashes(receipt.artifactHashes) !==
      canonicalArtifactHashes(artifactHashes(artifacts))
  )
    throw Error("PRESENCE_PROVIDER_RECEIPT_MISMATCH");
}

export type PresenceBrowserReview = {
  contentHash: string;
  artifactHashes: { pageSlug: string; contentHash: string }[];
  providerReceiptHash: string;
  status: "passed" | "failed";
  reportHash: string;
  checkedAt: number;
};
export const providerReceiptHash = (receipt: PresenceProviderReceipt) =>
  sha256Bytes(
    new TextEncoder().encode(
      JSON.stringify({
        pipelineVersion: receipt.pipelineVersion,
        runRef: receipt.runRef,
        stitchHash: receipt.stitchHash,
        kimiHash: receipt.kimiHash,
        sourceFingerprint: receipt.sourceFingerprint,
        briefHash: receipt.briefHash,
        layoutHash: receipt.layoutHash,
        artifactHashes: canonicalArtifactHashes(receipt.artifactHashes),
        pendingBrowser: receipt.pendingBrowser,
        stitchHtmlStorageId: receipt.stitchHtmlStorageId,
        stitchImageStorageId: receipt.stitchImageStorageId,
      }),
    ),
  );
/** An edited version inherits the requirement, never the previous version's passing review. */
export function presencePublicationReady(version: {
  contentHash: string;
  artifacts?: { pageSlug: string; html: string }[];
  providerReceipt?: PresenceProviderReceipt;
  requiresProviderReview?: boolean;
  browserReview?: PresenceBrowserReview;
}): boolean {
  if (!version.providerReceipt && !version.requiresProviderReview) return true;
  if (!version.providerReceipt || !version.browserReview || !version.artifacts) return false;
  const review = version.browserReview;
  try {
    validateProviderReceipt(version.providerReceipt, version.artifacts);
  } catch {
    return false;
  }
  return (
    review.status === "passed" &&
    review.contentHash === version.contentHash &&
    review.providerReceiptHash === providerReceiptHash(version.providerReceipt) &&
    canonicalArtifactHashes(review.artifactHashes) ===
      canonicalArtifactHashes(artifactHashes(version.artifacts))
  );
}
