# Playbook: <feature name>

> Last verified: YYYY-MM-DD against <commit short-sha>
> Build history: `.planning/phases/<phase-dir>/` · Related ADRs: <links or "none">

## Purpose

2–4 sentences: what this does for the user/system and why it exists. Plain language.

## Key files

Repo-relative paths with a one-line role each. Group by layer (frontend / backend /
pure packages / tests). Cite files and exported function names — not line numbers,
they rot.

## Dependencies & blast radius

Run `graphify query "<feature>"` for the current subgraph. List here only the
couplings graphify cannot see (runtime contracts, env vars, seed data, external
services).

## Data flow

Numbered steps from trigger to terminal state. Name the actual functions/tables at
each step.

## Invariants — what must never break

The contract list. Each entry: the rule, why it exists, and where it is enforced
(test file or lint rule). If an invariant has no enforcement, say so — that is a gap,
not a footnote.

## How to change safely

Order of operations for common change types (schema change, new step, new UI state…).
Which invariants each change type is most likely to violate. What to re-run.

## How to verify

Exact commands and what each proves. Distinguish: unit tests / static scans / smoke
scripts needing a live deployment / manual-only checks.

## Operational notes

Env vars, seeds, deploy steps, known pitfalls with their fixes.

## Known gaps & deferred work

Deliberate ceilings (`ponytail:` items), stubs, and where the upgrade path is recorded.
