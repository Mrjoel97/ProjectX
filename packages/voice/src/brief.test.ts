import { describe, expect, it } from "vitest";
import type { BriefSections, TranscriptTurn } from "./brief";
import { BRIEF_HEADERS, buildBriefMarkdown, composeBrief, planSeedFromBrief } from "./brief";

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
      BRIEF_HEADERS.summary,
      BRIEF_HEADERS.decisions,
      BRIEF_HEADERS.actionItems,
      BRIEF_HEADERS.openQuestions,
      BRIEF_HEADERS.discussion,
      BRIEF_HEADERS.conversation,
    ];
    const positions = order.map((h) => md.indexOf(`\n${h}\n`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("carries NO markdown syntax — no '#' headers and no '*' emphasis", () => {
    const md = buildBriefMarkdown(filled, transcript, "en");
    expect(md).not.toMatch(/#/);
    expect(md).not.toMatch(/\*/);
  });

  it("renders every empty section as the literal 'None'", () => {
    const md = buildBriefMarkdown(empty, [], "en");
    // 6 empty sections: summary, decisions, action items, open questions, discussion, conversation
    expect(md.match(/^None$/gm)?.length).toBe(6);
  });

  it("welds the transcript verbatim, turn-by-turn as plain 'Speaker: text' (never model-authored)", () => {
    const md = buildBriefMarkdown(empty, transcript, "en");
    expect(md).toContain("User: Hi");
    expect(md).toContain("Agent: Hello");
  });

  it("records the spoken language for the in-language brief", () => {
    expect(buildBriefMarkdown(empty, [], "es")).toContain("Language: es");
  });

  it("renders list sections as plain '- ' bullets", () => {
    const md = buildBriefMarkdown(filled, [], "en");
    expect(md).toContain("- Ship beta 2026-08");
    expect(md).toContain("- Joel: draft pricing");
  });
});

describe("composeBrief (client clean-end)", () => {
  const clientTurns: TranscriptTurn[] = [
    { speaker: "user", text: "Let's plan the Q3 launch." },
    { speaker: "agent", text: "Sure — first decision is timing." },
  ];

  it("is plain text with friendly speaker labels and no markdown syntax", () => {
    const brief = composeBrief(clientTurns, "2026-07-20");
    expect(brief).toContain("Voice brief — 2026-07-20");
    expect(brief).toContain("You: Let's plan the Q3 launch.");
    expect(brief).toContain("Pikar AI: Sure — first decision is timing.");
    expect(brief).not.toMatch(/[#*]/);
  });

  it("leads with empty, parenthetical-hinted Decisions + Action items sections", () => {
    const brief = composeBrief(clientTurns, "2026-07-20");
    expect(brief).toContain(`${BRIEF_HEADERS.decisions}\n(add what you decided)`);
    expect(brief).toContain(`${BRIEF_HEADERS.actionItems}\n(add the next steps)`);
  });
});

describe("planSeedFromBrief", () => {
  it("extracts filled Decisions + Action items from a server brief (bullets stripped)", () => {
    const seed = planSeedFromBrief(buildBriefMarkdown(filled, transcript, "en"));
    expect(seed).toContain("Turn this voice conversation into a concrete plan.");
    expect(seed).toContain("Decisions:\nShip beta 2026-08\nHire a designer");
    expect(seed).toContain("Action items:\nJoel: draft pricing");
    // The synthesized findings and real transcript both carry into the cockpit handoff.
    expect(seed).toContain("Discussion findings:\nLong narrative goes here.");
    expect(seed).toContain("Conversation transcript:\nUser: Hi\nAgent: Hello");
  });

  it("falls back to the whole brief when both sections are empty (parenthetical hints ignored)", () => {
    const brief = composeBrief([{ speaker: "user", text: "hi" }], "2026-07-20");
    // Unedited client brief still carries its transcript as explicit cockpit context.
    expect(planSeedFromBrief(brief)).toContain("Conversation transcript:\nYou: hi");
  });

  it("treats an empty server section ('None') as empty, not a decision", () => {
    // Decisions present, action items empty ("None") → only Decisions ride the seed.
    const brief = buildBriefMarkdown(
      { ...empty, decisions: ["Move the review to Friday"] },
      [],
      "en",
    );
    const seed = planSeedFromBrief(brief);
    expect(seed).toContain("Decisions:\nMove the review to Friday");
    expect(seed).not.toContain("Action items:");
    expect(seed).not.toContain("None");
  });
});
