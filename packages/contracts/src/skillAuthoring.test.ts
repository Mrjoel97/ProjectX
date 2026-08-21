import { describe, expect, it } from "vitest";
import {
  AGENT_AUTHORABLE_SKILLS,
  AGENT_EVAL_SUITE,
  COCKPIT_AGENT_SKILL,
  composeUserSkillBody,
  DOCUMENT_ANALYST_SKILL,
  type EvalEvidenceTenantTarget,
  EXECUTIVE_AGENT_AUTHOR_ID,
  GATED_SKILLS,
  hasPassingAgentTenantEvidence,
  hasPassingTenantEvidence,
  isAgentAuthorableSkill,
  isUserAuthorableSkill,
  LEAD_ENGINE_SKILL,
  MEDIA_DIRECTOR_SKILL,
  MONEY_MODEL_DESIGNER_SKILL,
  OFFER_ARCHITECT_SKILL,
  USER_AUTHORABLE_SKILL_METADATA,
  USER_AUTHORABLE_SKILLS,
  USER_SKILL_ADAPTATION_MAX_BYTES,
} from "./skill";

const AUTHORABLE = [OFFER_ARCHITECT_SKILL, MONEY_MODEL_DESIGNER_SKILL, LEAD_ENGINE_SKILL];

describe("user-authored skill contract", () => {
  it("keeps the v0 authorable set exact, gated, and exhaustively labelled", () => {
    expect(USER_AUTHORABLE_SKILLS).toEqual(AUTHORABLE);
    expect(USER_AUTHORABLE_SKILLS.every((name) => GATED_SKILLS.includes(name))).toBe(true);
    expect(Object.keys(USER_AUTHORABLE_SKILL_METADATA).sort()).toEqual([...AUTHORABLE].sort());

    for (const name of AUTHORABLE) {
      expect(isUserAuthorableSkill(name)).toBe(true);
      expect(USER_AUTHORABLE_SKILL_METADATA[name].label.trim()).not.toBe("");
      expect(USER_AUTHORABLE_SKILL_METADATA[name].description.trim()).not.toBe("");
    }

    expect(isUserAuthorableSkill(COCKPIT_AGENT_SKILL)).toBe(false);
    expect(isUserAuthorableSkill("not-a-registry-skill")).toBe(false);
  });

  it("composes one deterministic adaptation section without changing the base", () => {
    const base = "# Offer architect\n\nKeep the core contract.";
    const first = composeUserSkillBody(base, "  Prefer annual contracts.  ");
    const second = composeUserSkillBody(base, "Prefer usage-based pricing.");

    expect(first).toBe(
      `${base}\n\n## Tenant-authored business adaptation\n\nPrefer annual contracts.`,
    );
    expect(first.match(/Tenant-authored business adaptation/g)).toHaveLength(1);
    expect(second).not.toContain("Prefer annual contracts.");
    expect(second.startsWith(base)).toBe(true);
  });

  it("refuses blank and over-cap UTF-8 adaptations at the byte boundary", () => {
    expect(() => composeUserSkillBody("base", " \n\t ")).toThrow("USER_SKILL_ADAPTATION_REQUIRED");

    const twoByteCharacter = "é";
    const atCap = twoByteCharacter.repeat(USER_SKILL_ADAPTATION_MAX_BYTES / 2);
    const overCap = `${atCap}${twoByteCharacter}`;

    expect(new TextEncoder().encode(atCap)).toHaveLength(USER_SKILL_ADAPTATION_MAX_BYTES);
    expect(composeUserSkillBody("base", atCap)).toContain(atCap);
    expect(() => composeUserSkillBody("base", overCap)).toThrow("USER_SKILL_ADAPTATION_TOO_LARGE");
  });
});

describe("agent-authored skill contract (Phase 23, SKILL-02)", () => {
  it("keeps the agent set closed, duplicate-free, and narrower-or-equal to both landed lists", () => {
    // Exact set. A widening is a red test, not a review catch.
    expect(AGENT_AUTHORABLE_SKILLS).toEqual(AUTHORABLE);
    expect(new Set(AGENT_AUTHORABLE_SKILLS).size).toBe(AGENT_AUTHORABLE_SKILLS.length);

    // The two subset relationships the whole capability argument rests on.
    for (const name of AGENT_AUTHORABLE_SKILLS) {
      expect(USER_AUTHORABLE_SKILLS as readonly string[]).toContain(name);
      expect(GATED_SKILLS).toContain(name);
      expect(isAgentAuthorableSkill(name)).toBe(true);
    }
  });

  it("is a SEPARATE literal, so a product widening of the user set cannot widen the agent set", () => {
    // Aliasing would make this assertion unwriteable: mutating one would mutate the other. The
    // sets are equal TODAY and must stay independently narrowable.
    expect(AGENT_AUTHORABLE_SKILLS).not.toBe(USER_AUTHORABLE_SKILLS);
  });

  it("refuses ungated, un-runnable, and arbitrary names", () => {
    // Gated, but never authorable by anyone: the cockpit's own body.
    expect(isAgentAuthorableSkill(COCKPIT_AGENT_SKILL)).toBe(false);
    // Deliberately UNGATED and driven by no held-out fixture — minting a candidate here would be
    // structurally un-activatable, which is the exact deadlock `skill.ts` records.
    expect(isAgentAuthorableSkill(DOCUMENT_ANALYST_SKILL)).toBe(false);
    expect(isAgentAuthorableSkill(MEDIA_DIRECTOR_SKILL)).toBe(false);
    expect(isAgentAuthorableSkill("not-a-registry-skill")).toBe(false);
    expect(isAgentAuthorableSkill("")).toBe(false);
  });

  it("reuses the ONE landed composer and cap — no second composition system exists", () => {
    const base = "# Lead engine -- code-owned base.";
    const composed = composeUserSkillBody(base, "Agent-drafted adaptation.");

    expect(composed.startsWith(base)).toBe(true);
    expect(composed.match(/Tenant-authored business adaptation/g)).toHaveLength(1);
    // The agent is bound by the same byte cap as the user, not a second one.
    expect(USER_SKILL_ADAPTATION_MAX_BYTES).toBe(4000);
  });

  it("stamps one code-owned author identity that no model supplies", () => {
    expect(EXECUTIVE_AGENT_AUTHOR_ID).toBe("executive-agent");
  });
});

