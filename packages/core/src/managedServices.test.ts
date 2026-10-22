import { describe, expect, it } from "vitest";
import {
  deriveManagedServiceReadiness,
  evaluateServiceClaim,
  isMaterialServiceChange,
  type ManagedServiceConfig,
  type ManagedServiceEvent,
  type ManagedServiceOperationId,
  type ManagedServiceState,
  type ServiceCompositionNode,
  type TrustedServiceCapabilitySnapshot,
  transitionManagedService,
  validateManagedServiceConfig,
  validateServiceComposition,
} from "./managedServices";
import { grantsFor } from "./toolGrants";

const cockpitSkill = {
  skillId: "cockpit",
  name: "cockpit-agent",
  version: 1,
  bodyHash: "c".repeat(64),
  tenantId: null,
};
const config: ManagedServiceConfig = {
  tenantId: "tenant-a",
  serviceId: "social",
  revision: 1,
  goal: "Prepare a weekly campaign",
  operationIds: ["social.prepare", "social.report"],
  budgetLimitCents: 100,
  accounts: [
    {
      provider: "buffer",
      connectionId: "buffer-connection",
      accountId: "channel-a",
      connectionRevision: 1,
    },
    {
      provider: "zernio",
      connectionId: "zernio-connection",
      accountId: "account-a",
      connectionRevision: 1,
    },
  ],
  skills: [cockpitSkill],
};
const trusted: TrustedServiceCapabilitySnapshot = {
  tenantId: "tenant-a",
  permissionRevision: 1,
  admittedOperationIds: ["social.prepare", "social.report"],
  toolGrants: grantsFor({}),
  availableToolNames: ["readBufferChannels", "stageBufferPost", "readZernioEngagement"],
  accounts: config.accounts.map((account) => ({ ...account, connected: true })),
  skills: config.skills.map((skill) => ({ ...skill, qualified: true })),
};
const nodes = [
  {
    id: "prepare",
    operationId: "social.prepare",
    dependsOn: [],
    accountIds: ["channel-a"],
    skillIds: ["cockpit"],
  },
  {
    id: "report",
    operationId: "social.report",
    dependsOn: ["prepare"],
    accountIds: ["account-a"],
    skillIds: ["cockpit"],
  },
] as const satisfies readonly ServiceCompositionNode[];
describe("managed service policy", () => {
  it("admits only explicit, native-qualified operations with current owned account pins", () => {
    expect(deriveManagedServiceReadiness(config, trusted)).toEqual({ ready: true, reasons: [] });
    expect(deriveManagedServiceReadiness(config, { ...trusted, admittedOperationIds: [] })).toEqual(
      { ready: false, reasons: ["operation_unqualified"] },
    );
    expect(() =>
      deriveManagedServiceReadiness(config, { ...trusted, tenantId: "tenant-b" }),
    ).toThrow("foreign_tenant");
  });
  it("refuses missing, disconnected, changed-connection and substituted account pins", () => {
    for (const accounts of [
      [],
      trusted.accounts.map((a) => ({ ...a, connected: false })),
      trusted.accounts.map((a) => ({ ...a, connectionRevision: 2 })),
      trusted.accounts.map((a) => ({ ...a, connectionId: "other" })),
    ]) {
      expect(deriveManagedServiceReadiness(config, { ...trusted, accounts }).reasons).toContain(
        "account_unavailable",
      );
    }
    expect(deriveManagedServiceReadiness({ ...config, accounts: [] }, trusted).reasons).toContain(
      "missing_account",
    );
  });
  it("does not let a leaf allow-list acquire social Executive authority", () => {
    const leaf = grantsFor({ toolNames: ["stageBufferPost", "dispatchResearch"] });
    expect(
      deriveManagedServiceReadiness(config, { ...trusted, toolGrants: leaf }).reasons,
    ).toContain("missing_tool_grant");
    expect(
      deriveManagedServiceReadiness(config, {
        ...trusted,
        availableToolNames: ["readZernioEngagement"],
      }).reasons,
    ).toContain("missing_tool_grant");
  });
  it("binds a pack to the exact qualified skill and preserves foreign-overlay refusal", () => {
    const skill = {
      skillId: "skill-a",
      name: "pack-campaign-plan",
      version: 2,
      bodyHash: "a".repeat(64),
      tenantId: null,
    };
    const pack: ManagedServiceConfig = {
      ...config,
      operationIds: ["workflow.pack.run"],
      skills: [skill],
      accounts: [],
    };
    const native: TrustedServiceCapabilitySnapshot = {
      ...trusted,
      admittedOperationIds: ["workflow.pack.run"],
      skills: [{ ...skill, qualified: true }],
    };
    expect(deriveManagedServiceReadiness(pack, native).ready).toBe(true);
    for (const changed of [
      { qualified: false },
      { bodyHash: "b".repeat(64) },
      { version: 1 },
      { skillId: "other" },
    ]) {
      expect(
        deriveManagedServiceReadiness(pack, {
          ...native,
          skills: [{ ...skill, qualified: true, ...changed }],
        }).reasons,
      ).toContain("skill_unqualified");
    }
    expect(() =>
      validateManagedServiceConfig({ ...pack, skills: [{ ...skill, tenantId: "tenant-b" }] }),
    ).toThrow("foreign_tenant");
    expect(deriveManagedServiceReadiness({ ...pack, skills: [] }, native).reasons).toContain(
      "missing_skill",
    );
    const unrelated = { ...skill, name: "offer-architect" };
    expect(
      deriveManagedServiceReadiness(
        { ...pack, skills: [unrelated] },
        { ...native, skills: [{ ...unrelated, qualified: true }] },
      ).reasons,
    ).toContain("missing_skill");
    expect(() =>
      validateServiceComposition(
        pack,
        [
          {
            id: "pack",
            operationId: "workflow.pack.run",
            dependsOn: [],
            accountIds: [],
            skillIds: [skill.skillId],
          },
        ],
        native,
      ),
    ).not.toThrow();
  });
  it("requires an exact qualified global cockpit pin for every Executive operation", () => {
    expect(deriveManagedServiceReadiness({ ...config, skills: [] }, trusted).reasons).toContain(
      "missing_skill",
    );
    expect(deriveManagedServiceReadiness(config, { ...trusted, skills: [] }).reasons).toContain(
      "skill_unqualified",
    );
    const overlay = { ...cockpitSkill, tenantId: config.tenantId };
    expect(
      deriveManagedServiceReadiness(
        { ...config, skills: [overlay] },
        { ...trusted, skills: [{ ...overlay, qualified: true }] },
      ).reasons,
    ).toContain("missing_skill");
  });
  it("rejects unknown publish/HTTP operations and malformed budgets/configuration", () => {
    expect(() =>
      validateManagedServiceConfig({ ...config, qualified: true } as ManagedServiceConfig),
    ).toThrow("invalid_configuration");
    expect(() =>
      validateManagedServiceConfig({
        ...config,
        accounts: config.accounts.map((account) => ({ ...account, token: "untrusted" })),
      }),
    ).toThrow("invalid_configuration");
    const forgedSkill = { ...cockpitSkill, qualified: true };
    expect(() =>
      validateManagedServiceConfig({
        ...config,
        skills: [forgedSkill],
      }),
    ).toThrow("invalid_configuration");
    for (const operation of ["social.publish", "http.request", "__proto__"])
      expect(() =>
        validateManagedServiceConfig({
          ...config,
          operationIds: [operation as ManagedServiceOperationId],
        }),
      ).toThrow("unknown_operation");
    for (const budgetLimitCents of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => validateManagedServiceConfig({ ...config, budgetLimitCents })).toThrow(
        "invalid_configuration",
      );
    expect(() =>
      validateManagedServiceConfig({
        ...config,
        operationIds: ["social.prepare", "social.prepare"],
      }),
    ).toThrow("invalid_configuration");
  });
  it("makes goals/accounts/grants budget edits material while revision-only changes are not", () => {
    expect(isMaterialServiceChange(config, { ...config, revision: 2 })).toBe(false);
    expect(isMaterialServiceChange(config, { ...config, goal: "Another goal" })).toBe(true);
    expect(isMaterialServiceChange(config, { ...config, budgetLimitCents: 200 })).toBe(true);
    expect(
      isMaterialServiceChange(config, {
        ...config,
        accounts: config.accounts.map((a) => ({ ...a, connectionRevision: 2 })),
      }),
    ).toBe(true);
  });
  it("requires explicit reconfiguration after pause/stop and never replays unknown work", () => {
    expect(transitionManagedService("ready", "start")).toBe("running");
    expect(transitionManagedService("running", "pause")).toBe("paused");
    expect(transitionManagedService("running", "stop")).toBe("stopped");
    expect(transitionManagedService("paused", "configure")).toBe("ready");
    for (const state of ["paused", "stopped", "failed", "completed", "unknown"] as const)
      expect(() => transitionManagedService(state, "start")).toThrow("invalid_transition");
    for (const event of ["configure", "stop", "start"] as const)
      expect(() => transitionManagedService("unknown", event)).toThrow("invalid_transition");
    expect(() =>
      transitionManagedService(
        "__proto__" as ManagedServiceState,
        "toString" as ManagedServiceEvent,
      ),
    ).toThrow("invalid_transition");
  });
  it("fences the next local claim on pause, stop, revision or permission change", () => {
    const claim = {
      state: "running" as const,
      runRevision: 1,
      currentRevision: 1,
      permissionRevision: 1,
      currentPermissionRevision: 1,
    };
    expect(evaluateServiceClaim(claim)).toEqual({ allowed: true, reason: "ready" });
    for (const state of ["paused", "stopped", "unknown"] as const)
      expect(evaluateServiceClaim({ ...claim, state }).allowed).toBe(false);
    expect(evaluateServiceClaim({ ...claim, currentRevision: 2 }).reason).toBe("revision_changed");
    expect(evaluateServiceClaim({ ...claim, currentPermissionRevision: 2 }).reason).toBe(
      "permissions_changed",
    );
    // This function decides only a future claim, never promises cancellation of accepted Buffer work.
    expect(Object.keys(evaluateServiceClaim(claim))).toEqual(["allowed", "reason"]);
  });
  it("accepts a bounded pinned DAG without mutating the proposal", () => {
    const before = JSON.stringify(nodes);
    expect(() => validateServiceComposition(config, nodes, trusted)).not.toThrow();
    expect(JSON.stringify(nodes)).toBe(before);
  });
  it("rejects cycles, missing dependencies, unowned references and authority expansion", () => {
    for (const extra of [
      { toolNames: ["approveBufferPost"] },
      { url: "https://example.invalid" },
      { qualified: true },
    ]) {
      expect(() =>
        validateServiceComposition(config, [{ ...nodes[0], ...extra }], trusted),
      ).toThrow("invalid_composition");
    }
    expect(() =>
      validateServiceComposition(config, [null as unknown as ServiceCompositionNode], trusted),
    ).toThrow("invalid_composition");
    expect(() =>
      validateServiceComposition(config, [{ ...nodes[0], skillIds: [] }], trusted),
    ).toThrow("invalid_composition");
    expect(() =>
      validateServiceComposition(
        config,
        [{ ...nodes[0], dependsOn: ["report"] }, nodes[1]],
        trusted,
      ),
    ).toThrow("composition_cycle");
    expect(() =>
      validateServiceComposition(config, [{ ...nodes[0], dependsOn: ["missing"] }], trusted),
    ).toThrow("invalid_composition");
    expect(() =>
      validateServiceComposition(config, [{ ...nodes[0], accountIds: ["foreign"] }], trusted),
    ).toThrow("invalid_composition");
    expect(() =>
      validateServiceComposition(config, [{ ...nodes[0], skillIds: ["foreign"] }], trusted),
    ).toThrow("invalid_composition");
    expect(() =>
      validateServiceComposition(
        config,
        [{ ...nodes[0], operationId: "business.review" }],
        trusted,
      ),
    ).toThrow("invalid_composition");
    expect(() =>
      validateServiceComposition(config, nodes, { ...trusted, admittedOperationIds: [] }),
    ).toThrow("service_not_ready");
  });
  it("bounds total work and fan-out independently of cycle checks", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...nodes[0], id: `node-${i}` }));
    expect(() => validateServiceComposition(config, many, trusted)).toThrow("composition_bounds");
    const fanout = [
      nodes[0],
      ...Array.from({ length: 5 }, (_, i) => ({ ...nodes[1], id: `child-${i}` })),
    ];
    expect(() => validateServiceComposition(config, fanout, trusted)).toThrow("composition_bounds");
  });
});
