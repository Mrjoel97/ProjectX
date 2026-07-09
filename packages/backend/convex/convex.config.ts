import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import actionRetrier from "@convex-dev/action-retrier/convex.config.js";

const app = defineApp();

// All five Phase-1 components. Pinned pre-1.0 versions — do not bump casually.
app.use(workflow);
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(actionRetrier);

export default app;
