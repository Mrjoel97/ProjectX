---
phase: 30-optional-vertical-workflow-packs
plan: 01
status: complete
completed: 2026-09-10
requirements-completed: []
---

# 30-01 — Closed vertical policy contract

Implemented `packages/core/src/verticalPacks.ts` over native `PackOperation`, `PackOutput`,
source and template types. The six vertical ids and workflow ids are closed; Bio is absent.
Code-owned grants take only a workflow id, so tier/profile/relevance cannot add authority.
The recommender emits at most two deterministic results and distinguishes missing profile,
confirmed need/repeat usage, release, sources, review, legal playbook, deterministic Data
validation and connector eligibility. Disable preserves artifacts; rollback names a previously
active exact version. `docs/playbooks/vertical-packs.md` records the operating contract and is watched.

Validation: four tests exercise the closed sets, state/reason paths, stable bounded ranking,
every tier/workflow authority pair and Bio exclusion. Core TypeScript check passed.

This completes the pure policy deliverable only. There is no published vertical body, active
runtime route, tenant exposure or live-eval evidence in this plan. VERT-01–04 remain pending
until their consuming plans satisfy the phase acceptance criteria. Next: 30-02 tenant adapters,
then 30-03–07 candidates, 30-08 exact-version eval, 30-09 discovery and 30-10 rollback evidence.
