import { isCustomerWorkflowPilotTenant } from "@pikar/core/customerWorkflowPilot";

export function customerWorkflowPilotEnabled(tenantId: string): boolean {
  return isCustomerWorkflowPilotTenant(tenantId, process.env.CUSTOMER_WORKFLOWS_PILOT_TENANTS);
}

export function requireCustomerWorkflowPilot(ctx: { tenantId: string }): void {
  if (!customerWorkflowPilotEnabled(ctx.tenantId))
    throw new Error("CUSTOMER_WORKFLOW_PILOT_DISABLED");
}