describe("hasPassingAgentTenantEvidence — the suite-bound gate (Phase 23, 23-04)", () => {
  const target: EvalEvidenceTenantTarget = {
    candidateId: "k57rowA",
    registryTenantId: "tenant_registry",
    name: OFFER_ARCHITECT_SKILL,
    version: 3,
  };

  const evidence = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      runner: "eval:golden",
      runId: "de976d8e",
      pass: true,
      casesPassed: AGENT_EVAL_SUITE.caseCount,
      casesTotal: AGENT_EVAL_SUITE.caseCount,
      retriedCases: [],
      costUsd: 0.5,
      model: "openai/gpt-4o-mini",
      skillVersions: {},
      tenantTarget: target,
      suite: { ...AGENT_EVAL_SUITE },
      ts: 1,
      ...over,
    });

  it("accepts an all-green, unfiltered run of the EXACT current suite on the EXACT row", () => {
    expect(hasPassingAgentTenantEvidence(evidence(), target)).toBe(true);
  });

  it("refuses a stale suite — a candidate certified before the adversarial cases existed", () => {
    expect(
      hasPassingAgentTenantEvidence(
        evidence({ suite: { ...AGENT_EVAL_SUITE, revision: "2026-01-01.old" } }),
        target,
      ),
    ).toBe(false);
    // A revision that matches while the CONTENT moved is the sneakier half: someone edited a
    // fixture and regenerated the manifest without bumping the revision.
    expect(
      hasPassingAgentTenantEvidence(
        evidence({ suite: { ...AGENT_EVAL_SUITE, casesHash: "f".repeat(64) } }),
        target,
      ),
    ).toBe(false);
  });

  it("refuses evidence with NO suite at all — which is exactly what a Phase-21 row has", () => {
    expect(hasPassingAgentTenantEvidence(evidence({ suite: undefined }), target)).toBe(false);
    // …and that same row is STILL VALID under the Phase-21 predicate. The two rules coexist; the
    // stricter one was not smuggled in as a tightening of the shipped one.
    expect(hasPassingTenantEvidence(evidence({ suite: undefined }), target)).toBe(true);
  });

  it("refuses a FILTERED run — the `--only` hole, closed at the reader as well as the writer", () => {
    // 3 of 46 green reads identically to a full green once it is a row. The runner refuses to
    // record one; this refuses to honour one that arrived some other way.
    expect(hasPassingAgentTenantEvidence(evidence({ casesPassed: 3, casesTotal: 3 }), target)).toBe(
      false,
    );
    // Partial green over the full suite is refused too.
    expect(
      hasPassingAgentTenantEvidence(
        evidence({ casesPassed: AGENT_EVAL_SUITE.caseCount - 1 }),
        target,
      ),
    ).toBe(false);
  });

  it("inherits every Phase-21 identity check — the row, not the name@version", () => {
    expect(hasPassingAgentTenantEvidence(evidence(), { ...target, candidateId: "other" })).toBe(
      false,
    );
    expect(
      hasPassingAgentTenantEvidence(evidence(), { ...target, registryTenantId: "other" }),
    ).toBe(false);
    expect(hasPassingAgentTenantEvidence(evidence(), { ...target, version: 4 })).toBe(false);
    expect(hasPassingAgentTenantEvidence(evidence({ pass: false }), target)).toBe(false);
  });

  it("fails closed on absent and unparseable evidence", () => {
    expect(hasPassingAgentTenantEvidence(undefined, target)).toBe(false);
    expect(hasPassingAgentTenantEvidence("{not json", target)).toBe(false);
    expect(hasPassingAgentTenantEvidence("", target)).toBe(false);
  });

  it("names a real, non-empty suite — a zero count would make the gate vacuous", () => {
    expect(AGENT_EVAL_SUITE.caseCount).toBeGreaterThan(0);
    expect(AGENT_EVAL_SUITE.casesHash).toMatch(/^[0-9a-f]{64}$/);
    expect(AGENT_EVAL_SUITE.revision.trim()).not.toBe("");
  });
});
