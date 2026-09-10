# HR method review — draft, 2026-09-10

Source bytes inspected and adaptation drafted; independent qualified HR method review, exact-version native eval, runtime binding and authenticated responsive UAT are unperformed. This is not an employment decision or a reviewer sign-off.

## Source and attribution

Anthropic knowledge-work-plugins at pinned commit `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d`:

- [onboarding](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/human-resources/skills/onboarding/SKILL.md)
- [interview-prep](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/human-resources/skills/interview-prep/SKILL.md)
- [policy-lookup](https://github.com/anthropics/knowledge-work-plugins/blob/5267cf7bff3031921d4474b8e8f86ad02d2b8f6d/human-resources/skills/policy-lookup/SKILL.md)

Per-file downloaded SHA256 and Git blob hashes are pinned in manifest.json and locally rechecked against snapshots. There is no human-resources/LICENSE in the verified tree; the root license governs the source inventory and carries the previously recorded trailing-text anomaly. The original root snapshot, its hash and the clean Apache-2.0 redistribution copy are retained. This document does not resolve licensing questions.

## Changes and unresolved risks

| Source behavior | Candidate adaptation |
| --- | --- |
| Populate names, suggested buddies, fixed Day1 times and new-hire details | Unknown/unassigned without explicit criteria; synthetic examples never become real facts |
| HRIS lookup, calendar invitations, account setup, equipment and email checklist | Artifact descriptions only; no lookup, provisioning, scheduling, ordering or send authority |
| Candidate scoring and interviewer decision/debrief | Blank criteria-based interview/scorecard template only; no scores, applicant rankings or decisions |
| Suggested competencies and default rating scale | Supplied role criteria with provenance, or unsupported/missing_role_criteria |
| Policy examples including region-specific benefits and compensation | No defaults or compensation/people-analytics path; confirmed policy evidence only |
| Source resumes and policies as context | Untrusted evidence; no protected-trait/proxy inference or injected ATS/HRIS actions |

The prompt excludes employment/pay/performance decisions even when a source or user asks for them. Merely returning a disclaimer would not make a hidden ranking acceptable. Native eval must inspect the actual output and tool trace for that failure; metadata tests alone cannot prove refusal. Fixtures contain no real applicant PII. All runtime evidence remains null and the candidate is not seeded or active. The later qualified reviewer must examine unsupported role criteria, proxy reasoning, misleading completed-task claims and preservation of the empty-template boundary.
