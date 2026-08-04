#!/usr/bin/env node
// Claude Code hook: block finishing a turn when code changed in a subsystem
// covered by docs/playbooks/*.md but the playbook itself wasn't touched.
// Modes: "baseline" (SessionStart — record HEAD) | "check" (Stop — compare).
// Mapping lives in docs/playbooks/watch.json: { "<playbook>.md": ["path/prefix", ...] }
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {}
const mode = process.argv[2];

// Hooks run in the session's cwd, which may be a subdirectory (or the repo root of
// another machine layout) — anchor everything to the repo root and never block if
// we can't find it.
let gitDir;
try {
  process.chdir(git("rev-parse", "--show-toplevel"));
  gitDir = git("rev-parse", "--git-dir"); // worktree-safe (".git" may be a file)
} catch {
  process.exit(0);
}
const sessionId = String(input.session_id || "default").replace(/[^A-Za-z0-9_-]/g, "");
const baselineFile = join(gitDir, `claude-playbooks-${sessionId || "default"}`);

if (mode === "baseline") {
  // Record HEAD at session start so "check" sees changes committed mid-session,
  // not just the uncommitted working tree. Never overwrite (resume keeps the original).
  try {
    if (!existsSync(baselineFile)) writeFileSync(baselineFile, git("rev-parse", "HEAD"));
  } catch {}
  process.exit(0);
}

// --- check mode ---
const changed = new Set();
let base = "HEAD";
try {
  if (existsSync(baselineFile)) {
    const candidate = readFileSync(baselineFile, "utf8").trim();
    if (/^[0-9a-f]{4,40}$/i.test(candidate)) {
      git("cat-file", "-e", candidate); // baseline may be gone after a rebase
      base = candidate;
    }
  }
} catch {}
const created = new Set(); // files new since baseline (committed or untracked)
try {
  for (const f of git("diff", "--name-only", base).split("\n")) if (f) changed.add(f);
  for (const f of git("diff", "--name-only", "--diff-filter=A", base).split("\n"))
    if (f) created.add(f);
  for (const f of git("ls-files", "--others", "--exclude-standard").split("\n"))
    if (f) {
      changed.add(f);
      created.add(f);
    }
} catch {
  process.exit(0); // not a repo / git unavailable — never block on our own failure
}

let watch = {};
try {
  watch = JSON.parse(readFileSync("docs/playbooks/watch.json", "utf8"));
} catch {
  process.exit(0);
}

// Acknowledgments break the re-block loop: once a playbook has been updated/bumped
// for a given state of its changed files, that exact state stays blessed — even after
// the playbook edit is committed while the code change stays uncommitted (e.g. another
// session's WIP). Any further edit to the files changes the hash and re-triggers.
const ackFile = join(gitDir, "claude-playbooks-ack.json");
let acks = {};
try {
  acks = JSON.parse(readFileSync(ackFile, "utf8"));
} catch {}
const hashHits = (hits) =>
  createHash("sha256")
    .update(
      [...hits]
        .sort()
        .map((f) => {
          try {
            return `${f}:${git("hash-object", f)}`;
          } catch {
            return `${f}:gone`;
          }
        })
        .join("\n"),
    )
    .digest("hex");

const stale = [];
let acksDirty = false;
for (const [playbook, prefixes] of Object.entries(watch)) {
  if (playbook === "_unassigned") continue;
  const pbPath = `docs/playbooks/${playbook}`;
  const hits = [...changed].filter((f) => prefixes.some((p) => f.startsWith(p)));
  if (!hits.length) continue;
  const state = hashHits(hits);
  if (changed.has(pbPath)) {
    if (acks[pbPath] !== state) {
      acks[pbPath] = state; // playbook touched alongside — bless this exact file state
      acksDirty = true;
    }
  } else if (acks[pbPath] !== state) {
    stale.push({ pbPath, hits: hits.slice(0, 5) });
  }
}
if (acksDirty) {
  try {
    writeFileSync(ackFile, JSON.stringify(acks));
  } catch {}
}

// Creation gap: new code files no playbook covers. Register them under an existing
// playbook's paths, create a new playbook, or acknowledge via watch._unassigned.
const covered = Object.entries(watch).flatMap(([k, v]) => (k === "_unassigned" ? [] : v));
const acknowledged = watch._unassigned || [];
const uncovered = [...created].filter(
  (f) =>
    /^(packages|apps)\//.test(f) &&
    /\.(ts|tsx|mjs)$/.test(f) &&
    !/\.test\.|\.spec\.|_generated\/|node_modules\//.test(f) &&
    !covered.some((p) => f.startsWith(p)) &&
    !acknowledged.some((p) => f.startsWith(p)),
);

if (stale.length === 0 && uncovered.length === 0) process.exit(0);

const problems = [];
if (stale.length)
  problems.push(
    "Code changed in subsystems covered by playbooks, but the playbooks were not updated:\n" +
      stale.map((s) => `- ${s.pbPath} (changed: ${s.hits.join(", ")})`).join("\n") +
      '\nUpdate each playbook and bump its "Last verified" line. If the change genuinely does not ' +
      'affect the playbook\'s content, bump only the "Last verified" line — touching the file clears this check.',
  );
if (uncovered.length)
  problems.push(
    "New code files are not covered by any playbook:\n" +
      uncovered
        .slice(0, 10)
        .map((f) => `- ${f}`)
        .join("\n") +
      "\nEither add their paths to an existing playbook's entry in docs/playbooks/watch.json, " +
      "create a new playbook from docs/playbooks/TEMPLATE.md and register it in watch.json, " +
      'or list the paths under "_unassigned" in watch.json if they genuinely need no playbook.',
  );

if (input.stop_hook_active) {
  // Already continued once for this — warn, don't loop forever.
  console.log(
    JSON.stringify({
      systemMessage: `Playbook check still failing: ${[
        ...stale.map((s) => s.pbPath),
        ...uncovered,
      ].join(", ")}`,
    }),
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "block",
    reason: `Playbook check (CLAUDE.md §9):\n\n${problems.join("\n\n")}`,
  }),
);
