# Product method review — draft, 2026-09-10

Status: adaptation authored and source bytes inspected; independent method review, native model eval, responsive authenticated UAT and runtime binding are still missing. This document is not a reviewer sign-off or activation record.

## Provenance and attribution

Anthropic knowledge-work-plugins, Apache-2.0, exact commit `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`:

- [write-spec](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/product-management/skills/write-spec/SKILL.md)
- [roadmap-update](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/product-management/skills/roadmap-update/SKILL.md)

Snapshots live under `third_party/knowledge-work-plugins/source-snapshot/` at the same paths. `manifest.json` pins SHA256, byte length and official tree Git blob SHA for each source. The plugin has its own `product-management/LICENSE`; its bytes match the redistributed clean Apache-2.0 copy. Existing repository root license anomaly does not alter which file this plugin ships. Attribution and this modification notice accompany the candidate.

## Adaptation decisions

| Source behavior | Candidate behavior | Reason |
| --- | --- | --- |
| PRD problem, goals, non-goals, stories and acceptance criteria | Retain as cited brief sections; include assumptions and contradictions | Useful portable method |
| Project-tracker, design and knowledge-base connector lookups | Only tenant Vault search and user-provided material | No vertical connector authority |
| Suggested priority frameworks with scores, default percentages and capacity allocation | Only user-supplied criteria and supported inputs; otherwise unranked/unknown | Avoid invented demand, effort and precision |
| Roadmap status/date/owner updates and follow-up ticket updates | Proposed internal brief; external mutations forbidden | An artifact is not a committed delivery plan |
| Numeric metric target examples | Clearly proposed measures, with unknown targets/baselines unless supplied | Examples are not customer evidence |
| Source content usable as context | Source bodies remain untrusted data | Source text cannot widen tool grants or release a candidate |

`sourceRefs` must come from supplied or native retrieved evidence; an `artifactRef` must come from the actual save result. The native save tool stages the subsequent reply, so the body preserves its call-before-document ordering.

## Review and eval work still required

The fixture set includes supported input, sparse evidence, invented demand, missing prioritization criteria and injected project mutations. Local artifact tests check provenance, candidate boundaries and code-owned tool parity; they do not prove model-generated output quality. A later exact-version native eval must execute every fixture against the candidate and score citations, unknown values, tool trace, artifact result and refusal of injected authority. Responsive authenticated UAT must prove usable and retained documents. Until then `runtimeEnabled` is false and every runtime-evidence field is null.
