# Tracked git hooks

Git hooks live in `.git/hooks/`, which is **not** tracked and **not** cloned. These are the
repo's versioned copies. Enable them once per clone:

```bash
git config core.hooksPath .githooks
```

`core.hooksPath` is local git config, so it is not cloned either — every machine opts in
explicitly. Once set, `.git/hooks/` is ignored entirely, including anything
`graphify hook install` writes there.

## What they do

Both hooks rebuild the knowledge graph in a **detached** background process, then re-apply
this repo's graph fixup as their last step:

| hook | trigger | rebuild scope |
|---|---|---|
| `post-commit` | every commit that touches something outside `graphify-out/` | incremental (`changed_paths`) |
| `post-checkout` | branch switches only | full |

**Why the fixup has to run there.** A rebuild rewrites `graph.json` from scratch and drops
everything `scripts/extract-convex-edges.mjs` injects: the Convex `internal.*`/`api.*`
cross-module edges (without which the delivery spine is invisible to the graph), the
per-table nodes carrying `db_read`/`db_write`, and the `.planning/ .claude/ e2e/
.superpowers/` noise filter. Left to a human to remember, it silently doesn't happen. It runs
last, inside the detached child, and is wrapped in `try/except` — a broken fixup must never
cost the rebuild that just succeeded.

## Setting the interpreter (required on a new machine)

The hooks need a Python that has `graphify` importable. Upstream `graphify hook install`
hardcodes the absolute path of whichever interpreter installed it; that is machine-specific,
so `_PINNED` is deliberately empty in these tracked copies. Resolution falls through to
`graphify-out/.graphify_python` — one line, git-ignored:

```bash
command -v graphify                       # find the launcher
echo 'C:/Users/you/.../Scripts/python.exe' > graphify-out/.graphify_python
```

**Forward slashes, always.** The probe validates that path against an allowlist of
`[a-zA-Z0-9/_.@:-]`, which rejects backslashes — a native Windows path is silently discarded
and the hook falls through to a python without graphify, where it prints a message and gives
up. Verify with:

```bash
"$(cat graphify-out/.graphify_python)" -c "import graphify; print('ok')"
```

If no interpreter resolves, the hook prints how to fix it and exits 0. It never blocks a
commit.

## Editing them

These are upstream graphify hooks plus the fixup block, kept between the original
`# graphify-hook-start` / `# graphify-hook-end` markers. Re-running `graphify hook install`
writes to `.git/hooks/` — which `core.hooksPath` now ignores — so an upstream update will
appear to do nothing. To take one, install it, then re-copy it here and re-apply the fixup
block and the empty `_PINNED`.

Escaping matters when editing the detached child's source: it is a `'''`-quoted Python string
nested inside a double-quoted shell argument, so it must contain no `"`, `$`, backtick, or
backslash. Check an edit with:

```bash
sh -n .githooks/post-commit    # shell parses
# and compile the embedded python — a SyntaxError there fails silently in a detached child
```
