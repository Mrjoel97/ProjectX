import type { ToolGrants } from "./toolGrants";

export const MANAGED_SERVICE_RUN_LIFETIME_MS = 60 * 60 * 1000;

import { WORKFLOW_PACKS } from "./workflowPacks";

/** Pure policy only. These operations grant no runtime, publishing or scheduling authority. */
export const MANAGED_SERVICE_OPERATIONS = {
  "social.prepare": { tools: ["readBufferChannels", "stageBufferPost"], executive: true },
  "social.report": { tools: ["readZernioEngagement"], executive: true },
  "business.review": { tools: [], executive: true },
  "workflow.pack.run": { tools: [], executive: false },
} as const;
export type ManagedServiceOperationId = keyof typeof MANAGED_SERVICE_OPERATIONS;
export type ServiceAccountPin = Readonly<{
  provider: "buffer" | "zernio";
  connectionId: string;
  accountId: string;
  connectionRevision: number;
}>;
export type ServiceSkillPin = Readonly<{
  skillId: string;
  name: string;
  version: number;
  bodyHash: string;
  /** null identifies a global skill; tenant overlays must match the service owner. */
  tenantId: string | null;
}>;
export type ManagedServiceConfig = Readonly<{
  tenantId: string;
  serviceId: string;
  revision: number;
  goal: string;
  operationIds: readonly ManagedServiceOperationId[];
  accounts: readonly ServiceAccountPin[];
  skills: readonly ServiceSkillPin[];
  budgetLimitCents: number;
}>;
export type ManagedServiceRuntimeScope = Pick<
  ManagedServiceConfig,
  "operationIds" | "accounts" | "skills"
>;

/** Intersect these names with native grants; operation text never creates a grant. */
export function managedServiceToolNames(
  operations: readonly ManagedServiceOperationId[],
): readonly string[] {
  const names = new Set<string>();
  for (const operation of operations) {
    if (!isManagedServiceOperationId(operation)) refuse("unknown_operation");
    for (const name of MANAGED_SERVICE_OPERATIONS[operation].tools) names.add(name);
  }
  return [...names];
}

export type ManagedServicePolicyCode =
  | "invalid_configuration"
  | "unknown_operation"
  | "foreign_tenant"
  | "invalid_composition"
  | "composition_cycle"
  | "composition_bounds"
  | "service_not_ready"
  | "invalid_transition";
export class ManagedServicePolicyError extends Error {
  constructor(readonly code: ManagedServicePolicyCode) {
    super(code);
  }
}
function refuse(code: ManagedServicePolicyCode): never {
  throw new ManagedServicePolicyError(code);
}
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200;
const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 1;
const hasExactKeys = (value: unknown, keys: readonly string[]): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && keys.includes(key))
  );
};
export function isManagedServiceOperationId(value: string): value is ManagedServiceOperationId {
  return Object.hasOwn(MANAGED_SERVICE_OPERATIONS, value);
}

export function validateManagedServiceConfig(config: ManagedServiceConfig): void {
  if (
    !hasExactKeys(config, [
      "tenantId",
      "serviceId",
      "revision",
      "goal",
      "operationIds",
      "accounts",
      "skills",
      "budgetLimitCents",
    ]) ||
    !validId(config.tenantId) ||
    !validId(config.serviceId) ||
    !validRevision(config.revision) ||
    typeof config.goal !== "string" ||
    !config.goal.trim() ||
    config.goal.length > 2000 ||
    !Number.isSafeInteger(config.budgetLimitCents) ||
    config.budgetLimitCents < 0 ||
    !Array.isArray(config.operationIds) ||
    config.operationIds.length < 1 ||
    config.operationIds.length > 4 ||
    new Set(config.operationIds).size !== config.operationIds.length ||
    !Array.isArray(config.accounts) ||
    config.accounts.length > 8 ||
    !Array.isArray(config.skills) ||
    config.skills.length > 8
  )
    refuse("invalid_configuration");
  for (const operation of config.operationIds) {
    if (!isManagedServiceOperationId(operation)) refuse("unknown_operation");
  }
  const accountKeys = new Set<string>();
  for (const account of config.accounts) {
    if (
      !hasExactKeys(account, ["provider", "connectionId", "accountId", "connectionRevision"]) ||
      !["buffer", "zernio"].includes(account.provider) ||
      !validId(account.connectionId) ||
      !validId(account.accountId) ||
      !validRevision(account.connectionRevision)
    )
      refuse("invalid_configuration");
    const key = `${account.provider}:${account.accountId}`;
    if (accountKeys.has(key)) refuse("invalid_configuration");
    accountKeys.add(key);
  }
  const skillIds = new Set<string>();
  const skillNames = new Set<string>();
  for (const skill of config.skills) {
    if (
      !hasExactKeys(skill, ["skillId", "name", "version", "bodyHash", "tenantId"]) ||
      !validId(skill.skillId) ||
      !validId(skill.name) ||
      !validRevision(skill.version) ||
      typeof skill.bodyHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(skill.bodyHash)
    )
      refuse("invalid_configuration");
    if (skill.tenantId !== null && skill.tenantId !== config.tenantId) refuse("foreign_tenant");
    if (skillIds.has(skill.skillId) || skillNames.has(skill.name)) refuse("invalid_configuration");
    skillIds.add(skill.skillId);
    skillNames.add(skill.name);
  }
}

