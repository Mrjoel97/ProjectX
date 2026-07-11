// OPSG-01 (counting half). `audit` is append-only and unbounded, so a
// `.collect()`-based count eventually exceeds Convex read limits and HARD-FAILS.
// This aggregate keeps a per-tenant count so audit rows are countable in O(log n).
import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const auditCounts = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "audit";
}>(components.auditCounts, {
  namespace: (doc) => doc.tenantId,
  sortKey: (doc) => doc.ts,
});
