---
phase: 53-agentic-online-presence
plan: "05"
status: complete
completed: 2026-10-22
requirements-completed: []
---

# 53-05 — Real images throughout the website workflow

## Result

Removed the implementation restriction to text-led sites. The actual specialist now reads bounded
owned image candidates, calls its frozen prepareOnlinePresenceAssets tool, saves the returned
hash-bound logo/hero/gallery refs and builds real image-backed immutable pages. Customers do not
author HTML, choose storage URLs or wire assets. Existing uploaded and generated Vault rasters are
reused; missing visual material remains a truthful information gap rather than an invented photo.
No paid generation capability was added to the model grant.

The three directions support real responsive images, alternative text, crop/aspect/focal points
and logos. Real bytes are inspected, copied under lifecycle ownership and frozen independently of
the source file. Versions snapshot exact owned assets. Private preview loads one authenticated
exact-version image at a time as bounded data URLs in an inert presentation; failure blocks approval
readiness and late responses cannot cross versions. Stored artifacts/hashes remain immutable.

Anonymous image serving checks current published head, exact snapshot, owned row, immutable storage
SHA/size, actual blob length and final publication state after storage I/O. It streams the frozen
copy without repeated expensive full-container inspection. Wrong tenant/hash/host, drafts, erasure,
unpublish and retired references refuse. Source-file deletion preserves reviewed copied bytes;
tenant export/erasure includes webAssets.storageId. Schema/privacy inventories now contain79 tables.
See ADR-063 and docs/design/online-presence-media.md.

## Executed evidence

| Check | Actual result |
| --- | --- |
| Full core |1,721 tests/67 files passed before the final added cap regression and commerce recovery |
| Final focused core |24/24 asset/recipe tests passed after the extra cap/closed-shape checks |
| Contracts |129 tests/7 files passed |
| Private goods foundation |22/22 tests passed separately; partial53-03 only |
| Native integration |Final9 files97/97 passed: assets, actual specialist cycle, recipes/evaluator, legacy artifact compatibility, lifecycle, runtime/HTTP and schema |
| Namespace/isolation |9 routine namespace and54 isolation tests passed in the agent's broader integration run |
| User review interface |Final18/18 tests passed, including protected images, absent image refusal, exact-version races and approval readiness |
| Real browser |23/23 passed across three widths; final nine media captures additionally awaited complete image decoding/paint and passed |
| Large image public path |Actual3,357,434-byte PNG returned with independent SHA/exact byte equality. Same-size digest substitution, expected/actual size drift and unpublish-during-read refused. Local19–29ms GET observations are not hosted benchmarks |
| Typechecks/build |Final core/contracts typechecks passed after commerce recovery; backend final controlled typecheck passed; frontend production build and TypeScript passed,39 pages generated |
| Changed-source checks |44 source/config files passed lint/format; no dependency/library change |
| Offline gates |Final24/24 green; checked source inventories and generated manifests match the tree |
| Planning/playbook checks |Passed after final progress, privacy/module inventories and documentation updates |

The initial broader native run passed95/97 and found only two stale schema-header inventory
assertions. Corrected79-table count/name, refreshed exact identities and reran all nine suites:
97/97 passed. The first full-page media screenshots raced asynchronous image paint; awaiting decode
and paint resolved the missing screenshot picture without changing the renderer. No full backend
repository run or live model/merchant/browser qualification is claimed.

Three original illustration PNGs were generated with the built-in image tool for fictional visual
tests and copied into the repository with prompts/hashes. Six representative final screenshots
are saved under docs/design/online-presence-media. The visible sample copy identifies illustrations;
they are not customer work, default customer imagery or live acceptance evidence. Taste/UI UX
guidance is adapted to the safe runtime; full upstream inspector/image/motion floors are unclaimed.

## Exact-source identities

Compiler, designed renderer and ordinary runtime now identify as v4. Recipe deterministic protocol:
`2026-10-22.online-presence-media.v5`; actual browser evidence protocol: `browser-observed-v4`.
Media refs/crop/external-ref refusal join native qualification. The checked20-source recipe
implementation hash is `662af6a77d918ad8883975e3b5fcde05e0609279b728de08fbdfe5176f0b8b8a`.

Golden revision:
`2026-09-11.budgeted-evaluator.ebbf92903e1ff6a58bde80b5d5618367e23e369a0fdd3314b3566f89f2b277d4`.
Vertical revision: `1537bbe59d8c38e356b049c01caa77b45bf2eb375b2cc64a9dec300a5a0ace69`.
Fixture/corpus bytes and the eight-record design bundle are unchanged. Mechanical pin updates
retire prior receipts; they do not record a passing live evaluation or activate a registry row.

## Remaining live boundary

This completes the local imagery plan.53-02 still needs a designated isolated staging target,
native owner/non-owner witnesses, admitted actual model execution, exact recipe/service registry
qualification, publication/inquiry/offline/rollback and image observations. No target is configured
in this isolated checkout; a target-selection question is pending with the owner. Existing staging
belongs to a different lane and was not reused. No shared deployment or customer publication occurred.

53-03 is partially recovered pure goods logic, not merchant checkout. Its persistent adapters,
account/onboarding, both payment providers, refunds, physical/digital delivery and actual provider
witnesses remain explicitly open. No OPRES release requirement or current readiness programme phase
is marked complete by these local checks. The preexisting owner edit in the older quality review
was preserved separately from this change.

Graphify query/update were attempted but the executable is unavailable. Scoped source/history reads
were the fallback. The edge fixup ran and registered79 tables; missing AST nodes remain unresolved,
so the graph update is partial rather than a full regeneration.
