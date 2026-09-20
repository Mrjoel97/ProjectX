type SpawnResult = {
  error?: { code?: string };
  signal?: string | null;
  status?: number | null;
};

/** Closed diagnostics only: never include raw CLI stderr or payloads in test artifacts. */
export function noOutputReason(result: SpawnResult): string {
  if (result.error) {
    return ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM"].includes(result.error.code ?? "")
      ? `spawn_${result.error.code}`
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
