# ADR-058 — Buffer MCP as an optional social marketing provider

- **Status:** Accepted implementation direction under the owner's explicit Buffer integration request; hosted release acceptance pending.
- **Date:** 2026-10-19
- **Extends:** ADR-015's marketing surface with the owner-authorized Buffer path. Existing direct-social provider gates remain in force.

## Context

The owner requested that Pikar users authorize Buffer to access their connected social accounts, prepare campaigns, schedule approved posts and report engagement while direct social integrations are developed. Buffer's ordinary OAuth App Client documentation limits analytics, but its first-party MCP OAuth server advertises insights access. A separately consented read-only public-client PKCE probe successfully returned actual aggregate engagement metrics. That is evidence of this specific flow, not blanket permission or complete plan coverage.

## Decision

Use Buffer's first-party MCP endpoint with per-user public-client OAuth, dynamic registration and PKCE. Keep connection state separate from the existing four revenue-provider contracts; reuse their credential envelope with tenant/connection/provider binding. Activate a callback only through a one-use receipt redeemed by the initiating authenticated Pikar tenant.

Users explicitly select organization/channels and opt into daily reads. Reuse the executive runtime for channel/engagement reads and local campaign draft preparation. Keep publishing outside model tools: an authenticated human approves exact content, media, channel and timing. Claim each outbound write once; uncertain outcomes require manual checking, with no automatic retry. Buffer owns queue timing. Credential refresh is leased and revision-checked so rotating tokens cannot be replayed or restore a disconnected connection.

Classify credentials for summary-only export and all four Buffer tables for erasure. Explain local-only disconnect and manual upstream revocation. Existing direct-provider connections and their suitability/legal gates are not cleared by this decision.

## Alternatives and consequences

A personal API key can access analytics but is not the requested user OAuth experience. Ordinary App Client OAuth alone lacks the tested MCP insights path. Building every direct social integration now delays the requested workflow and is unnecessary for this optional provider.

This adds a provider dependency, encrypted refresh lifecycle and explicitly approved write surface. Initial reporting is rolling thirty-day aggregates with provider freshness; missing fields stay unavailable. Single-image/video posts are supported; advanced formats and comment management are deferred. The live read-only probe does not establish commercial embedding rights, all channel/plan coverage, production callback acceptance, token rotation or safe write acceptance. Those remain explicit hosted release checks described in the Buffer playbook.
