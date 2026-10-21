import { describe, expect, it } from "vitest";
import {
  DESIGN_KNOWLEDGE_BUNDLE_HASH,
  DESIGN_KNOWLEDGE_COMPILER_HASH,
  DESIGN_PRECEDENCE,
  parseDesignKnowledgeBundle,
  selectDesignProfile,
  validateDesignProfileRef,
  verifiedDesignKnowledgeBundle,
} from "./designKnowledge";
import { designKnowledgeBundle } from "./designKnowledge.generated";

describe("closed design knowledge", () => {
  it("accepts only the verified generated bundle identity and records", () => {
    expect(verifiedDesignKnowledgeBundle.bundleHash).toBe(DESIGN_KNOWLEDGE_BUNDLE_HASH);
    expect(verifiedDesignKnowledgeBundle.compilerHash).toBe(DESIGN_KNOWLEDGE_COMPILER_HASH);
    expect(verifiedDesignKnowledgeBundle.records).toHaveLength(8);
    expect(
      new Set(verifiedDesignKnowledgeBundle.records.map((record) => record.sourceRole)),
    ).toEqual(new Set(["ui-ux-pro-max", "taste-skill", "nexscope-ecommerce"]));
    expect(() =>
      parseDesignKnowledgeBundle({ ...verifiedDesignKnowledgeBundle, records: [] }),
    ).toThrow();
  });

  it("fails closed on every canonical bundle mutation", () => {
    type MutableBundle = {
      schemaVersion: number;
      compilerSchemaVersion: string;
      inputHash: string;
      records: Array<{ id: string; kind: string; data: Record<string, unknown> }>;
    };
    const clone = (): MutableBundle =>
      JSON.parse(JSON.stringify(designKnowledgeBundle)) as MutableBundle;
    expect(parseDesignKnowledgeBundle(clone()).bundleHash).toBe(DESIGN_KNOWLEDGE_BUNDLE_HASH);
    const changedLabel = clone();
    changedLabel.records[0]!.data.label = "Tampered";
    expect(() => parseDesignKnowledgeBundle(changedLabel)).toThrow();
    const changedData = clone();
    changedData.records[0]!.data.extra = "Tampered";
    expect(() => parseDesignKnowledgeBundle(changedData)).toThrow();
    const reordered = clone();
    reordered.records.reverse();
    expect(() => parseDesignKnowledgeBundle(reordered)).toThrow();
    const duplicate = clone();
    duplicate.records[1] = duplicate.records[0]!;
    expect(() => parseDesignKnowledgeBundle(duplicate)).toThrow();
    const missing = clone();
    missing.records.pop();
    expect(() => parseDesignKnowledgeBundle(missing)).toThrow();
    const extraKey = clone() as MutableBundle & { extra: string };
    extraKey.extra = "Tampered";
    expect(() => parseDesignKnowledgeBundle(extraKey)).toThrow();
    const changedIdentity = clone();
    changedIdentity.inputHash = "0".repeat(64);
    expect(() => parseDesignKnowledgeBundle(changedIdentity)).toThrow();
    for (const role of ["ui-ux-pro-max", "taste-skill", "nexscope-ecommerce"] as const) {
      const ids = new Set(
        verifiedDesignKnowledgeBundle.records
          .filter((record) => record.sourceRole === role)
          .map((record) => record.id),
      );
      const removed = clone();
      removed.records = removed.records.filter((record) => !ids.has(record.id));
      expect(() => parseDesignKnowledgeBundle(removed)).toThrow(
        /DESIGN_KNOWLEDGE_BUNDLE_BYTES_INVALID/,
      );
    }
  });

  it("keeps Pikar/accessibility precedence ahead of bounded aesthetics", () => {
    expect(DESIGN_PRECEDENCE).toEqual([
      "pikar-security-privacy-legal",
      "accessibility-semantics",
      "tenant-brand-facts",
      "aesthetic-guidance",
    ]);
    const result = selectDesignProfile({
      pageGoal: "campaign",
      accessibilityPosture: "high",
      dials: { motion: 10 },
    });
    expect(result.fallback).toBe(false);
    expect(result.profile.dials.motion).toBe(1);
    expect(validateDesignProfileRef(result.profile)).toBe(true);
  });

  it("returns one honest bounded fallback for an unknown brief", () => {
    const result = selectDesignProfile({ pageGoal: "unknown", dials: { variance: 99 } });
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe("unknown_brief");
    expect(result.profile.dials.variance).toBe(5);
  });
});
