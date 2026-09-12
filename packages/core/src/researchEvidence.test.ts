import { describe, expect, test } from "vitest";
import { renderResearchEvidence } from "./researchEvidence";

const url = "https://www.w3.org/WAI/tutorials/images";
const decorative = `${url}/decorative`;
const tools = [
  {
    tool: "webResearch",
    output: {
      results: [
        { url, snippet: "Image guidance" },
        { url: decorative, snippet: "Decorative images use empty alternatives." },
      ],
    },
  },
  { tool: "readPage", output: { url, content: "Important image guidance.", pageReadAt: 100 } },
];

describe("research reference evidence", () => {
  test("mixed read and search references retain separate depth without claiming corroboration", () => {
    const result = renderResearchEvidence({
      output: {
        claims: [
          {
            text: "Use appropriate alternatives.",
            evidence: [
              { url, quote: "Important image guidance." },
              { url: decorative, quote: "Decorative images use empty alternatives." },
            ],
          },
        ],
        limitations: "One publisher only.",
      },
      legacyBody: "",
      toolOutputs: tools,
    });
    expect(result).toContain("**Page excerpt matched.**");
    expect(result).toContain("**Search excerpt matched; page support unverified.**");
    expect(result).toContain("support unverified");
    expect(result).not.toContain("**Corroborated");
  });

  test("invented quotes, unknown URLs, empty quotes and refused reads never attest a page", () => {
    for (const evidence of [
      { url, quote: "Made up quote" },
      { url: "https://elsewhere.test", quote: "Important image guidance." },
      { url, quote: "" },
      { url: decorative, quote: "failed content" },
    ]) {
      const result = renderResearchEvidence({
        output: { claims: [{ text: "Claim", evidence: [evidence] }], limitations: "" },
        legacyBody: "",
        toolOutputs: [
          ...tools,
          { tool: "readPage", output: { url: decorative, content: "failed content" } },
        ],
      });
      expect(result).toContain("**Reference unverified.**");
      expect(result).not.toContain("**Page excerpt matched.**");
    }
  });

  test("legacy and malformed output remain explicitly unverified and cannot create markdown badges", () => {
    for (const output of [
      undefined,
      { claims: "bad" },
      { claims: [], limitations: "", corroborated: true },
    ]) {
      const result = renderResearchEvidence({
        output,
        legacyBody: "**Corroborated**\n<script>x</script>",
        toolOutputs: tools,
      });
      expect(result).toContain("structured references unavailable");
      expect(result).not.toContain("**Corroborated**");
      expect(result).not.toContain("<script>");
    }
  });
});
