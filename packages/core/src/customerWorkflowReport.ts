import { tokenizeMarkdown } from "./documentGen";

type Table = Extract<ReturnType<typeof tokenizeMarkdown>[number], { kind: "table" }>;
type Field = { label: string; unit: string };

const clean = (text: string) => text.replace(/[*_`]/g, "").trim().toLowerCase();
const field = (text: string): Field => {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(clean(text));
  return match
    ? { label: match[1]!.trim(), unit: match[2]!.trim() }
    : { label: clean(text), unit: "" };
};

/** Optional customer-authored field contract, e.g. "Table: Wholesale price ($), Gross margin (%)". */
export function requestedTableFields(requirements: readonly string[]): Field[] {
  const fields = requirements.flatMap((step) =>
    step
      .split(/\r?\n/)
      .filter((line) => /^\s*table\s*:/i.test(line))
      .flatMap((line) =>
        line
          .slice(line.indexOf(":") + 1)
          .split(",")
          .map(field),
      ),
  );
  if (
    requirements.some((step) =>
      /\b(?:calculate|compute|show|compare)\b[^.\n]{0,100}\bgross margin\b/i.test(step),
    ) &&
    !fields.some((f) => f.label === "gross margin")
  )
    fields.push({ label: "gross margin", unit: "%" });
  return fields;
}

function quantity(cell: string, unit: string, inheritedUnit: string) {
  const value = clean(cell);
  const amount = "[+-]?(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+)";
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (unit === inheritedUnit && new RegExp("^" + amount + "$").test(value))
    return Number(value.replaceAll(",", ""));
  const parsed = new RegExp(
    "^(?:" + escaped + "\\s*(" + amount + ")|(" + amount + ")\\s*" + escaped + ")$",
    "i",
  ).exec(value);
  return parsed ? Number((parsed[1] ?? parsed[2])!.replaceAll(",", "")) : undefined;
}

function matchesField(table: Table, required: Field, expected?: number) {
  const valid = (cells: string[], labelUnit: string) =>
    cells.length > 0 &&
    cells.every((cell) => {
      if (!required.unit) return Boolean(clean(cell));
      const number = quantity(cell, required.unit, labelUnit);
      return number !== undefined && (expected === undefined || Math.abs(number - expected) <= 0.5);
    });
  const column = table.header.findIndex((cell) => field(cell).label === required.label);
  if (
    column >= 0 &&
    valid(
      table.rows.map((row) => row[column]!),
      field(table.header[column]!).unit,
    )
  )
    return true;
  return table.rows.some(
    (row) => field(row[0]!).label === required.label && valid(row.slice(1), field(row[0]!).unit),
  );
}

/** Reject unfinished text before any download or completion receipt is created. */
export function completedWorkflowReport(reply: string, requirements: string[], brief: string) {
  let draft: { title?: unknown; markdown?: unknown };
  try {
    draft = JSON.parse(reply.trim().replace(/^\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}$/i, "$1"));
  } catch {
    return null;
  }
  if (
    !draft ||
    typeof draft.title !== "string" ||
    !draft.title.trim() ||
    typeof draft.markdown !== "string"
  )
    return null;
  const markdown = draft.markdown.trim();
  if (
    !markdown ||
    /(?:^|\n)\s*(?:i(?:'ll| will|’ll)\s+(?:start|create|draft|generate|format)|generating (?:the |your )?report|here.s (?:the |my )?plan for the report)/im.test(
      markdown,
    )
  )
    return null;
  const blocks = tokenizeMarkdown(markdown);
  if (
    requirements.some((step) =>
      /\b(?:recommend.{0,30}(?:order|buy|purchase)|buying decision)\b/i.test(step),
    ) &&
    !blocks.some(
      (block) =>
        (block.kind === "para" || block.kind === "bullet" || block.kind === "ordered") &&
        /\b(?:recommend|trial|order|defer|wait|request|ask|proceed|hold|buy|purchase)\b/i.test(
          block.text,
        ),
    )
  )
    return null;
  const tables = blocks.filter((token): token is Table => token.kind === "table");
  if (
    tables.some(
      (t) =>
        t.header.length < 2 ||
        t.header.length > 4 ||
        !t.rows.length ||
        [...t.rows, t.header].some(
          (row) =>
            row.length !== t.header.length ||
            row.some((c) => /^(?:|tbd|\.{3}|…|\?)$/i.test(clean(c))),
        ),
    )
  )
    return null;
  const instructions = [...requirements, brief];
  const fields = requestedTableFields(instructions);
  const requiresTable =
    fields.length ||
    instructions.some(
      (s) =>
        !/\b(?:no tables?|without (?:a )?tables?|do not (?:use|include) a table)\b/i.test(s) &&
        /\b(?:include|add|use|make|create|provide|as|in)\s+(?:a\s+|an?\s+\w+\s+)?table\b/i.test(s),
    );
  if (requiresTable && !tables.length) return null;
  if (!fields.every((f) => f.label && tables.some((t) => matchesField(t, f)))) return null;
  // For an unambiguous retail brief, independently recompute the requested margin.
  const prices = (label: string) =>
    [
      ...brief.matchAll(
        new RegExp(
          "\\b" + label + "(?: price| cost)?\\s*[:=]?\\s*\\$\\s*([\\d,]+(?:\\.\\d+)?)",
          "gi",
        ),
      ),
    ].map((m) => Number(m[1]!.replaceAll(",", "")));
  const wholesale = prices("wholesale"),
    retail = prices("retail");
  if (
    /\bgross margin\b/i.test(instructions.join("\n")) &&
    wholesale.length === 1 &&
    retail.length === 1 &&
    retail[0]! > 0
  ) {
    const margin = (100 * (retail[0]! - wholesale[0]!)) / retail[0]!;
    if (!tables.some((t) => matchesField(t, { label: "gross margin", unit: "%" }, margin)))
      return null;
  }
  return { title: draft.title.trim(), markdown };
}
