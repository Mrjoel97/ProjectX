// IMPR-02 trajectory export — the SEPARATE, PII-scrubbed export plane the CI SkillOpt job pulls
// from. This plane carries REAL delivered bodies + user comments (distinct from the refs-only audit
// log, CLAUDE.md §4). Scrubbing happens HERE, before anything leaves the system, via packages/pii.
// The endpoint (http.ts /skillopt/export) authenticates; this query builds the scrubbed JSON.
//
// internalQuery from ./_generated/server is NOT banned by the import guard (the guardrails.ts /
// optimizerConfig.ts precedent — no allowlist entry needed).
import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { scanText } from "@pikar/pii";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// ponytail: offline-only forced-failure hook mirroring intake.ts/vaultExtract.ts — a field
// containing this sentinel routes into scanText's OWN non-string Err branch so the fail-closed DROP
// path is exercisable in a unit test WITHOUT faking scanText. Remove once a @pikar/pii poison
// fixture exists at the package layer.
const PII_POISON_SENTINEL = "PII_POISON::";

const scrub = (text: string) =>
  text.includes(PII_POISON_SENTINEL) ? scanText(undefined) : scanText(text);

// FNV-1a — a tiny deterministic string hash for the train/valid split. Same requestId → same bucket
// every run; ~1/5 land in "valid". Not cryptographic (the split just needs to be stable, not
// unguessable). ponytail: 6-line pure hash over a whole dependency — a split key needs nothing more.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build the scrubbed trajectory export for one gated skill (IMPR-02). Joins every feedback row to
 * its originating request, PII-scrubs every text field through packages/pii, and emits ONLY safeText
 * + counts — raw values NEVER leave. Fail-closed: if ANY field can't be scrubbed, the whole
 * trajectory is dropped (a half-scrubbed export is a leak). Unrated/unattributable trajectories
 * (no request, no skillVersion) are skipped. The Python dataloader.py consumes this shape verbatim.
 */
export const buildTrajectoryExport = internalQuery({
  args: { skillName: v.optional(v.literal(COCKPIT_AGENT_SKILL)) },
  handler: async (ctx, { skillName }) => {
    const name = skillName ?? COCKPIT_AGENT_SKILL;
    const feedback = await ctx.db
      .query("feedback")
      .withIndex("by_skill", (q) => q.eq("skillName", name))
      .collect();

    const items: Array<{
      id: string;
      task_description: string;
      conversation: { role: "user" | "assistant"; content: string }[];
      hard: number;
      soft: number;
      skillVersion: number;
      split: "train" | "valid";
      counts: Record<"email" | "card" | "ssn" | "phone", number>;
    }> = [];

    for (const fb of feedback) {
      const request = await ctx.db.get(fb.requestId);
      // Skip unattributable (no request, or a pre-Phase-8 request with no resolvable skillVersion).
      if (!request || request.skillVersion === undefined) continue;

      // ponytail: names-in-prose are NOT scrubbed — packages/pii is STRUCTURED PII only (emails,
      // Luhn cards, US SSNs, phones); a person name typed into a goal/body/comment SURVIVES this
      // scrub. Accepted ceiling for the solo-owner / own-tenant beta export (the CI pulls the
      // owner's OWN tenant data). This is a HARD BLOCKER before Phase 9 multi-user — names crossing
      // to another tenant needs NER/Presidio here first. See RESEARCH Pitfall 2 + the Plan 08
      // playbook note. Do NOT ship this export cross-tenant until names-in-prose is closed.
      const goal = scrub(request.goal);
      const body = scrub(request.editedBody ?? request.draft ?? "");
      const comment = fb.comment !== undefined ? scrub(fb.comment) : undefined;

      // Fail-closed: any scan Err drops the ENTIRE trajectory — never ship partially-scrubbed text.
      if (!goal.ok || !body.ok || (comment !== undefined && !comment.ok)) continue;

      const counts = { email: 0, card: 0, ssn: 0, phone: 0 };
      for (const scan of comment ? [goal, body, comment] : [goal, body]) {
        if (!scan.ok) continue; // unreachable (guarded above) — narrows the Result union
        for (const k of ["email", "card", "ssn", "phone"] as const)
          counts[k] += scan.value.counts[k];
      }

      const conversation: { role: "user" | "assistant"; content: string }[] = [
        { role: "user", content: goal.value.safeText },
        { role: "assistant", content: body.value.safeText },
      ];
      // The feedback rationale (the "why" reflect() reads) — scrubbed, as a trailing user turn.
      if (comment?.ok) conversation.push({ role: "user", content: comment.value.safeText });

      items.push({
        id: fb.requestId,
        task_description: goal.value.safeText,
        conversation,
        hard: fb.rating === "up" ? 1 : 0,
        soft: 0, // reserved; 0 for beta
        skillVersion: request.skillVersion,
        split: hashString(fb.requestId) % 5 === 0 ? "valid" : "train",
        counts,
      });
    }

    return { skillName: name, items };
  },
});
