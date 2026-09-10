# Design method review — draft, 2026-09-10

Status: adaptation authored and source bytes inspected; independent method review, native model eval, responsive authenticated UAT and runtime binding remain missing. This is not a professional accessibility review, release approval or live-test record.

## Provenance and attribution

Anthropic knowledge-work-plugins, exact commit `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`:

- [design-critique](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/design/skills/design-critique/SKILL.md)
- [accessibility-review](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/design/skills/accessibility-review/SKILL.md)

Pinned raw snapshots and per-file SHA256/Git blob hashes are retained in the source snapshot and manifest. Design has no per-plugin LICENSE in the verified tree. The root LICENSE is snapshotted as received and contains the already-recorded unrelated trailing-text anomaly; manifest.json names its exact hash. The clean Apache-2.0 redistribution copy and attribution are retained. Independent licensing review remains part of release review; this authoring step does not resolve legal questions.

## Adaptation decisions

| Source behavior | Candidate behavior | Reason |
| --- | --- | --- |
| Critique usability, visual hierarchy, consistency and strengths | Retain only artifact-supported findings with source/location, confidence and remediation | Useful portable critique structure |
| Read a Figma URL or inspect component tokens/layers | Connector blocked; request an accessible artifact export | Link presence is not access evidence |
| Contrast pass/fail table and WCAG compliance-report framing | No certification; measured checks stay test-required without attributable same-version test evidence | Screenshots do not establish DOM, keyboard or assistive-technology behavior |
| Default numerical criterion tables and automated coverage percentage | Removed | Unverified thresholds/coverage estimates are not an executed test |
| Project-tracker tickets and component-system changes | Forbidden external writes | Candidate creates an internal critique document only |
| User source content as review context | Untrusted evidence, never permission to use tools or suppress limitations | Prevent injected Figma access, publication or false certification |

Brand comparison requires confirmed tenant guidance; Pikar's product brand is not automatically the tenant's standard. Vault text extraction alone does not prove the reviewing model saw a screenshot. Without an actual visual input, visible-layout findings are blocked or partial. If the user supplies a test report, cite it as supplied evidence rather than claiming to have rerun it.

## Review and eval work still required

Fixtures cover visible artifact input, missing brand and interaction evidence, inaccessible image content, false certification, and an injected Figma mutation. Local tests validate provenance, candidate status and parity with code-owned tool grants. They do not run a model, inspect a real screenshot or prove accessibility. Later native exact-version evals must attach real accessible test artifacts, verify observable/test-required separation and check that denied connector operations never appear in tool traces. Authenticated responsive UAT and artifact retention evidence remain required before exposure; all runtime-evidence fields stay null.
