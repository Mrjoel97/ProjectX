/**
 * Pure brief text (VOIC-03). BOTH brief flavors and the plan-seed parser live here so their
 * section headers can NEVER drift apart. A brief is read as PLAIN TEXT in the vault and welded
 * into the workspace plan seed — so it carries NO markdown syntax (no `#`, no `*`): headers are
 * bare UPPERCASE labels, list items are `- item`, transcript turns are `Speaker: text`.
 * The model fills the NARRATIVE sections; the transcript is welded on here in code, never
 * model-authored. Empty sections render the literal "None". Field names are stable — they are
 * the `generateObject` schema in llm.ts's draftVoiceBrief.
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

/** Section labels shared by buildBriefMarkdown (server/drafted), composeBrief (client clean-end),
 *  AND planSeedFromBrief (parser) — the SINGLE source of the header strings, so a composer and the
 *  parser can never disagree. Plain UPPERCASE, no leading `#`: a brief is plain text, never rendered
 *  markdown. `conversation` labels the turn-by-turn section for BOTH flavors (server dropped the old
 *  "Transcript" label so the parser has one header set to recognize). */
export const BRIEF_HEADERS = {
  summary: "SUMMARY",
  decisions: "DECISIONS",
  actionItems: "ACTION ITEMS",
  openQuestions: "OPEN QUESTIONS",
  discussion: "DISCUSSION",
  conversation: "CONVERSATION",
} as const;

const HEADER_SET: ReadonlySet<string> = new Set(Object.values(BRIEF_HEADERS));
const NONE = "None";

const renderList = (items: string[]): string =>
  items.length === 0 ? NONE : items.map((i) => `- ${i}`).join("\n");

const renderText = (text: string): string => {
  const t = text.trim();
  return t.length === 0 ? NONE : t;
};

// Turns as plain `Speaker: text` lines — no `**bold**` (the stars users saw in the brief). One line
// per turn keeps the welded transcript compact and greppable.
const renderTurns = (turns: TranscriptTurn[]): string =>
  turns.length === 0 ? NONE : turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");

/**
 * Compose the fixed-section server/drafted brief as PLAIN TEXT. Order is invariant: Summary →
 * Decisions → Action items → Open questions → Discussion → Conversation. `language` is recorded on a
 * leading `Language:` line (was an HTML comment) so the vault knows the spoken language of an
 * in-language brief. (Name kept for import stability — the output is plain text, not markdown.)
 */
export function buildBriefMarkdown(
  sections: BriefSections,
  transcript: TranscriptTurn[],
  language: string,
): string {
  return `${[
    `Language: ${language}`,
    BRIEF_HEADERS.summary,
    renderText(sections.summary),
    BRIEF_HEADERS.decisions,
    renderList(sections.decisions),
    BRIEF_HEADERS.actionItems,
    renderList(sections.actionItems),
    BRIEF_HEADERS.openQuestions,
    renderList(sections.openQuestions),
    BRIEF_HEADERS.discussion,
    renderText(sections.discussion),
    BRIEF_HEADERS.conversation,
    renderTurns(transcript),
  ].join("\n\n")}\n`;
}

/**
 * Compose the CLIENT clean-end editable brief (PostCall review). Decisions + Action items lead as
 * EMPTY, parenthetical-hinted sections the user fills in; the full conversation follows. `dateStr`
 * is passed in (the caller owns `new Date`) so this stays pure/deterministic for the test. Client
 * turns carry `user`/`agent` — mapped to the friendly "You"/"Pikar AI" labels the user sees.
 */
export function composeBrief(transcript: TranscriptTurn[], dateStr: string): string {
  const turns = transcript
    .filter((t) => t.text.trim())
    .map((t) => ({ speaker: t.speaker === "user" ? "You" : "Pikar AI", text: t.text.trim() }));
  return `${[
    `Voice brief — ${dateStr}`,
    `${BRIEF_HEADERS.decisions}\n(add what you decided)`,
    `${BRIEF_HEADERS.actionItems}\n(add the next steps)`,
    `${BRIEF_HEADERS.conversation}\n${
      turns.length ? renderTurns(turns) : "No transcript was captured for this session."
    }`,
  ].join("\n\n")}\n`;
}

/**
 * Pull the DECISIONS + ACTION ITEMS + CONVERSATION lines for the plan seed (VOIC-04). Reads BOTH brief flavors
 * (they share BRIEF_HEADERS). A section runs from its header line to the next known header. Blank
 * lines, `- ` bullet markers, parenthetical hints, and the literal "None" placeholder are dropped.
 * The transcript is intentionally retained: the voice agent's diagnosis, alternatives, and
 * business reasoning are part of the context the cockpit needs to turn the discussion into an
 * executable plan. Falls back to the whole brief when every parsed section is empty.
 */
export function planSeedFromBrief(brief: string): string {
  const lines = brief.split("\n");
  const section = (header: string): string => {
    const start = lines.findIndex((l) => l.trim().toUpperCase() === header);
    if (start === -1) return "";
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const raw = (lines[i] ?? "").trim();
      if (HEADER_SET.has(raw.toUpperCase())) break; // next section
      const t = raw.replace(/^-\s*/, "").trim(); // strip a leading "- " bullet
      if (!t || t === NONE || /^\(.*\)$/.test(t)) continue; // blank / None / parenthetical hint
      body.push(t);
    }
    return body.join("\n").trim();
  };
  const summary = section(BRIEF_HEADERS.summary);
  const decisions = section(BRIEF_HEADERS.decisions);
  const actions = section(BRIEF_HEADERS.actionItems);
  const openQuestions = section(BRIEF_HEADERS.openQuestions);
  const discussion = section(BRIEF_HEADERS.discussion);
  const conversation = section(BRIEF_HEADERS.conversation);
  if (!summary && !decisions && !actions && !openQuestions && !discussion && !conversation) {
    return brief.trim();
  }
  return [
    "Turn this voice conversation into a concrete plan. Preserve the decisions and constraints in the transcript, use the business context available to the cockpit, and execute through the normal approval path.",
    summary && `\nSummary:\n${summary}`,
    decisions && `\nDecisions:\n${decisions}`,
    actions && `\nAction items:\n${actions}`,
    openQuestions && `\nOpen questions:\n${openQuestions}`,
    discussion && `\nDiscussion findings:\n${discussion}`,
    conversation && `\nConversation transcript:\n${conversation}`,
  ]
    .filter(Boolean)
    .join("\n");
}
