# ADR-062: Customer-selected social assets and explicit publication approval

Date: 2026-10-20
Status: proposed implementation; platform qualification and live publication pending.
Authority: owner request for customer-facing account selection, content reading, publishing tools and required platform approvals, with X deferred.

## Decision

Extend the direct social connection foundation with explicit tenant-owned asset selection and incremental read/publish intent. Connections identify a customer identity; they do not authorize every returned resource for workspace use. Discover provider-authorized assets, require saved selection and verify it again at reads and publication. Preserve founder business accounts solely as test resources.

The agent may read selected-account content and stage drafts. A customer approves one immutable saved revision containing destination, text, media and provider-specific visibility/disclosures. The server consumes approval for one submission, fences reconnect/disconnect and selection changes, and does not automatically retry an ambiguous external write. Store bounded results and redaction-safe references rather than credentials or raw content in audit logs.

Each provider remains disabled for publishing until configuration, scope access, review eligibility and controlled live tests pass. Request expanded grants explicitly; keep Meta read and publishing login configurations separate. Use provider-required TikTok creator choices and owned, verified server-media delivery. X work remains deferred.

## Alternatives and consequences

A standing permission allowing an agent to publish anything would reduce clicks but exceeds the requested customer control and makes provider consent evidence weaker. Treating every OAuth asset as selected would expose unintended resources. Reusing founder tokens would violate tenant boundaries. Existing Buffer/Zernio capabilities remain separate.

The first release intentionally supports bounded recent-content reads, Facebook Page text, Instagram JPEG and small MP4 video paths. Customer availability depends on provider approvals and tested behavior, not merely code completion. See [review packet](../social-platform-review.md) and [operational playbook](../playbooks/social-connections.md). No platform approval is asserted by this ADR.
