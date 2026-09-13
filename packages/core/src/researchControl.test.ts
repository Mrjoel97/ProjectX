import { describe, expect, test } from "vitest";
import {
  canClaimResearchPage,
  MAX_RESEARCH_PAGE_ATTEMPTS,
  researchPageLimit,
} from "./researchControl";

const attempt = "00000000-0000-4000-8000-000000000001";
const otherAttempt = "00000000-0000-4000-8000-000000000002";
const exhaustedAttempt = "00000000-0000-4000-8000-000000000003";

describe("research request controls", () => {
  test("validates the bounded typed limit", () => {
    expect(researchPageLimit(0)).toBe(0);
    expect(researchPageLimit(MAX_RESEARCH_PAGE_ATTEMPTS)).toBe(MAX_RESEARCH_PAGE_ATTEMPTS);
    expect(() => researchPageLimit(-1)).toThrow("RESEARCH_PAGE_LIMIT_INVALID");
    expect(() => researchPageLimit(MAX_RESEARCH_PAGE_ATTEMPTS + 1)).toThrow(
      "RESEARCH_PAGE_LIMIT_INVALID",
    );
    expect(() => researchPageLimit(1.5)).toThrow("RESEARCH_PAGE_LIMIT_INVALID");
  });

  test("claims are single-use and fail closed on expiry, closure, or exhaustion", () => {
    const base = {
      limit: 2,
      attempts: [] as string[],
      expiresAt: 2_000,
      closed: false,
    };
    expect(canClaimResearchPage(base, attempt, 1_999)).toBe(true);
    expect(canClaimResearchPage({ ...base, attempts: [attempt] }, attempt, 1_999)).toBe(false);
    expect(
      canClaimResearchPage({ ...base, attempts: [attempt, otherAttempt] }, exhaustedAttempt, 1_999),
    ).toBe(false);
    expect(canClaimResearchPage({ ...base, expiresAt: 2_000 }, attempt, 2_000)).toBe(false);
    expect(canClaimResearchPage({ ...base, closed: true }, attempt, 1_999)).toBe(false);
    expect(canClaimResearchPage(base, "not-a-uuid", 1_999)).toBe(false);
  });
});
