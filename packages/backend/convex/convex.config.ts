import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import actionRetrier from "@convex-dev/action-retrier/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import cache from "@convex-dev/action-cache/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();

// All five Phase-1 components. Pinned pre-1.0 versions — do not bump casually.
app.use(workflow);
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(actionRetrier);

// Phase-2 components (OPSG-06, OPSG-01). Registered BEFORE the first schema
// change so codegen emits components.migrations + components.auditCounts before
// any plan file imports them. Pinned exact — do not bump casually (CLAUDE.md §6).
app.use(migrations);
app.use(aggregate, { name: "auditCounts" });

// Phase-3 component (GRDL-04). Pinned exact — do not bump casually (CLAUDE.md §6).
app.use(cache);

// Phase-15.3 (VALT-06). The named ingest pool — `{ name }` is REQUIRED: the component declares
// itself `defineComponent("workpool")`, so without it the generated identifier is
// `components.workpool` and a SECOND pool could never be registered beside it (the
// `app.use(aggregate, { name: "auditCounts" })` precedent above). Pinned exact — do not bump
// casually (CLAUDE.md §6). The client + its maxParallelism live in `index.ts`.
app.use(workpool, { name: "vaultIngestPool" });

export default app;
