# Deferred Items — Phase 15.4

## 2026-08-04 — Foreign playbook watcher failures during 15.4-01

`node scripts/check-playbooks.mjs` confirms `docs/playbooks/vault.md` is current, but reports a
global `decision: block` for unrelated working-tree changes in the CI/formatter lane. The stale
playbooks named by the watcher are: `ci-gate.md`, `authorization.md`, `growth-diagnostic.md`,
`business-evaluation.md`, `onboarding.md`, `agent-runtime.md`, `cockpit.md`,
`audit-dead-letter.md`, `voice.md`, `skill-registry.md`, `intake.md`, `media.md`, and
`guardrails.md`.

These changes are outside Plan 15.4-01 ownership and were deliberately not modified or staged.
The owning lane must update or re-verify those playbooks after its repository-wide changes settle.
