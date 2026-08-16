# ADR-022: The beta domain posture — durable, not custom, and already in force

- **Status**: **Proposed** — awaiting owner acceptance (25-10 Task 2 is a blocking checkpoint)
- **Recorded**: 2026-08-17, during Phase 25 execution
- **Requirements**: BETA-01, DLVR-02 (both depend on stable user-shareable origins)
- **Phases**: 25 (Private Beta Productionization)
- **Relates to**: **ADR-020** (production opened without an admission gate) — this ADR does not
  supersede it; it records the origin half of the posture ADR-020 left implicit.
  `.github/workflows/deploy-production.yml`, `packages/backend/convex/lib/env.ts`
  (`isDurableOrigin`), `docs/playbooks/production-beta.md`

> **Numbering note.** 25-10's plan text names this ADR `017-beta-domain-posture.md`. **017 is
> already taken** by `017-direct-wan-visuals-openai-audio.md`, Status Accepted. ADRs are immutable
> and never edited after acceptance (CLAUDE.md §9), so two files numbered 017 would be a permanent
> collision. This is 022, the next free number.

## Context

25-10 Task 2 poses a binary: **(A)** durable app/API/HTTP-action hostnames with DNS/TLS and stable
OAuth/unsubscribe origins, or **(B)** no user-shareable URL ships until those exist, which the plan
records as a phase blocker.

**That framing is stale, and the 25-00 baseline measured why.** Branch B is not "decline to ship".
`https://www.pikar-ai.com` has been live and serving the full platform since 2026-08-15
(ADR-020, `deploy-production` run `31854161028`, off `9eada53`). **Choosing B today means taking
down an already-promoted production deployment**, which is a materially different act from
withholding a launch, and nothing in Phase 25 justifies it.

Two further measured facts bear on the decision:

1. **`CONVEX_SITE_URL` is not ours to set.** It is the Convex deployment's own site origin. It is
   read with no fallback at `auth.config.ts:5` (Convex Auth derives issuer, JWKS and every OAuth
   callback base from it) and with `?? ""` at `contacts.ts:679`, where the unsubscribe link fails
   **closed** when it is empty. The release pipeline sets `SITE_URL` and `MEDIA_RENDER_URL` and
   deliberately never touches it. Changing that origin is a Convex domain-configuration action, not
   an environment variable this repo controls.
2. **The plan's must-have says durable *custom* origins.** The Convex HTTP-action origin is
   `*.convex.site`. It is durable — stable across deployments, DNS-resolvable, TLS-terminated — but
   it is not custom. **A literal reading of "custom" therefore forces Branch B over a non-problem**,
   blocking the phase on a hostname property that nothing actually requires.

## Decision

**Branch A, with "durable" as the requirement and "custom" explicitly dropped.**

An origin qualifies when it is **stable across deployments and resolvable by a third party** —
which is what an unsubscribe link in a two-year-old email and an OAuth redirect registered with a
provider both actually need. It does not have to be a vanity hostname.

Concretely:

| Origin | Value | Who sets it |
| --- | --- | --- |
| App | `https://www.pikar-ai.com` | `vars.PRODUCTION_URL` → pipeline writes `SITE_URL`, with a read-back assertion |
| HTTP actions / auth issuer | the deployment's `*.convex.site` | Convex, by domain configuration |
| Gmail redirect | `GMAIL_OAUTH_REDIRECT_URI` | operator, registered with Google |
| Microsoft redirect | `MICROSOFT_CALENDAR_REDIRECT_URI` | operator, registered with Microsoft |

**What is rejected**, and enforced by `isDurableOrigin()`: plain `http`, `localhost` / `127.0.0.1` /
`*.local`, and per-build Vercel preview hosts (`*-<hash>.vercel.app`). Each stops resolving —
immediately for localhost, on the next push for a preview build — and an unsubscribe link or an
OAuth callback pinned to one is dead the moment the deployment is superseded.

## Consequences

- **Phase 25 is not blocked on a domain purchase.** `www.pikar-ai.com` already satisfies the app
  half and `*.convex.site` already satisfies the HTTP-action half.
- **A custom HTTP-action domain remains available later** and needs no ADR to adopt — it is a
  Convex configuration change, and `isDurableOrigin` already accepts it.
- **The enforcement is narrow on purpose.** It validates the values this repo controls and makes a
  read-only assertion that `CONVEX_SITE_URL` is a non-empty https origin. It cannot and does not
  validate DNS, TLS chains, or that a provider's registered redirect matches — those are observed
  at the live gates (25-11/25-12), not asserted here.
- **This ADR does not reopen ADR-020.** The admission gate is BETA-01's, built in 25-01/25-02 and
  unshipped until the release in 25-11. The open-signup exposure ADR-020 records stands until then.

## Alternatives considered

- **Branch B (block the phase).** Rejected: it means taking down a live promoted deployment, and no
  Phase 25 requirement asks for that. Recorded as an available action, not a default.
- **Require a custom `*.pikar-ai.com` HTTP-action domain now.** Rejected as scope with no consumer:
  nothing in BETA-01 or DLVR-02 distinguishes a custom HTTP origin from a durable one, and it would
  gate the beta on DNS work.
- **Validate DNS/TLS in `isDurableOrigin`.** Rejected: a pure function cannot, and a network probe
  inside a readiness query would make the owner screen fail on transient DNS.
