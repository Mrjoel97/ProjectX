#!/usr/bin/env node
// Inject Convex cross-module edges into graphify-out/graph.json.
// Graphify's AST extraction only sees `import` statements, but Convex crosses module
// boundaries through generated objects (`ctx.runMutation(internal.plans.insertPlan)`,
// `useQuery(api.plans.byThread)`, `workflow.start(...)`) — without this, the delivery
// spine is invisible in the graph. Idempotent: safe to run any time.
// ponytail: rebuilds (`graphify update .`) rewrite graph.json and drop these edges —
// re-run this script afterwards (a SessionStart hook also re-injects each session).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try {
  process.chdir(
    execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
  );
} catch {
  process.exit(0);
}

const GRAPH = "graphify-out/graph.json";
if (!existsSync(GRAPH)) process.exit(0);
const raw = readFileSync(GRAPH, "utf8");
const g = JSON.parse(raw);

// Index existing nodes so injected edges reuse graphify's own ids — no slug guessing.
const symbolId = new Map(); // "<source_file>|<norm_label>" -> id
const fileId = new Map(); //   "<source_file>" -> id of the file node itself
const nodeFile = new Map(); // id -> source_file (to skip intra-file self-references)
for (const n of g.nodes) {
  symbolId.set(`${n.source_file}|${(n.norm_label || n.label || "").toLowerCase()}`, n.id);
  nodeFile.set(n.id, n.source_file);
  if (n.label === (n.source_file || "").split("/").pop()) fileId.set(n.source_file, n.id);
}

const files = [];
const skip = /(^|\/)(_generated|node_modules|\.next|e2e)(\/|$)/;
for (const root of ["packages/backend/convex", "apps/web"]) {
  if (!existsSync(root)) continue;
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name).replace(/\\/g, "/");
      if (skip.test(p)) continue;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) files.push(p);
    }
  })(root);
}

const existing = new Set(g.links.map((l) => `${l.source}>${l.target}>${l.relation}`));
let added = 0;
const unresolved = new Set();
for (const f of files) {
  const srcId = fileId.get(f);
  if (!srcId) continue; // file not in graph yet — next rebuild will pick it up
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\b(?:internal|api)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g)) {
    const [, mod, fn] = m;
    const modFile = `packages/backend/convex/${mod}.ts`;
    const targetId =
      symbolId.get(`${modFile}|${fn.toLowerCase()}`) || fileId.get(modFile);
    if (!targetId) {
      unresolved.add(`${mod}.${fn}`);
      continue;
    }
    if (nodeFile.get(targetId) === f) continue; // intra-file ref; `contains` covers it
    const sig = `${srcId}>${targetId}>calls`;
    if (existing.has(sig)) continue;
    existing.add(sig);
    const line = text.slice(0, m.index).split("\n").length;
    g.links.push({
      relation: "calls",
      confidence: "EXTRACTED",
      source_file: f,
      source_location: `L${line}`,
      weight: 1,
      context: "convex_ref",
      confidence_score: 1,
      source: srcId,
      target: targetId,
    });
    added++;
  }
}

if (added > 0) {
  writeFileSync(GRAPH, JSON.stringify(g, null, raw.includes('\n  "') ? 2 : 0));
}
console.log(
  `convex-edges: +${added} edges from ${files.length} files` +
    (unresolved.size ? ` | unresolved: ${[...unresolved].join(", ")}` : "")
);
