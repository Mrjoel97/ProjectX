import { WorkflowManager } from "@convex-dev/workflow";
import { ActionRetrier } from "@convex-dev/action-retrier";
import { components } from "./_generated/api";

// Durable workflow orchestrator with default action-retry behavior (exp backoff).
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 100, base: 2 },
    retryActionsByDefault: true,
  },
});

// Reliable wrapper around external (sidecar/LLM/email) fetch calls.
export const retrier = new ActionRetrier(components.actionRetrier);
