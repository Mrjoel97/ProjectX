/** Deployment-operator-only admission for one native test tenant. Global release
 * flags remain independent; this grant never admits general/document voice. */
// Leave time to open the app before starting a full fifteen-minute voice session.
export const FOUNDATION_PILOT_MAX_MS = 30 * 60_000;

export function foundationPilotExpiresAt(
  raw: string | undefined,
  tenantId: string,
  now = Date.now(),
): number | undefined {
  if (!raw || raw.length > 512 || !Number.isSafeInteger(now)) return undefined;
  try {
    const grant: unknown = JSON.parse(raw);
    if (!grant || typeof grant !== "object" || Array.isArray(grant)) return undefined;
    const value = grant as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(",") !== "expiresAt,issuedAt,tenantId" ||
      typeof value.tenantId !== "string" ||
      !/^[a-z0-9]{20,64}$/.test(value.tenantId) ||
      value.tenantId !== tenantId ||
      typeof value.issuedAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.issuedAt) ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.issuedAt < 0 ||
      value.issuedAt > now ||
      value.expiresAt <= now ||
      value.expiresAt <= value.issuedAt ||
      value.expiresAt - value.issuedAt > FOUNDATION_PILOT_MAX_MS
    )
      return undefined;
    return value.expiresAt;
  } catch {
    return undefined;
  }
}
