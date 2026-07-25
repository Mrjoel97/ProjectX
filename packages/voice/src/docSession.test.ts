import { describe, expect, it } from "vitest";
import {
  DIGEST_CHAR_CAP,
  DOC_GAP_PLAYBOOK,
  DOC_GAP_ROUTE,
  DOC_REVIEW_FRAMEWORK,
  EXCERPT_CHAR_CAP,
  RETRIEVAL_CHAR_CAP,
  RETRIEVAL_MAX_PASSAGES,
  SEARCH_DOCUMENT_TOOL,
  VOICE_DOC_THREAD_PREFIX,
  voiceDocThreadId,
} from "./docSession";

describe("voiceDocThreadId", () => {
  it("is the session id behind the voice-doc prefix", () => {
    expect(voiceDocThreadId("abc")).toBe("voice-doc:abc");
    expect(voiceDocThreadId("abc").startsWith(VOICE_DOC_THREAD_PREFIX)).toBe(true);
  });

  it("is deterministic — PostCall, actOnGap and byThread must all derive the same id", () => {
    expect(voiceDocThreadId("s1")).toBe(voiceDocThreadId("s1"));
    expect(voiceDocThreadId("s1")).not.toBe(voiceDocThreadId("s2"));
  });
});

describe("SEARCH_DOCUMENT_TOOL", () => {
  // Pitfall: the Chat-Completions {type,function:{...}} nesting 400s the Realtime mint.
  it("is the FLAT Realtime shape, not the Chat-Completions nesting", () => {
    expect(SEARCH_DOCUMENT_TOOL.type).toBe("function");
    expect(SEARCH_DOCUMENT_TOOL.name).toBe("search_document");
    expect(typeof SEARCH_DOCUMENT_TOOL.description).toBe("string");
    expect(SEARCH_DOCUMENT_TOOL.parameters).toBeDefined();
    expect(SEARCH_DOCUMENT_TOOL).not.toHaveProperty("function");
  });

  it("has STRICT-legal parameters — every property required, no additional properties", () => {
    const { properties, required, additionalProperties } = SEARCH_DOCUMENT_TOOL.parameters;
    const propertyKeys = Object.keys(properties);
    expect(propertyKeys.length).toBeGreaterThan(0);
    // Strict mode rejects a schema whose `required` omits any declared property.
    expect([...required].sort()).toEqual([...propertyKeys].sort());
    expect(additionalProperties).toBe(false);
  });
});

describe("char budgets", () => {
  // The instructions are re-billed as input on EVERY turn against a 32k window, so the
  // digest is a hard cap, not a target — depth comes from SEARCH_DOCUMENT_TOOL instead.
  it("digest and retrieval caps are positive and the digest stays inside the window budget", () => {
    expect(DIGEST_CHAR_CAP).toBeGreaterThan(0);
    expect(DIGEST_CHAR_CAP).toBeLessThanOrEqual(8000);
    expect(RETRIEVAL_CHAR_CAP).toBeGreaterThan(0);
    expect(RETRIEVAL_MAX_PASSAGES).toBeGreaterThan(0);
  });

  it("a citation excerpt is a quote, not a second digest", () => {
    expect(EXCERPT_CHAR_CAP).toBeGreaterThan(0);
    expect(EXCERPT_CHAR_CAP).toBeLessThanOrEqual(400);
    expect(EXCERPT_CHAR_CAP).toBeLessThan(RETRIEVAL_CHAR_CAP);
  });
});

describe("welded-in-code literals", () => {
  it("the framework literal is human-readable — buildMemo prints it as memo prose", () => {
    expect(DOC_REVIEW_FRAMEWORK).toBe("document-review");
  });

  it("gap routing is code-owned, never model-chosen", () => {
    expect(DOC_GAP_ROUTE).toBe("document-analyst");
    expect(DOC_GAP_PLAYBOOK).toBe("document-review");
  });
});
