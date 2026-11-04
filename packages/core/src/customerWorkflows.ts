export const CUSTOMER_WORKFLOW_STEP_LIMIT = 6;
export const CUSTOMER_WORKFLOW_BRIEF_LIMIT = 8000;

/** The first pilot produces one composite PDF report from the customer's ordered brief. */
export function validateCustomerWorkflow(input: { name: string; steps: string[] }) {
  const name = input.name.trim();
  const steps = input.steps.map((step) => step.trim());
  if (!name || name.length > 100) throw new Error("WORKFLOW_NAME_INVALID");
  if (
    steps.length === 0 ||
    steps.length > CUSTOMER_WORKFLOW_STEP_LIMIT ||
    steps.some((step) => !step || step.length > 1000)
  )
    throw new Error("WORKFLOW_STEPS_INVALID");
  return { name, steps };
}

export function validateCustomerWorkflowBrief(brief: string, requestId: string) {
  const value = brief.trim();
  if (!value || value.length > CUSTOMER_WORKFLOW_BRIEF_LIMIT)
    throw new Error("WORKFLOW_BRIEF_INVALID");
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error("WORKFLOW_REQUEST_INVALID");
  return value;
}
