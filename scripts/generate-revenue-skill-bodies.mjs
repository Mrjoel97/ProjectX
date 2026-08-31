import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const names = [
  "revenue-specialist",
  "revenue-lead-triage",
  "revenue-call-list",
  "revenue-pipeline-review",
  "revenue-customer-pulse",
  "revenue-cash-flow",
  "revenue-payroll-confidence",
  "revenue-invoice-reminder",
];

const rows = names.map((name) => {
  const body = readFileSync(resolve(`packages/contracts/skills/${name}.md`), "utf8").replace(/\r\n/g, "\n");
  return `  ${JSON.stringify(name)}: ${JSON.stringify(body)},`;
});

writeFileSync(
  resolve("packages/contracts/src/skills/revenueBodies.ts"),
  `// AUTO-DERIVED from packages/contracts/skills/revenue-*.md.\n// Run scripts/generate-revenue-skill-bodies.mjs after reviewing canonical body changes.\n\nexport const revenueSkillBodies: Readonly<Record<string, string>> = {\n${rows.join("\n")}\n};\n`,
  "utf8",
);