/** Every setup edit is material; the adapter owns the monotonic revision/CAS write. */
export function isMaterialServiceChange(
  before: ManagedServiceConfig,
  after: ManagedServiceConfig,
): boolean {
  validateManagedServiceConfig(before);
  validateManagedServiceConfig(after);
  const material = ({ revision: _revision, ...setup }: ManagedServiceConfig) => setup;
  return JSON.stringify(material(before)) !== JSON.stringify(material(after));
}

/** Must be built from native server reads, never accepted from an agent or browser. */
export type TrustedServiceCapabilitySnapshot = Readonly<{
  tenantId: string;
  permissionRevision: number;
  admittedOperationIds: readonly ManagedServiceOperationId[];
  toolGrants: ToolGrants;
  availableToolNames: readonly string[];
  accounts: readonly (ServiceAccountPin & { connected: boolean })[];
  skills: readonly (ServiceSkillPin & { qualified: boolean })[];
}>;
export type ManagedServiceReadinessReason =
  | "operation_unqualified"
  | "missing_tool_grant"
  | "account_unavailable"
  | "skill_unqualified"
  | "missing_account"
  | "missing_skill";
const sameAccount = (a: ServiceAccountPin, b: ServiceAccountPin) =>
  a.provider === b.provider &&
  a.connectionId === b.connectionId &&
  a.accountId === b.accountId &&
  a.connectionRevision === b.connectionRevision;
const sameSkill = (a: ServiceSkillPin, b: ServiceSkillPin) =>
  a.skillId === b.skillId &&
  a.name === b.name &&
  a.version === b.version &&
  a.bodyHash === b.bodyHash &&
  a.tenantId === b.tenantId;
const isPackSkill = (skill: ServiceSkillPin) =>
  Object.values(WORKFLOW_PACKS).some((pack) => pack.skillName === skill.name);
const isExecutiveSkill = (skill: ServiceSkillPin) =>
  skill.name === "cockpit-agent" && skill.tenantId === null;

export function deriveManagedServiceReadiness(
  config: ManagedServiceConfig,
  trusted: TrustedServiceCapabilitySnapshot,
): Readonly<{ ready: boolean; reasons: readonly ManagedServiceReadinessReason[] }> {
  validateManagedServiceConfig(config);
  if (config.tenantId !== trusted.tenantId) refuse("foreign_tenant");
  if (!validRevision(trusted.permissionRevision)) refuse("invalid_configuration");
  const reasons = new Set<ManagedServiceReadinessReason>();
  for (const operation of config.operationIds) {
    const policy = MANAGED_SERVICE_OPERATIONS[operation];
    if (!trusted.admittedOperationIds.includes(operation)) reasons.add("operation_unqualified");
    if (
      (policy.executive && !trusted.toolGrants.dispatch) ||
      policy.tools.some((tool) => !trusted.availableToolNames.includes(tool))
    )
      reasons.add("missing_tool_grant");
    const provider =
      operation === "social.prepare" ? "buffer" : operation === "social.report" ? "zernio" : null;
    if (provider && !config.accounts.some((account) => account.provider === provider))
      reasons.add("missing_account");
    if (policy.executive && !config.skills.some(isExecutiveSkill)) reasons.add("missing_skill");
    if (operation === "workflow.pack.run" && !config.skills.some(isPackSkill))
      reasons.add("missing_skill");
  }
  for (const account of config.accounts) {
    if (!trusted.accounts.some((current) => current.connected && sameAccount(account, current)))
      reasons.add("account_unavailable");
  }
  for (const skill of config.skills) {
    if (!trusted.skills.some((current) => current.qualified && sameSkill(skill, current)))
      reasons.add("skill_unqualified");
  }
  return { ready: reasons.size === 0, reasons: [...reasons] };
}

export const MANAGED_SERVICE_STATES = [
  "draft",
  "ready",
  "running",
  "paused",
  "stopped",
  "completed",
  "failed",
  "unknown",
] as const;
export type ManagedServiceState = (typeof MANAGED_SERVICE_STATES)[number];
export type ManagedServiceEvent =
  | "configure"
  | "start"
  | "pause"
  | "stop"
  | "complete"
  | "fail"
  | "uncertain";
