import { presenceDesignPolicySkillBody } from "@pikar/contracts/skills/presenceDesignPolicy";
import { expect, test, vi } from "vitest";
import { loadPresencePolicy } from "./presencePolicy";

test("active registry policy preserves exact prompt bytes and immutable registry identity", async () => {
  const runQuery = vi.fn(async () => ({
    body: presenceDesignPolicySkillBody,
    version: 7,
    skillId: "policy-seven",
  }));
  const result = await loadPresencePolicy({ runQuery } as never);
  expect(runQuery).toHaveBeenCalledWith(expect.anything(), { name: "presence-design-policy" });
  expect(result).toEqual({
    prompts: JSON.parse(presenceDesignPolicySkillBody),
    version: 7,
    skillId: "policy-seven",
  });
});

test.each([
  { ...JSON.parse(presenceDesignPolicySkillBody), injected: "unexpected instruction" },
  { ...JSON.parse(presenceDesignPolicySkillBody), layout: 42 },
  { ...JSON.parse(presenceDesignPolicySkillBody), stitch: "x".repeat(12001) },
  { ...JSON.parse(presenceDesignPolicySkillBody), requiredNative: null },
])("policy loader rejects extra keys, non-text or oversized instructions", async (value) => {
  const runQuery = vi.fn(async () => ({
    body: JSON.stringify(value),
    version: 1,
    skillId: "policy",
  }));
  await expect(loadPresencePolicy({ runQuery } as never)).rejects.toThrow(
    "PRESENCE_POLICY_INVALID",
  );
});
