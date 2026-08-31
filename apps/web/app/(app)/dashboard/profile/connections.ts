// The integrations that cannot connect yet, and WHY. A row that cannot say why is decoration —
// see docs/superpowers/specs/2026-08-02-connections-tab-design.md §3.1.
//
// Plain data: no JSX, no "use client", nothing else in the file. That is deliberate — it lets the
// completeness check in packages/core/src/connectionsSurface.test.ts match on `label:`/`blocker:`
// without colliding with anything, and it keeps this list readable as a list.

export type BlockedConnection = {
  readonly id: string;
  readonly label: string;
  readonly blocker: string;
};

export const BLOCKED: readonly BlockedConnection[] = [
  {
    id: "social",
    // ponytail: hardcoded fact as of 2026-08-02. Clears when the legal entity exists — that ONE
    // step unblocks LinkedIn MDP, Meta Business Verification and Google OAuth verification at once.
    label: "Social accounts",
    blocker:
      "Blocked on business-entity verification. LinkedIn, Meta and Google each require a registered legal entity as data controller before granting posting access.",
  },
  {
    id: "databases",
    // ponytail: connector storage now exists, but capability is still adapter- and gate-owned.
    // Generic pasted URLs/keys would bypass the per-provider review, isolation and revoke contract.
    label: "Other databases & CRMs",
    blocker:
      "Each connection needs a reviewed adapter with tenant isolation, bounded reads and an evidence-backed provider gate. Generic API keys and database URLs are not accepted.",
  },
  {
    id: "apps",
    // ponytail: clears only via a code-owned adapter. ADR-007 — a specialist's tool-set is never
    // DB-writable, so "install an app" can never mean "add a tool at runtime".
    label: "Third-party apps",
    blocker:
      "Capability is code-owned (ADR-007). Each integration ships as a reviewed adapter rather than something added at runtime.",
  },
];
