import { describe, expect, test } from "vitest";
import { parseWorkspaceArtifactKey } from "./workspaceArtifacts";

describe("stable workspace artifact keys", () => {
  test("parses every opaque reference without content or URLs", () => {
    expect(parseWorkspaceArtifactKey("doc:abc")).toEqual({ kind: "document", id: "abc" });
    expect(parseWorkspaceArtifactKey("plan:abc")).toEqual({ kind: "media", id: "abc" });
    expect(parseWorkspaceArtifactKey("campaign:abc")).toEqual({ kind: "campaign", id: "abc" });
    expect(parseWorkspaceArtifactKey("attachment:abc:def")).toEqual({
      kind: "attachment",
      id: "abc",
      storageId: "def",
    });
    expect(parseWorkspaceArtifactKey("source:abc:def")).toEqual({
      kind: "source",
      id: "abc",
      docId: "def",
    });
  });
  test("rejects URLs, malformed references and oversized values", () => {
    for (const key of [
      "https://example.org",
      "doc:",
      "plan:a:b",
      "attachment:a",
      "unknown:a",
      "doc:a b",
      `doc:${"a".repeat(513)}`,
    ]) {
      expect(parseWorkspaceArtifactKey(key)).toBeNull();
    }
  });
});
