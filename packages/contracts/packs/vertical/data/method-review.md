# Data method review — draft, 2026-09-10

Status: source-backed candidate adaptation. This is not an independent review sign-off, a native
model evaluation, authenticated product UAT or authorization for release.

## Source and modifications

Anthropic knowledge-work-plugins, Apache-2.0, pinned commit
`5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`:

- [analyze](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/data/skills/analyze/SKILL.md)
- [explore-data](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/data/skills/explore-data/SKILL.md)
- [validate-data](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/data/skills/validate-data/SKILL.md)

`manifest.json` records downloaded byte hashes and the pinned official Git blob ids. The plugin's
own `data/LICENSE` matches the redistributed clean Apache-2.0 license. Source snapshots are retained
alongside the other upstream pack snapshots. Pikar modification notice: adapted 2026-09-10 to a
bounded file-only deterministic profile; removed warehouse, code execution and external operations.

| Source method | Pikar candidate decision |
| --- | --- |
| Scope the question, inspect source shape and report methodology | Retain exact owned file/sheet/range scope and explicit coverage |
| Compute profiles, distributions and missing/duplicate statistics | Pure TypeScript computes facts; the model may only explain them |
| Check units, denominators, timezones and overconfident conclusions | Preserve structured warnings and leave unsupported metrics unknown |
| Query warehouses or generate Python analyses | Forbidden; no connector or code execution tool is granted |
| Infer or clean data types and values | Preserve parser types; ambiguous text remains text; no repair |
| Share-ready quality rating | Human review required; no unsupported assurance of accuracy |

The owner-only deterministic file preview is an engineering verification surface, not a released
vertical route. It creates a normal internal Vault artifact from actual typed file bytes, with no
model call or external side effect. It does not evaluate this skill or satisfy native exposure gates.

## Remaining evidence

Independent method review must assess statistical scope, cached-formula disclosure, cap semantics,
provenance and refusals. Exact-version native eval must attack fabricated numbers, malicious file
instructions, warehouse/code/send requests and omitted warnings. Authenticated responsive UAT must
verify source selection, artifact retention and accessibility before a native binding can release.
