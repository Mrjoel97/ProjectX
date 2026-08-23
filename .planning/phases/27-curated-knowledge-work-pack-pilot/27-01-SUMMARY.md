---
phase: 27-curated-knowledge-work-pack-pilot
plan: 01
subsystem: workflow-packs
tags: [provenance, licensing, apache-2.0, upstream-pin, third-party]

requires: []
provides:
  - An exact 40-character upstream pin with a byte-for-byte snapshot of the selected sources
  - Per-file SHA-256 plus the upstream git blob sha for every snapshotted file
  - Apache-2.0 attribution and a section 4(b) modification notice that survive redistribution
  - An offline, read-only verifier and a vitest-resident gate over the same properties
affects: [skill-registry, workflow-packs]

tech-stack:
  added: []
  patterns:
    - vendored material hashed from the working tree, protected by a local `* -text` .gitattributes
    - manifest as the authoritative inventory, explicitly superseding a planning-file table

key-files:
  created:
    - third_party/knowledge-work-plugins/manifest.json
    - third_party/knowledge-work-plugins/LICENSE
    - third_party/knowledge-work-plugins/.gitattributes
    - third_party/knowledge-work-plugins/source-snapshot/ (15 files)
    - THIRD_PARTY_NOTICES.md
    - scripts/verify-knowledge-work-provenance.mjs
    - packages/contracts/src/skills/knowledgeWorkProvenance.test.ts
  modified:
    - docs/playbooks/skill-registry.md
    - .planning/phases/27-curated-knowledge-work-pack-pilot/27-RESEARCH.md

key-decisions:
  - "The manifest is the AUTHORITATIVE inventory and says so; 27-RESEARCH's table is annotated as superseded rather than deleted, so the next reader does not re-derive the wrong one."
  - "Every hash pins the canonical `.md` destination, never the auto-derived `.ts` constant — hashing the mirror would pin the copy rather than the original."
  - "The upstream root LICENSE anomaly is snapshotted VERBATIM, not cleaned: a snapshot tidied on the way in can never be diffed against upstream again. The clean per-plugin Apache-2.0 text is what we redistribute under."
  - "A local `.gitattributes` with `* -text` protects the vendored tree from the repo root's `* text=auto`, which would rewrite the files on a Windows checkout and invalidate every hash."
  - "Both gates refuse a HALF-populated adapted-body set, so an unfinished adaptation cannot look complete."

patterns-established:
  - "A provenance manifest records a SECOND independent identifier (the upstream git blob sha) beside our own hash, so a disagreement is diagnosable rather than opaque."
  - "A duplicated fact inside a manifest is a second place for it to be wrong, and must be cross-checked against its source of truth."

requirements-completed: [PACK-01]

duration: 34min
completed: 2026-08-23
---

# Phase 27 Plan 01: Upstream Pin and Provenance Summary

**The material the six packs will be adapted from is pinned to one exact commit, snapshotted
byte-for-byte, hashed twice over, and licensed — and the planning files' inventory of it turned out
to be wrong in three ways, all corrected against the real tree.**

## Performance

- **Duration:** ~34 min
- **Tasks:** 2
- **Files created/modified:** 22 (15 snapshot files + 7 others)
- **Cost:** $0.00 — the phase's one network fetch is the GitHub API and raw content; no model call.

## Step 0: the mandatory re-inventory, and what it found

The plan required listing the upstream tree at the pinned SHA before trusting any path, because the
research table was known-wrong in at least one place. Listing the **full recursive tree** at
`5267cf7bff3031921d4474b8e8f86ad02d2b8f6d` (1657 entries, `truncated: false`) found three problems,
not one — and the known-wrong claim was itself wrong:

| Claim in the planning files | Reality at the pinned commit |
|---|---|
| `small-business/skills/ticket-deflector/` does **not** exist (27-READINESS) | **It does**, with 3 files — and it is the correct Customer Complaint Response source |
| Sales Call Prep and Process/SOP Builder were never inventoried | They exist at `sales/skills/call-prep` and `operations/skills/process-doc` |
| The selection lives under `small-business/` | Only 2 of 6 do. The rest are in `marketing/`, `sales/` and `operations/` |

