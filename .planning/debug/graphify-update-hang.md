---
status: resolved
trigger: "graphify update . repeatedly hangs after AST extraction/no final result on the dirty Pikar-Ai worktree; the required Wave 0 Graphify refresh is unverified."
created: 2026-09-25T05:18:13Z
updated: 2026-09-25T10:00:38Z
---

## Current Focus

hypothesis: Confirmed: nested Git ignore was missed during detection, and the manifest writer retained excluded files that still existed.
test: Root-owned guarded full update, Convex fixup, exact-prefix manifest prune and post-run graph/label/manifest comparison.
expecting: Full update exits zero, `.auth` paths are absent from both graph topology and manifest, and prior active curated labels remain intact.
next_action: Reuse the now-current graph; keep Wave 1–8 evidence gates separate from this tooling repair.

## Symptoms

expected: `graphify update .` exits 0 and reconciles four graphify-out outputs without losing existing dirty hunks.
actual: Command emits no final output for 90-120 seconds on current 2026-09-25 source and is interrupted exit 1; a prior attempt completed extraction for 3,195 files but hung in final processing.
errors: No emitted error; historical Windows process resource exhaustion in STATE.
reproduction: Run `graphify update .` at C:\Users\expert\Desktop\Pikar-Ai; do not rerun blindly or overwrite graphify-out without pre-run byte/hash inventory.
started: Recurring across several September 2026 sessions, including two attempts in the last turn. `node scripts/extract-convex-edges.mjs` exits 0 with +0 edges and 76 tables.

## Evidence

- timestamp: 2026-09-25T05:20:00Z
  checked: Root CLAUDE.md and Phase 37.1 Plan 07.
  found: Graphify update and Convex fixup are required; Plan 07 assigns the four dirty generated outputs to one integration owner and requires pre-run byte/hash inventory and preservation.
  implication: Generated writes are unsafe until this inventory and provenance check are complete.
- timestamp: 2026-09-25T05:20:00Z
  checked: Current four output files and installed CLI.
  found: SHA-256/bytes: labels 0980D5CF3079E684B29A4C0548702EB2BB30BE73A5D290EADF7D9F1D94ADE6A0/30873; report 79A7F846AF2A38038BCE1D707665569B4658B807FE0F09ADEBC1BB8A1A74FE09/206075; graph CBADCB4FDEB31882E9EEA349B41DBB0B018F8FF5D6CBF7AC7E5E44AF1E026569/13722199; manifest 6187B003CC7FA9BFC9FF10C1536C3A708016CD0EF9F35F98047131644EEB17FB/1372248. CLI at C:\Users\expert\.local\bin\graphify.exe exposes `update --no-cluster`.
  implication: The four files are all dirty; a no-cluster comparison may isolate clustering, but any live update requires a protected snapshot.
- timestamp: 2026-09-25T05:20:00Z
  checked: Existing Graphify query and prior debug record.
  found: Read-only `graphify query` returns quickly. Prior record states AST extraction completed for 3,195 files, then final processing stalled. Convex fixup later returned zero new edges.
  implication: Basic CLI startup and graph loading work; stall is downstream of extraction in at least one run.
- timestamp: 2026-09-25T05:23:00Z
  checked: Installed graphifyy 0.9.11 `cli.py`, `watch.py`, `cluster.py` and current graph.
  found: `update` calls `_rebuild_code`; after extraction, it reconciles existing graph, builds NetworkX graph, compares topology, clusters, scores, generates report, and writes outputs. Existing graph has 13,651 nodes, 24,043 links, and 778 communities. `_rebuild_lock` explicitly does nothing on Windows; no `.rebuild.lock` exists.
  implication: Windows lock wait cannot explain this hang. Need stage timing to locate cost.
- timestamp: 2026-09-25T05:27:00Z
  checked: Read-only timings on current graph using installed Graphify Python.
  found: NetworkX build 1.6s; clustering 3.6-5.3s; community remap 0.5s; scoring 0.1s; surprising connections 0.2s; suggested questions 7.1s; report generation 1.0s.
  implication: These measured stages cannot individually explain a multi-minute stall. `extract()` prints per-file completion before its cross-file resolution passes, so prior observed completion does not prove `extract()` returned.
