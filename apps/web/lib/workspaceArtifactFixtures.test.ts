import { describe, expect, it } from "vitest";
import {
  ARTIFACT_QA_APP,
  ARTIFACT_QA_BACKEND,
  validateArtifactFixtures,
} from "../e2e/workspaceArtifactFixtures";

const valid = () => ({
  provenance: "Dedicated local synthetic fixtures",
  appOrigin: ARTIFACT_QA_APP,
  target: ARTIFACT_QA_BACKEND,
  users: {
    A: {
      userId: "localA",
      chats: {
        primary: {
          threadId: "A1",
          artifacts: [
            { key: "doc:alpha", title: "Synthetic report", sha256: "a".repeat(64), bytes: 123 },
          ],
        },
        secondary: { threadId: "A2", artifacts: [{ key: "doc:beta", title: "Another report" }] },
      },
    },
    B: {
      userId: "localB",
      chats: {
        primary: { threadId: "B1", artifacts: [{ key: "doc:gamma", title: "Foreign report" }] },
      },
    },
  },
  deleted: { threadId: "A1", key: "doc:deleted" },
  arrival: { threadId: "A1", ready: false },
});

describe("disposable authenticated artifact fixture admission", () => {
  it("accepts only the dedicated local stack and structurally valid synthetic refs", () => {
    expect(validateArtifactFixtures(valid()).target).toBe(ARTIFACT_QA_BACKEND);
  });
  it.each([
    () => ({ ...valid(), target: "https://production.convex.cloud" }),
    () => ({ ...valid(), appOrigin: "https://production.example" }),
    () => ({ ...valid(), target: "http://localhost:3340" }),
    () => {
      const value = valid();
      value.users.B.userId = value.users.A.userId;
      return value;
    },
    () => {
      const value = valid();
      value.users.A.chats.primary.artifacts[0].key = "../../foreign";
      return value;
    },
    () => {
      const value = valid();
      value.users.A.chats.primary.artifacts[0].sha256 = "not-a-hash";
      return value;
    },
    () => {
      const value = valid();
      value.deleted.key = "doc:invalid/ref";
      return value;
    },
  ])("refuses a changed target, aliased identity or malformed original/reference", (make) => {
    expect(() => validateArtifactFixtures(make())).toThrow(/^PHASE53_LOCAL_FIXTURE_INVALID_/u);
  });
});
