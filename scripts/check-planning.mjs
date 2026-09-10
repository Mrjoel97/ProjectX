#!/usr/bin/env node
// Claude Code Stop hook (Phase 37, G26): refuse to finish a turn that leaves the planning corpus
// lying. Sibling of check-playbooks.mjs; reads the working tree only, never writes.
//
//  1. .planning/STATE.md starts with the exact bytes `---\n` and holds exactly ONE frontmatter
//     block — gsd-tools' writer PREPENDS a fresh block whenever byte 0 is not a dash, which is how
//     36 blocks accumulated before the repair.
//  2. Every `### Phase N` heading in ROADMAP.md has a row in the progress table.
//  3. A phase directory whose every PLAN has a completed SUMMARY must not sit behind a row that reads
//     anything but Complete/Superseded (gsd `phase complete` never writes this file), and a
//     Complete row must not hide an open plan.
//  4. The closure rule: a Complete row's REQUIREMENTS traceability rows must be Complete too,
//     unless the requirement's checkbox line says why it stays open with an `(open: …)` note.
//
// Pipe `{}` on stdin when running by hand: `echo '{}' | node scripts/check-planning.mjs`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {}
// Optional positional root (a scratch copy under test); flags start with "--".
const root = process.argv.slice(2).find((a) => !a.startsWith("--"));
try {
  process.chdir(root || git("rev-parse", "--show-toplevel"));
} catch {
  process.exit(0); // not a repo — never block on our own failure
}
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
// "3.1" and "03.1" name the same phase; "03.2.1" is written both ways too.
const norm = (n) => n.replace(/^0+(?=\d)/, "");

const problems = [];

// 1. STATE.md
const state = read(".planning/STATE.md");
if (state !== null) {
  if (!state.startsWith("---\n"))
    problems.push(
      "STATE.md must start with the exact bytes `---\\n` (a BOM, blank line or CR at byte 0 makes gsd-tools prepend a fresh block instead of replacing the one it read).",
    );
  const fences = (state.match(/^---$/gm) || []).length;
  if (fences !== 2)
    problems.push(
      `STATE.md has ${Math.floor(fences / 2)} frontmatter blocks; exactly one is allowed. Merge the newest values into the first block and delete the rest.`,
    );
}

// 2–4. ROADMAP + phase directories + REQUIREMENTS
const roadmap = read(".planning/ROADMAP.md");
const reqs = read(".planning/REQUIREMENTS.md");
if (roadmap !== null) {
  const heads = [...roadmap.matchAll(/^### Phase ([0-9.]+[a-z]?)[:\s]/gm)].map((m) => norm(m[1]));
  const rows = new Map(
    [...roadmap.matchAll(/^\| ([0-9]+(?:\.[0-9]+)*)\. [^|]*\| [^|]*\| ([^|]*)\|/gm)].map((m) => [
      norm(m[1]),
      m[2].trim(),
    ]),
  );
  for (const h of heads)
    if (!rows.has(h))
      problems.push(`ROADMAP: \`### Phase ${h}\` has no row in the progress table.`);

  const isComplete = (st) => /complete/i.test(st) && !/not started|partial|incomplete/i.test(st);
  const isSuperseded = (st) => /superseded/i.test(st);

  let dirs = [];
  try {
    dirs = readdirSync(".planning/phases");
  } catch {}
  for (const d of dirs) {
    const n = norm(d.split("-")[0]);
    let files = [];
    try {
      files = readdirSync(`.planning/phases/${d}`);
    } catch {
      continue;
    }
    const plans = files.filter((f) => /-PLAN\.md$/.test(f)).map((f) => f.replace(/-PLAN\.md$/, ""));
    const sums = new Set(
      files
        .filter((f) => /-SUMMARY\.md$/.test(f))
        .filter((f) => {
          const summary = read(`.planning/phases/${d}/${f}`) ?? "";
          const frontmatter = summary.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          const status = frontmatter?.[1]?.match(/^status:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
          // Legacy summaries have no status. Explicit partial/blocked/draft reports are evidence
          // of unfinished work, never a reason to demand a false phase-completion declaration.
          return status === undefined || /^(complete|completed|superseded)\b/i.test(status);
        })
        .map((f) => f.replace(/-SUMMARY\.md$/, "")),
    );
    if (!plans.length) continue;
    const st = rows.get(n);
    if (st === undefined) continue; // reported by rule 2 already
    const open = plans.filter((p) => !sums.has(p));
    if (!open.length && !isComplete(st) && !isSuperseded(st))
      problems.push(
        `ROADMAP: every plan in .planning/phases/${d} has a completed SUMMARY but row ${n} reads "${st.slice(0, 60)}" — reconcile the phase disposition (gsd \`phase complete\` does not write this file).`,
      );
    if (open.length && isComplete(st) && !isSuperseded(st))
      problems.push(
        `ROADMAP: row ${n} reads Complete but ${open.join(", ")} ${open.length === 1 ? "has" : "have"} no completed SUMMARY.`,
      );

    // 4. closure rule
    if (reqs !== null && isComplete(st) && !isSuperseded(st)) {
      const tr = reqs.slice(reqs.indexOf("## Traceability"));
      for (const m of tr.matchAll(/^\| ([A-Z]+-\d+) \| Phase ([0-9.]+)[^|]*\| ([^|]*)\|/gm)) {
        if (norm(m[2]) !== n) continue;
        if (/complete/i.test(m[3])) continue;
        const box = reqs.match(new RegExp(`^- \\[[ x]\\] \\*\\*${m[1]}\\*\\*[^\\n]*`, "m"));
        if (box && /\(open:/.test(box[0])) continue;
        problems.push(
          `Closure rule: Phase ${n} reads Complete but ${m[1]} is "${m[3].trim().slice(0, 40)}" in REQUIREMENTS traceability and its checkbox line carries no \`(open: …)\` note — tick it with its evidence, or say why it stays open.`,
        );
      }
    }
  }
}

if (!problems.length) process.exit(0);

if (input.stop_hook_active) {
  console.log(
    JSON.stringify({
      systemMessage: `Planning-corpus check still failing (${problems.length} problems)`,
    }),
  );
  process.exit(0);
}
console.log(
  JSON.stringify({
    decision: "block",
    reason: `Planning-corpus check (Phase 37, G26):\n\n- ${problems.slice(0, 12).join("\n- ")}`,
  }),
);
process.exit(process.argv.includes("--exit-code") ? 1 : 0);