- timestamp: 2026-09-25T05:44:00Z
  checked: Instrumented `detect()` and serial `extract()` diagnostic, Graphify manifest, nested ignore rules, and four output hashes.
  found: `detect(Path('.'))` took 130.79s and returned 5,133 AST targets. Serial per-file extraction took 239.07s for 3,165 uncached files. The diagnostic entered `_augment_symbol_resolution_edges` and remained there for at least 30s before its session ended; no timing beyond that pass was captured. The manifest lists 3,200 files under `apps/web/e2e/.auth/`, including 1,682 JS/TS files under its Chrome profile. Git ignores `.auth/` via `apps/web/.gitignore`, but Graphify loads ignore rules only from ancestors of the scan root. All four generated output hashes remain unchanged.
  implication: A major avoidable scan and extraction burden comes from an ignored browser profile; the remaining post-extraction pass needs a controlled exclusion test before attributing the entire stall to it.
- timestamp: 2026-09-25T05:50:00Z
  checked: Graphify ignore predicate and read-only `detect()` with `/apps/web/e2e/.auth/` added as an explicit root exclusion.
  found: Current rules return false for `.auth`; the proposed pattern returns true. Explicit-exclusion detection took 72.966s and returned 1,205 code, 1,925 document, 1 paper, 227 image, 24 video files; zero `.auth` hits and 58 other e2e files remain.
  implication: The pattern is honored and scan time drops by roughly 58s; exact baseline category counts are still needed for an unconfounded differential.
- timestamp: 2026-09-25T05:57:00Z
  checked: Matched read-only baseline `detect()` and exclusion differential.
  found: Baseline took 187.484s and returned 3,253 code, 2,064 document, 1 paper, 1,216 image, 48 video files (6,582 total), including exactly 3,200 `.auth` paths and the same 58 ordinary e2e paths. Explicit exclusion returned 3,382 total; per-type reduction is 2,048 code, 139 document, 989 image, and 24 video, summing to exactly 3,200. The baseline time varied from the earlier 130.79s scan, but both exceed the 90-120s silent interval.
  implication: Missing nested ignore coverage is proven to cause a large, unnecessary scan workload. The exclusion preserves the intended e2e source set. Remaining ~73s of scan and final resolution still require verification.
- timestamp: 2026-09-25T06:07:00Z
  checked: Root `.graphifyignore` on disk, Graphify predicate and full read-only scan, output hashes, and diff check.
  found: Predicate is true. Scan took 60.793s; counts are exactly 1,205 code, 1,925 document, 1 paper, 227 image, 24 video; zero `.auth` files and all 58 ordinary e2e files remain. All four generated output sizes and SHA-256 hashes match the pre-run inventory. `.graphifyignore` contains only the tested pattern. (`git diff --check` exits zero but does not cover this untracked file.)
  implication: The targeted configuration fix works at the detection boundary without modifying existing graph outputs. End-to-end `graphify update .` remains unverified by owner direction.
- timestamp: 2026-09-25T09:49:45Z
  checked: Root-owned guarded Graphify update report.
  found: `graphify update .` exited 0 with 28,929 nodes, 38,127 edges, 2,195 communities. Current graph has zero `.auth` source-path matches, but `manifest.json` still has 3,200 `.auth` keys.
  implication: Source exclusion succeeded for graph topology, while manifest cleanup is a separate behavior to investigate.
- timestamp: 2026-09-25T09:55:00Z
  checked: Installed Graphify 0.9.11 `detect.save_manifest`, `detect_incremental`, cache maintenance, CLI help, and current manifest.
  found: `save_manifest` seeds output from every existing entry whose file still physically exists, then overwrites detected-file entries. It prunes only missing files. All 3,200 `.auth` paths still exist, so the ignore pattern cannot remove them from `manifest.json`. `detect_incremental` can report excluded paths as `deleted_files`, but `save_manifest` still retains them. No manifest-prune CLI exists; `clear_cache` deletes all AST/semantic cache files but does not touch the manifest. The semantic-cache prune is limited to `cache/semantic` and runs only in extract.
  implication: Repeating update or clearing extraction caches cannot solve stale manifest keys. A narrow manifest-only filter is the least disruptive cleanup.
