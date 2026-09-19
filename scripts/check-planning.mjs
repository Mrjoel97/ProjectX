#!/usr/bin/env node
// Claude Code Stop hook (Phase 37, G26): refuse to finish a turn that leaves the planning corpus
// lying. Sibling of check-playbooks.mjs; reads the working tree only, never writes.
//
//  1. .planning/STATE.md starts with the exact bytes `---\n` and holds exactly ONE frontmatter
//     block — gsd-tools' writer PREPENDS a fresh block whenever byte 0 is not a dash, which is how
//     36 blocks accumulated before the repair.
//  2. Every `### Phase N` heading in ROADMAP.md has a row in the progress table.
//  3. Canonical PLAN/SUMMARY identity, explicit dispositions, roadmap counts, and present
//     VERIFICATION evidence agree with each phase row.
//  4. STATE, ROADMAP, and the optional GSD-ROUTING derivative agree on the active phase.
//  5. The closure rule: a Complete row's REQUIREMENTS traceability rows must be Complete too,
//     unless the requirement's checkbox line says why it stays open with an `(open: …)` note.
//  6. Any SITE/LAND/SHOP definitions have exactly one traceability owner in an existing phase.
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
const norm = (n) => String(n).trim().replace(/\b0+(?=\d)/g, "");
// ponytail: these regexes intentionally parse only repository-owned record shapes. Replace them
// with a parser only if those formats change and focused fixtures prove the local ceiling broke.
const frontmatter = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? null;
const field = (text, name) =>
  frontmatter(text)?.match(new RegExp(`^${name}:\\s*["']?([^\\r\\n"']+)`, "m"))?.[1]?.trim();
const OPEN_STATUS =
  /^(?:partial(?:\b|[_ -])|in[_ -]?progress\b|blocked\b|draft\b|human[_ -]?needed\b|gaps[_ -]?found\b|awaiting(?:[_ -]|\b)|defer(?:red)?\b)/i;
const isOpenStatus = (status) => status !== undefined && OPEN_STATUS.test(status);
const explicitOpenEvidence = (text) => {
  const body = frontmatter(text) === null ? text : text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  const status = body.match(
    /^\s*(?:[-*]\s*)?(?:\*\*)?(?:evidence\s+|verification\s+)?status(?:\*\*\s*:|:\s*\*\*|:)\s*([^\r\n]+)/im,
  )?.[1]?.trim();
  return status && isOpenStatus(status) ? status : null;
};
const isComplete = (status) => /^\**complete(?:d)?\b/i.test(status.trim());
const isSuperseded = (status) => /^\**superseded\b/i.test(status.trim());

const problems = [];

// 1. STATE.md
const state = read(".planning/STATE.md");
let statePhase;
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
  statePhase = field(state, "current_phase");
}