**The single root cause: both the research and the audit searched only the `small-business/` subtree
the context named.** Four of the six Pikar pack ids are exact upstream skill names
(`business-pulse`, `campaign-plan`, `brand-review`) or near-exact (`sales-call-prep` →
`call-prep`) — the pack names were derived from these skills, so restricting the search to one
plugin root was always going to miss most of them.

**No pack needed an `upstreamSource: null` record.** `small-business/skills/handle-complaint` also
exists and was considered and **rejected**: it is a router that chains two other skills, and a Pikar
pack carries a tool allow-list so it structurally cannot dispatch. `ticket-deflector` is the
substantive workflow.

## The licence anomaly

The repository **root** `LICENSE` at this commit carries ~249 bytes of unrelated text appended after
the end of the Apache-2.0 appendix (beginning `Syntax-file, code seperations,`). It is snapshotted
**verbatim** — a snapshot corrected on the way in can never be diffed against upstream again — and
recorded in `manifest.json` under `license.rootLicenseAnomaly`. The copy Pikar redistributes under
is the clean per-plugin Apache-2.0 text, which `marketing/LICENSE` and `sales/LICENSE` ship
byte-identically to each other. `small-business/` and `operations/` ship no per-plugin licence, so
the root one governs them; that mapping is recorded too.

## Verification — all executed

```
node scripts/verify-knowledge-work-provenance.mjs --check-source      15 files, 6 packs, OK
cd packages/contracts && npx vitest run                               5 files / 73 passed
cd packages/contracts && npx tsc --noEmit                             clean
npx biome ci . --diagnostic-level=error --max-diagnostics=none        679 files, clean
```

### Failure modes proven RED, then restored

| Mutation | Gate that caught it |
|---|---|
| a byte appended to a snapshot source file | both the CLI verifier and the vitest gate |
| a manifest `sha256` changed on a real source file | CLI verifier |
| `upstream.commit` replaced by `main` | CLI verifier (two problems: shape, and the notices no longer cite it) |
| an undeclared file smuggled into the snapshot | CLI verifier (the both-ways walk) |
| a half-populated adapted-body set | CLI verifier |
| the `NOTICE OF MODIFICATION` heading removed | vitest gate |

**One gap was found by mutating and then closed.** `license.rootLicenseAnomaly.sha256` duplicated a
hash that nothing checked, so it could silently disagree with the file it describes — my first
mutation attempt hit that field and the verifier stayed green. It is now cross-checked against the
declared licence file. A duplicated fact inside a manifest is a second place for it to be wrong.

## Deviations from the plan

- **Sources are drawn from four plugin roots, not just `small-business/`.** The phase context names
  the repo and the `small-business` subtree as "upstream roots"; taking that as a hard boundary
  would have forced four `upstreamSource: null` records while exact-name counterparts sat in the
  same pinned repository. Recorded in the manifest with the evidence.
- **`third_party/knowledge-work-plugins/.gitattributes`** is not in the plan's `files_modified`. It
  is load-bearing: the repo root sets `* text=auto`, which would rewrite the snapshot on a Windows
  checkout and invalidate every hash. Verified with `git check-attr` that `text` is unset for a
  snapshot file.
- **`.planning/.../27-RESEARCH.md`** is annotated (not in `files_modified`) so its superseded table
  carries the correction inline. The audit's own wrong claim is corrected in the manifest and the
  playbook rather than by editing `27-READINESS.md`, which is a dated audit record.

## Next

Wave 1 is complete (27-01, 27-02) and wave 2 is unblocked: **27-04, 27-05 and 27-06 can now run**,
each authoring two pack bodies plus fixtures against 27-02's operation matrix and this plan's pinned
sources. They are independent of one another and share no files, so they can run in parallel. Their
blocking evidence is `node scripts/run-workflow-pack-evals.mjs --packs <a>,<b> --fixtures-only`,
which is **red until that lane writes its fixtures** — that was fixed in 27-02's review round.
27-03 is already done, so 27-07 needs only the three body lanes.
