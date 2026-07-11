// Email-drafter output contract (AGNT-02).
//
// The drafter emits a subject + plain-text body ONLY. The recipient is supplied
// structurally by intake (02-03) and is NEVER model-derived (CONTEXT) — so it is
// deliberately absent from this schema. Lives in @pikar/contracts (CLAUDE.md §1)
// so the "use node" adapter (convex/llm.ts) stays zod-free and thin, mirroring
// routingSchema.

import { z } from "zod";

/** Model-generated email draft: a subject line and a plain-text body. */
export const draftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

/** Inferred draft shape. */
export type DraftOutput = z.infer<typeof draftSchema>;
