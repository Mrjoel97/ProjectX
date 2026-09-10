# Third-Party Notices

This product includes third-party material. The notices below satisfy the attribution and
modification-notice obligations of the licences that material is distributed under.

---

## Anthropic Knowledge-Work Plugins

**Source:** https://github.com/anthropics/knowledge-work-plugins
**Pinned commit:** `5267cf7bff3031921d4474b8e8f86ad02d2b8f6d` (2026-08-20)
**Licence:** Apache License, Version 2.0
**Licence text:** [`third_party/knowledge-work-plugins/LICENSE`](third_party/knowledge-work-plugins/LICENSE)
**Snapshot of the material as received:** `third_party/knowledge-work-plugins/source-snapshot/`
**Machine-readable inventory (per-file SHA-256):** `third_party/knowledge-work-plugins/manifest.json`

Copyright the Anthropic Knowledge-Work Plugins authors.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use these files except
in compliance with the License. You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. See the License for the specific language governing permissions and limitations under the
License.

### NOTICE OF MODIFICATION (Apache-2.0 §4(b))

**Pikar AI has modified this material.** The six workflows below were adapted, not copied. Each is
rewritten as a Pikar skill-registry body that runs on Pikar's own agent runtime under a code-owned
tool allow-list; none of the upstream plugin machinery, connector integrations, or tool grants are
carried over. The adapted bodies are separate files under `packages/contracts/skills/` and are not
the upstream files.

| Pikar pack | Upstream source at the pinned commit | Nature of the modification |
|---|---|---|
| `business-pulse` | `small-business/skills/business-pulse` | Connector sections (QuickBooks, PayPal, Square, HubSpot) **removed**. Those sources are unreachable in Pikar and the pack names them to the user rather than implying it read them. Output is an in-thread briefing, not a saved report. |
| `campaign-plan` | `marketing/skills/campaign-plan` | Rewritten to **produce a plan only**. The upstream skill implies executing the campaign; a Pikar pack carries a tool allow-list and structurally cannot dispatch another agent or send anything. |
| `customer-complaint` | `small-business/skills/ticket-deflector` | **Refund issuance and every send removed.** Pikar drafts a reply and stages it for a single human approval step. Order, refund and CRM history are unreachable and are named as such. |
| `sales-call-prep` | `sales/skills/call-prep` | CRM account and deal lookups **removed** and named as unavailable. Retains the standalone user-input plus web-research path. |
| `process-sop` | `operations/skills/process-doc` | Publishing, task-system export and owner assignment **removed** and named as unavailable. Produces a durable document only. |
| `brand-review` | `marketing/skills/brand-review` | Rewritten to review against general principles, because Pikar holds no confirmed tenant brand guidance. The pack states this limitation in its own output. |

The upstream material is **reference input, not a runtime dependency**. Pikar loads no plugin, reads
no `.mcp.json`, and executes none of the upstream files. Updates enter only as a human-reviewed diff
against a newly pinned commit; nothing auto-syncs, auto-publishes, or auto-activates.

### Optional vertical candidate adaptations (2026-09-10)

Pikar has also adapted the following material at the same pinned commit into separate candidate
bodies under `packages/contracts/packs/vertical/`. Each directory contains the canonical body,
exact source and body hashes, operation matrix and a draft method review. These are candidate
artifacts; attribution does not imply activation, review approval or passing runtime evaluation.

| Candidate | Upstream skill directories | Modifications |
|---|---|---|
| Legal | `legal/skills/review-contract` | Reframed as cited issue spotting against supplied playbooks for qualified counsel review; removed execution and legal-system authority. |
| HR | `human-resources/skills/onboarding`, `human-resources/skills/interview-prep`, `human-resources/skills/policy-lookup` | Reframed as evidence-scoped onboarding materials for qualified human review; removed candidate ranking, employment decisions and HR-system authority. |
| Product | `product-management/skills/write-spec`, `product-management/skills/roadmap-update` | Removed invented demand, capacity and scoring assumptions; produces a source-grounded brief with unknowns and no project-system changes. |
| Design | `design/skills/design-critique`, `design/skills/accessibility-review` | Requires visible evidence for visual findings; separates observable issues from checks requiring testing and makes no accessibility certification or design-system changes. |
| Engineering | `engineering/skills/documentation`, `engineering/skills/incident-response`, `engineering/skills/deploy-checklist` | Separates evidence, hypotheses and proposed verification; removes shell, repository, monitoring and deployment authority. |
| Data | `data/skills/analyze`, `data/skills/explore-data`, `data/skills/validate-data` | Reframed around bounded deterministic file statistics and cited limitations; removes notebook, warehouse, query and connector execution. |

The per-candidate manifests identify the exact received `SKILL.md` paths and governing license
evidence. The source inventory verifier checks the additional snapshots alongside the original
six-pack inventory. No upstream connector configuration or executable plugin code is included.

### Note on the upstream root `LICENSE` file

The repository's root `LICENSE` at the pinned commit contains approximately 249 bytes of unrelated
text appended after the end of the Apache-2.0 appendix. It is preserved verbatim in the snapshot
(`source-snapshot/LICENSE`) because a snapshot corrected on the way in can no longer be diffed
against upstream. The Apache-2.0 text above those trailing lines is complete and unmodified, and the
copy redistributed here (`third_party/knowledge-work-plugins/LICENSE`) is the clean per-plugin
Apache-2.0 text shipped in the same repository at `marketing/LICENSE` and `sales/LICENSE`, which are
byte-identical to each other. This is recorded in `manifest.json` under `license.rootLicenseAnomaly`.

### Verifying

```
node scripts/verify-knowledge-work-provenance.mjs --check-source
```

Offline and read-only: it fetches nothing, publishes nothing, and activates nothing.
