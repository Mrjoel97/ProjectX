# docs/

Two document types live here. Both exist so that any engineer or agent can change a
feature safely without archaeology through chat history or git blame.

## `playbooks/` — one per feature/subsystem

A playbook answers: what is this, what must never break, how do I change it safely,
how do I prove it still works, and how is it operated. Playbooks reference — never
duplicate — facts that tools already derive:

- **Dependencies / blast radius** → `graphify query "<feature>"` (AST-derived, always current)
- **Build history** → `.planning/phases/*/` (GSD plans, research, summaries) and git log
- **Binding architecture rules** → `CLAUDE.md`

Start from `playbooks/TEMPLATE.md`. Keep one playbook per real subsystem (~8–12 total),
not per function.

**Maintenance rule:** a change that touches a playbook's subsystem updates the playbook
in the same commit/phase. Stale playbooks are worse than none — they confidently mislead.
Each playbook carries a `Last verified` date; bump it when you confirm the content
against the code.

**Enforcement:** this rule is machine-enforced, not honor-system. `playbooks/watch.json`
maps each playbook to the path prefixes it covers; a Claude Code Stop hook
(`scripts/check-playbooks.mjs`, wired in `.claude/settings.json`) compares everything
changed since session start against that map and blocks the agent from finishing until
stale playbooks are updated (or their `Last verified` line is bumped when the change is
genuinely irrelevant). **A new playbook is not live until its paths are registered in
`watch.json`.**

**Creation:** the same hook closes the new-subsystem gap. Any new `.ts`/`.tsx`/`.mjs`
file under `packages/` or `apps/` (tests and `_generated/` excluded) that no playbook
covers also blocks the agent, with three ways out: add the path to an existing
playbook's `watch.json` entry, create a new playbook from `TEMPLATE.md` and register
it, or list the path under `"_unassigned"` in `watch.json` to acknowledge it needs no
playbook. The agent building a feature writes its playbook as part of the phase — the
hook makes skipping that impossible, not optional.

## `decisions/` — Architecture Decision Records (ADRs)

One immutable record per significant architectural decision: context, the decision,
alternatives rejected, consequences. ADRs are **never edited after acceptance** — a
reversal is a new ADR that supersedes the old one (update the old ADR's Status line
only). This is what makes them rot-proof.

Numbering: `NNN-<slug>.md`, next free number.

## `governance/` — pointer-only cross-system evidence indexes

Governance indexes connect existing controls and evidence across subsystems. They are not another
family of runbooks and do not hold mutable runtime records. The canonical ISO evidence-alignment
index is [`governance/iso-9001-conformance-map.md`](governance/iso-9001-conformance-map.md).