const TRANSITIONS: Partial<
  Record<ManagedServiceState, Partial<Record<ManagedServiceEvent, ManagedServiceState>>>
> = {
  draft: { configure: "ready", stop: "stopped" },
  ready: { configure: "ready", start: "running", stop: "stopped" },
  running: {
    pause: "paused",
    stop: "stopped",
    complete: "completed",
    fail: "failed",
    uncertain: "unknown",
  },
  paused: { configure: "ready", stop: "stopped" },
  stopped: { configure: "ready" },
  completed: { configure: "ready" },
  failed: { configure: "ready" },
  // An uncertain paid/write outcome requires native reconciliation, never automatic replay.
  unknown: {},
};
export function transitionManagedService(
  state: ManagedServiceState,
  event: ManagedServiceEvent,
): ManagedServiceState {
  if (!Object.hasOwn(TRANSITIONS, state) || !Object.hasOwn(TRANSITIONS[state] ?? {}, event))
    refuse("invalid_transition");
  const next = TRANSITIONS[state]?.[event];
  if (!next) refuse("invalid_transition");
  return next;
}

/** Pause/Stop fences future local claims. Already accepted provider work is not cancelled. */
export function evaluateServiceClaim(input: {
  state: ManagedServiceState;
  runRevision: number;
  currentRevision: number;
  permissionRevision: number;
  currentPermissionRevision: number;
}): Readonly<{
  allowed: boolean;
  reason: "ready" | "not_running" | "revision_changed" | "permissions_changed";
}> {
  if (input.state !== "running") return { allowed: false, reason: "not_running" };
  if (!validRevision(input.runRevision) || input.runRevision !== input.currentRevision)
    return { allowed: false, reason: "revision_changed" };
  if (
    !validRevision(input.permissionRevision) ||
    input.permissionRevision !== input.currentPermissionRevision
  )
    return { allowed: false, reason: "permissions_changed" };
  return { allowed: true, reason: "ready" };
}

export type ServiceCompositionNode = Readonly<{
  id: string;
  operationId: ManagedServiceOperationId;
  dependsOn: readonly string[];
  accountIds: readonly string[];
  skillIds: readonly string[];
}>;
/** A bounded DAG of fixed operations, never arbitrary code, prompts, HTTP or tool requests. */
export function validateServiceComposition(
  config: ManagedServiceConfig,
  nodes: readonly ServiceCompositionNode[],
  trusted: TrustedServiceCapabilitySnapshot,
): void {
  if (!deriveManagedServiceReadiness(config, trusted).ready) refuse("service_not_ready");
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 8) refuse("composition_bounds");
  const byId = new Map<string, ServiceCompositionNode>();
  for (const node of nodes) {
    if (!hasExactKeys(node, ["id", "operationId", "dependsOn", "accountIds", "skillIds"]))
      refuse("invalid_composition");
    if (!validId(node.id) || byId.has(node.id)) refuse("invalid_composition");
    if (!isManagedServiceOperationId(node.operationId)) refuse("unknown_operation");
    if (!config.operationIds.includes(node.operationId)) refuse("invalid_composition");
    if (![node.dependsOn, node.accountIds, node.skillIds].every(Array.isArray))
      refuse("invalid_composition");
    if (node.dependsOn.length > 4 || node.accountIds.length > 8 || node.skillIds.length > 8)
      refuse("composition_bounds");
    if (
      new Set(node.dependsOn).size !== node.dependsOn.length ||
      new Set(node.accountIds).size !== node.accountIds.length ||
      new Set(node.skillIds).size !== node.skillIds.length ||
      node.accountIds.some(
        (id: string) => !config.accounts.some((account) => account.accountId === id),
      ) ||
      node.skillIds.some((id: string) => !config.skills.some((skill) => skill.skillId === id))
    )
      refuse("invalid_composition");
    const provider =
      node.operationId === "social.prepare"
        ? "buffer"
        : node.operationId === "social.report"
          ? "zernio"
          : null;
    if (
      provider &&
      !node.accountIds.some((id: string) =>
        config.accounts.some((a) => a.provider === provider && a.accountId === id),
      )
    )
      refuse("invalid_composition");
    const selectedSkill = config.skills.find((skill) => skill.skillId === node.skillIds[0]);
    if (
      node.skillIds.length !== 1 ||
      !selectedSkill ||
      (node.operationId === "workflow.pack.run"
        ? !isPackSkill(selectedSkill)
        : !isExecutiveSkill(selectedSkill))
    )
      refuse("invalid_composition");
    byId.set(node.id, node);
  }
  const children = new Map<string, number>();
  for (const node of nodes)
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) refuse("invalid_composition");
      const count = (children.get(dependency) ?? 0) + 1;
      if (count > 4) refuse("composition_bounds");
      children.set(dependency, count);
    }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) refuse("composition_cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.id);
}
