/**
 * Pure brief composer (VOIC-03). The model fills the NARRATIVE sections; the transcript
 * is welded on here in code, never model-authored. Empty sections render the literal
 * "None". Field names are stable — they become the `generateObject` schema in plan 04.
 */

/** Model-authored sections (the `generateObject` schema shape — keep field names stable). */
export type BriefSections = {
  summary: string;
  decisions: string[];
  actionItems: string[];
  openQuestions: string[];
  discussion: string;
};

/** One turn of the kept, text-only transcript. */
export type TranscriptTurn = { speaker: string; text: string };

const NONE = "None";

const renderList = (items: string[]): string =>
  items.length === 0 ? NONE : items.map((i) => `- ${i}`).join("\n");

const renderText = (text: string): string => {
  const t = text.trim();
  return t.length === 0 ? NONE : t;
};

const renderTranscript = (turns: TranscriptTurn[]): string =>
  turns.length === 0 ? NONE : turns.map((t) => `**${t.speaker}:** ${t.text}`).join("\n\n");

/**
 * Compose the fixed-section brief markdown. Order is invariant: Summary → Decisions →
 * Action items → Open questions → Discussion → Transcript. `language` is recorded as a
 * leading metadata comment so the vault knows the spoken language of an in-language brief.
 */
export function buildBriefMarkdown(
  sections: BriefSections,
  transcript: TranscriptTurn[],
  language: string,
): string {
  return `${[
    `<!-- brief-language: ${language} -->`,
    "## Summary",
    renderText(sections.summary),
    "## Decisions",
    renderList(sections.decisions),
    "## Action items",
    renderList(sections.actionItems),
    "## Open questions",
    renderList(sections.openQuestions),
    "## Discussion",
    renderText(sections.discussion),
    "## Transcript",
    renderTranscript(transcript),
  ].join("\n\n")}\n`;
}
