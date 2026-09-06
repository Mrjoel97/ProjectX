// @vitest-environment node
//
// Phase 38: the two agent doors declare their pins through ONE shared validator. The 21-03 incident
// was a field declared at one door and not the other (golden run 6e021dce, 0/41 at the validator);
// a static scan is the check that fails if someone adds a pin to one door by hand again.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const read = (file: string): string =>
  readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n");

/** `src` from `start` to the first `end` after it; both anchors must exist (no silent empties). */
function slice(src: string, start: string, end: string): string {
  const s = src.indexOf(start);
  expect(s, `${start} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(s);
  const e = rest.indexOf(end);
  expect(e, `${end} not found after ${start}`).toBeGreaterThan(0);
  return rest.slice(0, e);
}

const DOORS: readonly [string, string, string][] = [
  ["llm.ts", "export const runCockpitAgent = internalAction({", "handler:"],
  ["dispatch.ts", "const dispatchArgs = {", "};"],
];

for (const [file, start, end] of DOORS) {
  test(`${file}: ${start.split(" ")[2] ?? start} spreads TOOL_CONTEXT_ARGS and declares no pin by hand`, () => {
    const block = slice(read(file), start, end);
    expect(block).toContain("...TOOL_CONTEXT_ARGS");
    // Comments name the fields on purpose; the CODE surface must not declare them again.
    const code = block.replace(/\/\/[^\n]*/g, "");
    expect(code, "a hand-declared skillVersions line drifted back in").not.toMatch(
      /^\s*skillVersions:/m,
    );
    expect(code, "a hand-declared tenantSkillIds line drifted back in").not.toMatch(
      /^\s*tenantSkillIds:/m,
    );
  });
}
