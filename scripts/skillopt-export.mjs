import { writeFile } from "node:fs/promises";

const base = process.env.SKILLOPT_HTTP_URL;
const token = process.env.SKILLOPT_TOKEN;
if (!base || !token) throw new Error("SkillOpt export configuration missing");
const items = [];
let cursor;
let skillName;
const seen = new Set();
for (;;) {
  const url = new URL("/skillopt/export", base);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("SkillOpt export HTTP " + response.status);
  const page = await response.json();
  if (!Array.isArray(page.items)) throw new Error("Invalid export page");
  skillName = page.skillName;
  items.push(...page.items);
  if (page.isDone === true) break;
  if (typeof page.continueCursor !== "string" || seen.has(page.continueCursor))
    throw new Error("Invalid export cursor");
  cursor = page.continueCursor;
  seen.add(cursor);
}
await writeFile(process.argv[2] ?? "export.json", JSON.stringify({ skillName, items }));
