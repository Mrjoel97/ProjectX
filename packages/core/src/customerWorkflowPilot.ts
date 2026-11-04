/** Pilot admission is explicit per tenant and defaults to closed on malformed configuration. */
export function isCustomerWorkflowPilotTenant(tenantId: string, configuration?: string): boolean {
  if (!tenantId || !configuration || configuration.length > 32768) return false;
  try {
    const tenants: unknown = JSON.parse(configuration);
    return (
      Array.isArray(tenants) &&
      tenants.length <= 100 &&
      tenants.every(
        (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 256,
      ) &&
      tenants.includes(tenantId)
    );
  } catch {
    return false;
  }
}
