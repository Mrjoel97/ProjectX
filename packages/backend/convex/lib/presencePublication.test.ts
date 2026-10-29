import { describe, expect, it } from "vitest";
import {
  artifactHashes,
  type PresenceProviderReceipt,
  presencePublicationReady,
  providerReceiptHash,
  validateProviderReceipt,
} from "./presencePublication";

const artifacts = [{ pageSlug: "home", html: "<main>Original</main>" }];
const receipt: PresenceProviderReceipt = {
  pipelineVersion: "stitch-kimi-required-v1",
  runRef: "offline-test-run",
  stitchHash: "a".repeat(64),
  kimiHash: "b".repeat(64),
  sourceFingerprint: "c".repeat(64),
  briefHash: "d".repeat(64),
  layoutHash: "e".repeat(64),
  artifactHashes: artifactHashes(artifacts),
  pendingBrowser: true,
};
const reviewed = {
  contentHash: "f".repeat(64),
  artifacts,
  requiresProviderReview: true,
  providerReceipt: receipt,
  browserReview: {
    contentHash: "f".repeat(64),
    providerReceiptHash: providerReceiptHash(receipt),
    artifactHashes: artifactHashes(artifacts),
    status: "passed" as const,
    reportHash: "a".repeat(64),
    checkedAt: 1,
  },
};
describe("exact version publication quality gate", () => {
  it("allows legacy versions and exact reviewed provider versions", () => {
    expect(presencePublicationReady({ contentHash: "legacy" })).toBe(true);
    expect(presencePublicationReady(reviewed)).toBe(true);
  });
  it("blocks pending, failed and inherited but unreviewed versions", () => {
    expect(presencePublicationReady({ ...reviewed, browserReview: undefined })).toBe(false);
    expect(presencePublicationReady({ ...reviewed, providerReceipt: undefined })).toBe(false);
    expect(
      presencePublicationReady({
        ...reviewed,
        browserReview: { ...reviewed.browserReview, status: "failed" },
      }),
    ).toBe(false);
  });
  it("cannot reuse evidence after content, artifact or provider changes", () => {
    expect(presencePublicationReady({ ...reviewed, contentHash: "new" })).toBe(false);
    expect(
      presencePublicationReady({ ...reviewed, artifacts: [{ pageSlug: "home", html: "changed" }] }),
    ).toBe(false);
    expect(
      presencePublicationReady({
        ...reviewed,
        providerReceipt: { ...receipt, runRef: "different-run" },
      }),
    ).toBe(false);
    expect(() => validateProviderReceipt(receipt, [])).toThrow(
      "PRESENCE_PROVIDER_RECEIPT_MISMATCH",
    );
  });
  it("accepts database field reordering without weakening exact content matching", () => {
    const reordered = Object.fromEntries(
      Object.entries(receipt).reverse(),
    ) as PresenceProviderReceipt;
    reordered.artifactHashes = receipt.artifactHashes.map(({ pageSlug, contentHash }) => ({
      contentHash,
      pageSlug,
    }));
    expect(providerReceiptHash(reordered)).toBe(providerReceiptHash(receipt));
    expect(presencePublicationReady({ ...reviewed, providerReceipt: reordered })).toBe(true);
  });
});
