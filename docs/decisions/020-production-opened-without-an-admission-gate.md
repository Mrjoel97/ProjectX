# ADR-020: Production opened without an admission gate — signup is OPEN, knowingly

- **Status**: Accepted
- **Recorded**: 2026-08-15, at the moment of the first real production deploy
  (`deploy-production` run `31854161028`, off `9eada53` / PR #17).
- **Requirements**: BETA-01 (invite/waitlist) — **not met, and deliberately not blocking**
- **Phases**: 25 (Private Beta Productionization), which owns BETA-01 and is unexecuted
- **Relates to**: `docs/playbooks/cockpit.md` (the deployed surface),
  `packages/backend/convex/lib/functions.ts` (`requireScope` — the chokepoint named below)

## Context

`https://www.pikar-ai.com` is live and serving the full platform. There is **no admission
control of any kind**: no invite module in `packages/backend/convex/`, no invites or waitlist
table in `schema.ts`, no beta-admission playbook. Anyone who reaches the domain can sign in
with Google and receive a working tenant.

That tenant is not inert. It can drive the cockpit agent, which spends against the **owner's
single `OPENAI_API_KEY`** held in the production Convex deployment. There is no per-tenant
spend cap standing between an anonymous signup and that key — the budget rails are global,
not per-tenant.

The owner was shown this twice, in these terms, and chose to deploy anyway and then to leave
the door open rather than close it first. **This ADR exists so that decision is a recorded,
deliberate one rather than an oversight someone discovers later from a bill.**

## Decision

**Ship and stay open.** BETA-01 is knowingly unmet in production. No gate, no waitlist, no
invite codes, no domain lock, no Vercel password. The exposure is accepted for now.

## The chokepoint, recorded so it is not re-derived

The gate, when it is built, does **not** go where the roadmap language implies. There is no
tenant-creation event to guard:

```ts
// packages/backend/convex/lib/functions.ts
async function requireScope(ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { userId, tenantId: String(userId) };   // the tenant IS the auth user id
}
```

A tenant exists implicitly the instant Convex Auth writes a `users` row on first Google
sign-in. Consequences for whoever implements BETA-01:

- **`requireScope` is the one shared chokepoint.** `tenantQuery`, `tenantMutation` and
  `tenantAction` are all built on it, so a single guard there covers every caller. A
  per-endpoint check would be the same fix repeated N times, with N chances to miss one.
- **`requireOwner` already exists** (GOVN-01, same file) and reads `users.owner === true`.
  Any gate must let the owner through on that flag, or the owner locks themselves out of the
  surface that issues invites.
- **A `requireScope` guard does NOT prevent an orphaned `users` row.** Convex Auth writes it
  before any app code runs, so an uninvited person can sign in and then do nothing. Phase 25's
  SC#1 asks for stricter — "blocked at the door with NO orphaned tenant persisted" — which
  needs a `@convex-dev/auth@0.0.94` user-creation callback, not an app-layer check. Decide
  which of the two is actually wanted before building; they are different features.
- **Existing tenants must keep working.** The owner's own tenant predates any gate, so the
  allowed-marker has to default-allow existing rows or be backfilled, or the deploy that adds
  the gate locks out the only real user.

## Alternatives rejected

| Option | Why rejected |
| --- | --- |
| Close it first, deploy after | Owner chose to deploy; the calendar work was ready and the pipeline was green. |
| One guard in `requireScope` now, invite codes later | Offered as the ~1-hour fix. Owner chose to leave it open for now. |
| Take the site down / Vercel password until gated | Offered. Owner chose to stay live. |

## Consequences

- **Accepted:** anonymous signups can consume the owner's LLM budget. The blast radius is the
  API key's spend, not tenant data — cross-tenant isolation is enforced independently by
  `requireScope` and is NOT what this ADR relaxes. A stranger gets their own empty tenant, not
  anyone else's data.
- **Monitoring is the compensating control, and it is manual.** Nothing alerts on signup
  volume or spend. Watch the OpenAI dashboard and the `users` table; there is no automated
  tripwire, so "we would notice" currently means "someone looks".
- **This ADR is superseded the moment a gate ships.** Do not edit it — write the successor ADR
  and flip this Status line to Superseded, per `docs/README.md`.
- **If the exposure is ever realized** (a spend spike, unexpected signups), the fastest lever is
  not the gate — it is rotating `OPENAI_API_KEY` in the production Convex deployment, which
  halts all agent spend instantly and buys time to build the gate properly.