// 2–6. ROADMAP + phase directories + REQUIREMENTS + routing derivative
const roadmap = read(".planning/ROADMAP.md");
const reqs = read(".planning/REQUIREMENTS.md");
if (roadmap !== null) {
  const heads = [...roadmap.matchAll(/^### Phase ([0-9.]+[a-z]?)[:\s]/gm)].map((m) => norm(m[1]));
  const rows = new Map(
    [...roadmap.matchAll(/^\| ([0-9]+(?:\.[0-9]+)*)\. [^|]*\| ([^|]*)\| ([^|]*)\|/gm)].map((m) => [
      norm(m[1]),
      { progress: m[2].trim(), status: m[3].trim() },
    ]),
  );
  for (const h of heads)
    if (!rows.has(h))
      problems.push(`ROADMAP: \`### Phase ${h}\` has no row in the progress table.`);

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
    if (!plans.length) continue;
    const row = rows.get(n);
    if (row === undefined) continue; // reported by rule 2 already

    const dispositions = plans.map((plan) => {
      const summaryName = `${plan}-SUMMARY.md`;
      const summary = read(`.planning/phases/${d}/${summaryName}`);
      if (summary === null) return { plan, kind: "open", reason: "missing" };
      const status = field(summary, "status");
      const openEvidence = explicitOpenEvidence(summary);
      if (status && /^superseded\b/i.test(status)) {
        const successor =
          field(summary, "superseded_by") ??
          field(summary, "successor") ??
          summary.match(/^\s*(?:[-*]\s*)?(?:\*\*)?successor(?:\*\*)?\s*:\s*([^\r\n]+)/im)?.[1]?.trim();
        if (!successor)
          problems.push(
            `SUMMARY ${plan} is superseded but names no successor in ${summaryName}; add \`superseded_by\` or \`successor\`.`,
          );
        return { plan, kind: successor ? "superseded" : "open", successor, status };
      }
      if (openEvidence) return { plan, kind: "open", reason: "evidence", status: openEvidence };
      if (status && /^(?:complete|completed)\b/i.test(status))
        return { plan, kind: "completed", status };
      if (status !== undefined)
        return { plan, kind: "open", reason: isOpenStatus(status) ? "status" : "unknown", status };
      return { plan, kind: "completed", status: "legacy" };
    });
    const completed = dispositions.filter((item) => item.kind === "completed");
    const superseded = dispositions.filter((item) => item.kind === "superseded");
    const open = dispositions.filter((item) => item.kind === "open");
    const reported = row.progress.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (
      reported &&
      (Number(reported[1]) !== completed.length || Number(reported[2]) !== plans.length)
    )
      problems.push(
        `ROADMAP: row ${n} reports ${reported[1]}/${reported[2]} but canonical completion is ${completed.length}/${plans.length}.`,
      );

    if (!open.length && !superseded.length && !isComplete(row.status))
      problems.push(
        `ROADMAP: every plan in .planning/phases/${d} has a completed SUMMARY but row ${n} reads "${row.status.slice(0, 60)}" — reconcile the phase disposition (gsd \`phase complete\` does not write this file).`,
      );
    if (!open.length && superseded.length && !isSuperseded(row.status))
      for (const item of superseded)
        problems.push(
          `ROADMAP: row ${n} reads Complete but ${item.plan} is superseded by ${item.successor}, not completed.`,
        );
    if (isComplete(row.status))
      for (const item of open) {
        if (item.reason === "missing")
          problems.push(`ROADMAP: row ${n} reads Complete but ${item.plan} has no completed SUMMARY.`);
        else if (item.reason === "evidence")
          problems.push(
            `ROADMAP: row ${n} reads Complete but ${item.plan} has explicit open evidence "${item.status}".`,
          );
        else
          problems.push(
            `ROADMAP: row ${n} reads Complete but ${item.plan} has open SUMMARY status "${item.status}".`,
          );
      }
    if (isSuperseded(row.status) && (open.length || !superseded.length))
      problems.push(
        `ROADMAP: row ${n} reads Superseded but its canonical plans do not all have completed or named superseded dispositions.`,
      );

    if (isComplete(row.status)) {
      for (const verificationName of files.filter((f) => /(?:^|-)VERIFICATION\.md$/.test(f))) {
        const verification = read(`.planning/phases/${d}/${verificationName}`) ?? "";
        const verificationStatus = field(verification, "status") ?? explicitOpenEvidence(verification);
        if (verificationStatus && isOpenStatus(verificationStatus))
          problems.push(
            `ROADMAP: row ${n} reads Complete but ${verificationName} status is "${verificationStatus}".`,
          );
      }
    }

    // 5. closure rule
    if (reqs !== null && isComplete(row.status) && !isSuperseded(row.status)) {
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

  // 4. GSD-ROUTING is a validated derivative, not another authority.
  const routing = read(".planning/GSD-ROUTING.json");
  if (routing !== null) {
    let routingPhase;
    try {
      routingPhase = JSON.parse(routing)?.active?.phase;
    } catch {
      problems.push("GSD-ROUTING.json is not valid JSON.");
    }
    const roadmapPhase = roadmap.match(
      /^\*\*Current execution pointer:\*\*\s*Phase\s+([0-9.]+[a-z]?)/m,
    )?.[1];
    if (statePhase && roadmapPhase && routingPhase) {
      const phases = [statePhase, roadmapPhase, routingPhase].map(norm);
      if (new Set(phases).size !== 1)
        problems.push(
          `Planning route disagreement: STATE=${phases[0]}, ROADMAP=${phases[1]}, GSD-ROUTING=${phases[2]}.`,
        );
    } else if (routingPhase !== undefined) {
      problems.push(
        "Planning route disagreement: GSD-ROUTING exists but STATE current_phase or ROADMAP current execution pointer is missing.",
      );
    }
  }

  // 6. Newly admitted public-web and commerce requirements need one concrete owner each.
  if (reqs !== null) {
    const definitions = [
      ...reqs.matchAll(/^- \[[ x]\] \*\*((?:SITE|LAND|SHOP)-\d+)\*\*:/gm),
    ].map((match) => match[1]);
    const traceRows = [
      ...reqs.matchAll(/^\| ((?:SITE|LAND|SHOP)-\d+) \| Phase ([0-9.]+)[^|]*\|/gm),
    ].map((match) => ({ id: match[1], phase: norm(match[2]) }));
    for (const id of definitions) {
      const owners = traceRows.filter((row) => row.id === id);
      if (owners.length !== 1)
        problems.push(
          `REQUIREMENTS: ${id} has ${owners.length} traceability owners; exactly one is required.`,
        );
      else if (!heads.includes(owners[0].phase))
        problems.push(`REQUIREMENTS: ${id} names missing ROADMAP Phase ${owners[0].phase}.`);
    }
    for (const row of traceRows)
      if (!definitions.includes(row.id))
        problems.push(`REQUIREMENTS: traceability row ${row.id} has no matching requirement definition.`);
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
