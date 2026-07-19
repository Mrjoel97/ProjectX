import { describe, expect, it } from "vitest";
import type { BriefSections, TranscriptTurn } from "./brief";
import { buildBriefMarkdown } from "./brief";

const filled: BriefSections = {
  summary: "Discussed Q3 GTM.",
  decisions: ["Ship beta 2026-08", "Hire a designer"],
  actionItems: ["Joel: draft pricing"],
  openQuestions: ["EU launch?"],
  discussion: "Long narrative goes here.",
};
const empty: BriefSections = {
  summary: "",
  decisions: [],
  actionItems: [],
  openQuestions: [],
  discussion: "",
};
const transcript: TranscriptTurn[] = [
  { speaker: "User", text: "Hi" },
  { speaker: "Agent", text: "Hello" },
];

describe("buildBriefMarkdown", () => {
  it("renders the sections in fixed order", () => {
    const md = buildBriefMarkdown(filled, transcript, "en");
    const order = [
      "## Summary",
      "## Decisions",
      "## Action items",
      "## Open questions",
      "## Discussion",
      "## Transcript",
    ];
    const positions = order.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("renders every empty section as the literal 'None'", () => {
    const md = buildBriefMarkdown(empty, [], "en");
    // 6 empty sections: summary, decisions, action items, open questions, discussion, transcript
    expect(md.match(/^None$/gm)?.length).toBe(6);
  });

  it("welds the transcript verbatim, turn-by-turn (never model-authored)", () => {
    const md = buildBriefMarkdown(empty, transcript, "en");
    expect(md).toContain("**User:** Hi");
    expect(md).toContain("**Agent:** Hello");
  });

  it("records the spoken language for the in-language brief", () => {
    expect(buildBriefMarkdown(empty, [], "es")).toContain("brief-language: es");
  });

  it("renders list sections as bullets", () => {
    const md = buildBriefMarkdown(filled, [], "en");
    expect(md).toContain("- Ship beta 2026-08");
    expect(md).toContain("- Joel: draft pricing");
  });
});
