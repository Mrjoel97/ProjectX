// RED stub — 28.1-03 Task 2. Replaced by the real implementation in the GREEN commit.
import { err, ok, type Result } from "@pikar/core/result";
export const PAYMENT_METHOD_BANK_TRANSFER = "";
export const UNRECONCILED_RETURN_DAYS = 0;
export const UNRECONCILED_SWEEP_DAYS = 0;
export type BillingMovement = { phase: string; amount: unknown; correlationId: string; kind: string; stripeObjectId: string };
export type BillingObservation = { kind: string };
export type Reconciliation = { movements: BillingMovement[]; observations: BillingObservation[] };
export function reconcileEvent(_e: unknown, _nowMs: number): Result<Reconciliation, string> {
  return err("not implemented") as Result<Reconciliation, string>;
}
void ok;
