/**
 * Per-segment copy. Lives here, not in `@pikar/core`: it is presentation language, and core owns
 * the structure and the maths only.
 *
 * `known` and `gap` are written to slot into the lede sentence ("I know X. I don't know Y."), so
 * they are noun phrases, never sentences. `seed` is the message the specialist handoff opens with —
 * phrased as the USER asking, because that is who appears to have sent it in the thread.
 */
export const SEGMENT_COPY: Record<
  string,
  { short: string; known: string; gap: string; from: string; seed: string }
> = {
  foundation: {
    short: "the basics",
    known: "what the business is",
    gap: "the basics — what this business is and what stage it's at",
    from: "from your profile",
    seed: "Help me describe what my business actually is, in one clear line.",
  },
  offer: {
    short: "your offer",
    known: "what you sell and who it's for",
    gap: "what you sell, or who it's for",
    from: "from your profile",
    seed: "Help me pin down my offer — what I sell, and exactly who it's for.",
  },
  "money-model": {
    short: "how you make money",
    known: "how you make money",
    gap: "how you price it or what it earns",
    from: "from your documents",
    seed: "Help me define how this business makes money — pricing, packages and margins.",
  },
  leads: {
    short: "where leads come from",
    known: "where leads come from",
    gap: "where leads come from",
    from: "not tracked yet",
    seed: "Help me work out where my leads should come from.",
  },
  direction: {
    short: "where you're heading",
    known: "where you're heading",
    gap: "where you're heading, or what's holding you back",
    from: "from your documents",
    seed: "Help me set the goals for this business and name the constraint holding it back.",
  },
  evidence: {
    short: "the evidence",
    known: "the documents behind this",
    gap: "which documents back this up",
    from: "from your vault",
    seed: "What do my vault documents say about this business that I haven't told you?",
  },
};

/** "a, b and c" — the lede reads as a sentence, so the list has to as well. */
export function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Which BLOCKED connection ids (connections.ts) are relevant to a segment's work. Only `leads`
 *  today: social posting is the lead engine's missing actuator. A segment absent here shows no
 *  blocked rows — absence of a blocker is not a fact worth a row. */
export const SEGMENT_BLOCKED: Record<string, readonly string[]> = {
  leads: ["social"],
};
