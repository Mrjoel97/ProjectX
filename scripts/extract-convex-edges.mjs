#!/usr/bin/env node
// Graph fixup for graphify-out/graph.json — three passes:
//  1. DE-NOISE: drop .planning/ markdown and root config-manifest nodes so queries,
//     god-nodes, and communities reflect code, not documents.
//  2. CONVEX EDGES: inject `calls` edges for internal.*/api.* references — Convex
//     crosses modules via generated objects, invisible to AST import extraction.
//  3. TABLE EDGES: create a node per defineTable in schema.ts and inject
//     read/write edges from every ctx.db.query("t")/insert("t") call site.
// Idempotent: safe to run any time.
// ponytail: rebuilds (`graphify update .`) rewrite graph.json and drop all of this —
// re-run this script afterwards (a SessionStart hook also re-runs it each session).
// Static limit: ctx.db.patch/delete take ids, not table names — those sites carry no
// table edge; the read edge from the preceding query usually covers the file anyway.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

try {
  process.chdir(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
} catch {
  process.exit(0);
}

const GRAPH = "graphify-out/graph.json";
if (!existsSync(GRAPH)) process.exit(0);
const raw = readFileSync(GRAPH, "utf8");
const g = JSON.parse(raw);

// --- pass 1: de-noise -------------------------------------------------------
const NOISE_BASENAME =
  /^(package(-lock)?\.json|tsconfig[^/]*\.json|biome\.json|turbo\.json|pnpm-(lock|workspace)\.yaml)$/;
const isNoise = (n) => {
  const f = n.source_file || "";
  return (
    f.startsWith(".planning/") ||
    f === "CLAUDE.md" ||
    f.includes(".claude/") || // agent-tooling skills/config markdown, not product code
    // Playwright specs. NOT because e2e is unimportant — because graphify extracts a node per
    // locator/expression in them, so ~40 spec files produced 25,886 of 36,394 nodes (71% of the
    // graph) on the 0.9.11 rebuild, against 178 in the graph built by the older version. A graph
    // that is mostly test locators defeats the one thing CLAUDE.md keeps it for: `graphify query`
    // returning a SMALL scoped subgraph instead of raw grep. The specs stay perfectly readable —
    // they are 40 files in one flat directory, found by Glob in one call.
    /(^|\/)e2e\//.test(f) ||
    NOISE_BASENAME.test(f.split("/").pop())
  );
};
const dropped = new Set(g.nodes.filter(isNoise).map((n) => n.id));
if (dropped.size) {
  g.nodes = g.nodes.filter((n) => !dropped.has(n.id));
  g.links = g.links.filter((l) => !dropped.has(l.source) && !dropped.has(l.target));
}

// --- index remaining nodes so injected edges reuse graphify's own ids --------
const symbolId = new Map(); // "<source_file>|<norm_label>" -> id
const fileId = new Map(); //   "<source_file>" -> id of the file node itself
const nodeFile = new Map(); // id -> source_file (to skip intra-file self-references)
const nodeIds = new Set();
for (const n of g.nodes) {
  symbolId.set(`${n.source_file}|${(n.norm_label || n.label || "").toLowerCase()}`, n.id);
  nodeFile.set(n.id, n.source_file);
  nodeIds.add(n.id);
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
const addLink = (source, target, relation, context, source_file, line) => {
  const sig = `${source}>${target}>${relation}`;
  if (existing.has(sig)) return 0;
  existing.add(sig);
  g.links.push({
    relation,
    confidence: "EXTRACTED",
    source_file,
    source_location: `L${line}`,
    weight: 1,
    context,
    confidence_score: 1,
    source,
    target,
  });
  return 1;
};
const lineAt = (text, idx) => text.slice(0, idx).split("\n").length;

// --- pass 3 setup: table nodes from schema.ts --------------------------------
const SCHEMA = "packages/backend/convex/schema.ts";
const tableId = new Map(); // table name -> node id
if (existsSync(SCHEMA)) {
  const text = readFileSync(SCHEMA, "utf8");
  const schemaFileId = fileId.get(SCHEMA);
  const community = g.nodes.find((n) => n.id === schemaFileId)?.community ?? 0;
  for (const m of text.matchAll(/^\s*(\w+):\s*defineTable\(/gm)) {
    const name = m[1];
    const id = `packages_backend_convex_schema_${name.toLowerCase()}_table`;
    tableId.set(name, id);
    if (!nodeIds.has(id)) {
      g.nodes.push({
        label: `${name} (table)`,
        file_type: "code",
        source_file: SCHEMA,
        source_location: `L${lineAt(text, m.index)}`,
        _origin: "convex_table",
        id,
        community,
        norm_label: `${name} (table)`,
      });
      nodeIds.add(id);
    }
    if (schemaFileId)
      addLink(schemaFileId, id, "contains", undefined, SCHEMA, lineAt(text, m.index));
  }
}

// --- passes 2 + 3: scan call sites -------------------------------------------
let convexEdges = 0;
let tableEdges = 0;
const unresolved = new Set();
for (const f of files) {
  const srcId = fileId.get(f);
  if (!srcId) continue; // file not in graph yet — next rebuild will pick it up
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/\b(?:internal|api)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g)) {
    const [, mod, fn] = m;
    const modFile = `packages/backend/convex/${mod}.ts`;
    const target = symbolId.get(`${modFile}|${fn.toLowerCase()}`) || fileId.get(modFile);
    if (!target) {
      unresolved.add(`${mod}.${fn}`);
      continue;
    }
    if (nodeFile.get(target) === f) continue; // intra-file ref; `contains` covers it
    convexEdges += addLink(srcId, target, "calls", "convex_ref", f, lineAt(text, m.index));
  }
  for (const m of text.matchAll(/ctx\.db\.(query|insert)\(\s*["'](\w+)["']/g)) {
    const [, op, table] = m;
    const target = tableId.get(table);
    if (!target) continue;
    tableEdges += addLink(
      srcId,
      target,
      "references",
      op === "insert" ? "db_write" : "db_read",
      f,
      lineAt(text, m.index),
    );
  }
}

writeFileSync(GRAPH, JSON.stringify(g, null, raw.includes('\n  "') ? 2 : 0));
console.log(
  `graph-fixup: -${dropped.size} noise nodes | +${convexEdges} convex edges | ` +
    `+${tableEdges} table edges (${tableId.size} tables)` +
    (unresolved.size ? ` | unresolved: ${[...unresolved].join(", ")}` : ""),
);
