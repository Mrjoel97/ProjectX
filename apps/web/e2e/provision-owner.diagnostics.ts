type SpawnResult = {
  error?: Error | { code?: string };
  signal?: string | null;
  status?: number | null;
};

/** Closed diagnostics only: never include raw CLI stderr or payloads in test artifacts. */
export function noOutputReason(result: SpawnResult): string {
  if (result.error) {
    const code = "code" in result.error ? result.error.code : undefined;
    return ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM"].includes(code ?? "")
      ? `spawn_${code}`
      : "spawn_unknown";
  }
  if (result.signal) {
    return ["SIGTERM", "SIGKILL", "SIGABRT"].includes(result.signal)
      ? `signal_${result.signal}`
      : "signal_other";
  }
  return result.status === 0 ? "exit_zero_no_output" : "exit_nonzero";
}

export function jsonValue(fn: string, stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`${fn} returned invalid JSON`);
  }
}

export function inviteCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" && /^[A-Z0-9-]+$/.test(code) ? code : null;
}

export function durableUserId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const userId = (value as Record<string, unknown>).userId;
  return typeof userId === "string" && /^[a-z0-9]+$/.test(userId) ? userId : null;
}

export type ProvisioningOwnerLookup = { kind: "absent" } | { kind: "found"; userId: string };

/** The E2E-only envelope keeps a real null absence observable through the Convex CLI. */
export function provisioningOwnerLookup(value: unknown): ProvisioningOwnerLookup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = (value as Record<string, unknown>).result;
  if (result === null) return { kind: "absent" };
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  const userId = durableUserId(row);
  return userId && typeof row.owner === "boolean" ? { kind: "found", userId } : null;
}

export function ownerGrant(value: unknown, userId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.userId === userId && typeof row.changed === "boolean";
}

export function onboardedTenant(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.vaultDocId === "string" &&
    /^[a-z0-9]+$/.test(row.vaultDocId) &&
    typeof row.tier === "string" &&
    row.tier.length > 0
  );
}