- timestamp: 2026-09-25T09:55:00Z
  checked: Read-only manifest inventory and in-memory filtered serialization.
  found: Manifest SHA-256 is 21A09516C9534F51B84D724E044FEAAF0A8D4461D286A04FF1FC75F28A81C729, with 6,586 keys: 3,200 exact-prefix `.auth` keys and 3,386 others. All 3,200 entries have `mtime`, `ast_hash`, `semantic_hash` fields and refer to existing files. Python `json.dumps(manifest, indent=2)` byte-matches the current writer format. In-memory exact-prefix filtering removes 3,200 keys and preserves all 3,386 other values, yielding 620,959 bytes. Current graph has zero auth-sourced nodes or links. No graph output was edited by this investigation.
  implication: A manifest-only, exact-prefix deletion with preimage hash guard and post-write value equality checks can remove stale entries without rebuilding or modifying curated graph/report/labels.
- timestamp: 2026-09-25T10:00:38Z
  checked: Root-owned exact update and fixup with all four dirty outputs copied to a unique verified temporary backup before the write; post-run JSON/query, prior-node/link/label overlap, and exact-prefix manifest cleanup.
  found: `graphify update .` exited 0 after 1,136 uncached AST files, reporting 28,929 nodes, 38,127 edges and 2,195 communities. `node scripts/extract-convex-edges.mjs` exited 0, removing 15,044 noise nodes and adding 798 Convex plus 127 table edges. Final graph parses and answers a query with 13,885 nodes/24,456 links and zero `.auth` source paths. It retains 13,634/13,651 prior node IDs; 16/17 changed IDs have same-label/source replacements and the remaining ISO map title changed with the document. It retains 24,004/24,043 prior edges by exact source/target/relation/source-file tuple; 28 lost edges touch changed IDs and 11 are stale reference edges with existing endpoints. All 778 prior label entries for still-present communities are byte-equivalent; the two removed label IDs have zero current nodes. The four output backups remain at the uniquely named `pikar-graphify-backup-1077c4ea42a448449e7e8bec97ee48e8` temporary directory.
  implication: The full code graph refresh and Convex fixup now have actual successful exits. The prior generated graph was not discarded blindly; structural overlap and active curated labels were reconciled against exact backed-up bytes. This does not certify any product, provider or production layer.
- timestamp: 2026-09-25T10:00:38Z
  checked: Manifest after update, its second exact-hash snapshot, Graphify 0.9.11 writer serialization, atomic exact-prefix filter and independent post-filter equality check.
  found: A preimage guard matched SHA-256 `21A09516C9534F51B84D724E044FEAAF0A8D4461D286A04FF1FC75F28A81C729`. Two failed guards made no edit (one mistyped hash, then LF-versus-CRLF mismatch). The corrected writer-compatible CRLF candidate atomically removed exactly 3,200 `apps/web/e2e/.auth/` keys and retained all 3,386 other key/value pairs exactly. Final manifest has zero auth keys, 637,890 bytes and SHA-256 `628CBE65B972957E67943AAEBCD5D69F4EF20E0EAADD801F9E088B2D50777A83`. The graph, labels and manifest parse as JSON and the report remains readable; strict planning, `git diff --check` and graph query exited 0.
  implication: Ignored Playwright profile artifacts are absent from both the refreshed graph and its manifest. No extra manifest key was removed.

## Eliminated

- hypothesis: Interactive `graphify update` is blocked waiting on a per-repository rebuild lock.
  evidence: Installed `_rebuild_lock` yields immediately when `fcntl` is unavailable on Windows; no lock file exists.
  timestamp: 2026-09-25T05:23:00Z

## Resolution

root_cause: Graphify 0.9.11 root scans load only ancestor `.gitignore` files, so they missed `apps/web/.gitignore`'s `/e2e/.auth/` rule. Detection included 3,200 ignored Playwright profile artifacts, causing a long silent scan. Separately, `save_manifest` retained every old key whose file still existed despite the new exclusion.
fix: Added root `.graphifyignore` pattern `/apps/web/e2e/.auth/`; performed one guarded full update and Convex fixup; atomically pruned only the stale exact-prefix manifest entries after a hash-verified snapshot.
verification: Read-only detection retained all 58 ordinary e2e files and zero `.auth` files; full update, fixup, graph query, planning and diff checks exited 0. Final graph has zero `.auth` source paths, final manifest has zero `.auth` keys, all 3,386 non-auth manifest entries match the snapshot, and all 778 still-active prior curated labels are unchanged.
files_changed: [.graphifyignore, graphify-out/.graphify_labels.json, graphify-out/GRAPH_REPORT.md, graphify-out/graph.json, graphify-out/manifest.json]
