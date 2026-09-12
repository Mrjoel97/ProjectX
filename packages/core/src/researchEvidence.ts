/** Research references are model proposals. Only executable tool results attest excerpt access;
 * even an exact quote match does not establish that a claim follows from the excerpt. */
export type ResearchClaims = {
  claims: { text: string; evidence: { url: string; quote: string }[] }[];
  limitations: string;
};

export const RESEARCH_EVIDENCE_NOTICE =
  "Research claims and labels are model assessments, not verified facts. Only the source list confirms page reads; reading a page does not verify a claim or independent corroboration.";

export const researchClaimsSchema = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 4000 },
          evidence: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                url: { type: "string", maxLength: 2048 },
                quote: { type: "string", maxLength: 2000 },
              },
              required: ["url", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: ["text", "evidence"],
        additionalProperties: false,
      },
    },
    limitations: { type: "string", maxLength: 4000 },
  },
  required: ["claims", "limitations"],
  additionalProperties: false,
} as const;

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const bounded = (v: unknown, n: number): v is string => typeof v === "string" && v.length <= n;
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));

function valid(v: unknown): v is ResearchClaims {
  return (
    object(v) &&
    only(v, ["claims", "limitations"]) &&
    bounded(v.limitations, 4000) &&
    Array.isArray(v.claims) &&
    v.claims.length <= 20 &&
    v.claims.every(
      (c) =>
        object(c) &&
        only(c, ["text", "evidence"]) &&
        bounded(c.text, 4000) &&
        Array.isArray(c.evidence) &&
        c.evidence.length <= 8 &&
        c.evidence.every(
          (e) =>
            object(e) &&
            only(e, ["url", "quote"]) &&
            bounded(e.url, 2048) &&
            bounded(e.quote, 2000),
        ),
    )
  );
}

// All model/provider text is literal markdown text, so it cannot manufacture headings, badges,
// links or HTML that look like the code-owned reference assessment.
const literal = (s: string) => s.replace(/[\\`*_{}[\]()#+!|>~<-]/g, "\\$&").replace(/\r?\n/g, " ");

export function renderResearchEvidence(args: {
  output: unknown;
  legacyBody: string;
  toolOutputs: readonly { tool: string; output: unknown }[];
}): string {
  if (!valid(args.output))
    return `**Unverified research draft — structured references unavailable.**\n\n${literal(args.legacyBody)}`;

  const search = new Map<string, string[]>();
  const reads = new Map<string, string[]>();
  for (const entry of args.toolOutputs) {
    const out = entry.output;
    if (entry.tool !== "webResearch" || !object(out) || !Array.isArray(out.results)) continue;
    for (const r of out.results) {
      if (object(r) && typeof r.url === "string" && typeof r.snippet === "string")
        search.set(r.url, [...(search.get(r.url) ?? []), r.snippet]);
    }
  }
  for (const entry of args.toolOutputs) {
    const out = entry.output;
    if (
      entry.tool === "readPage" &&
      object(out) &&
      typeof out.url === "string" &&
      search.has(out.url) &&
      typeof out.content === "string" &&
      out.content.trim() &&
      typeof out.pageReadAt === "number" &&
      Number.isFinite(out.pageReadAt)
    )
      reads.set(out.url, [...(reads.get(out.url) ?? []), out.content]);
  }
  const claims = args.output.claims.map((claim, i) => {
    const refs = claim.evidence.map((ref) => {
      const matched = (values: string[] | undefined) =>
        ref.quote.trim().length > 0 && values?.some((s) => s.includes(ref.quote));
      const status = matched(reads.get(ref.url))
        ? "Page excerpt matched"
        : matched(search.get(ref.url))
          ? "Search excerpt matched; page support unverified"
          : "Reference unverified";
      return `- **${status}.** ${literal(ref.url)}${ref.quote.trim() ? ` — “${literal(ref.quote)}”` : ""}`;
    });
    return `### Claim ${i + 1} — model assessment, support unverified\n\n${literal(claim.text)}\n\n${refs.length ? refs.join("\n") : "No references supplied."}`;
  });
  return [
    ...claims,
    `**Model-reported limitations:** ${literal(args.output.limitations)}`,
    "Excerpt matching verifies only that the quoted text occurred in a tool result. It does not verify truth, claim support, or independent corroboration.",
  ].join("\n\n");
}
