import { describe, expect, it } from "vitest";
import {
  durableUserId,
  inviteCode,
  jsonValue,
  noOutputReason,
  onboardedTenant,
  ownerGrant,
} from "../e2e/provision-owner.diagnostics";

describe("provision-owner CLI diagnostics", () => {
  it("reduces child failures to closed reason codes", () => {
    expect(noOutputReason({ error: { code: "ETIMEDOUT" } })).toBe("spawn_ETIMEDOUT");
    expect(noOutputReason({ error: { code: "EOTHER" } })).toBe("spawn_unknown");
    expect(noOutputReason({ signal: "SIGINT" })).toBe("signal_other");
    expect(noOutputReason({ status: 0 })).toBe("exit_zero_no_output");
    expect(noOutputReason({ status: 9 })).toBe("exit_nonzero");
  });

  it("accepts real absence while refusing malformed JSON and semantic results", () => {
    expect(() => jsonValue("invites:__seedInvite", "not-json")).toThrow(
      "invites:__seedInvite returned invalid JSON",
    );
    expect(jsonValue("owner:findUserIdByEmail", "null")).toBeNull();
    expect(inviteCode({ code: "ABCD-1234" })).toBe("ABCD-1234");
    expect(durableUserId({ userId: "abc123" })).toBe("abc123");
    expect(ownerGrant({ userId: "abc123", changed: true }, "abc123")).toBe(true);
    expect(onboardedTenant({ vaultDocId: "abc123", tier: "solopreneur" })).toBe(true);
    expect(inviteCode(null)).toBeNull();
    expect(inviteCode({ code: "invalid code" })).toBeNull();
    expect(durableUserId({ userId: "UPPERCASE" })).toBeNull();
    expect(ownerGrant({ userId: "other", changed: true }, "abc123")).toBe(false);
    expect(onboardedTenant({ vaultDocId: "UPPERCASE", tier: "" })).toBe(false);
  });
});
