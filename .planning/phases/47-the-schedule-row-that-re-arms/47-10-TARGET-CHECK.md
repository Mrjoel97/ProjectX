# 47-10 production target and DST probe checkpoint

Checked 2026-09-24, 17:34–17:50 UTC. This is a **read-only target check**, not a `dst-boundary` live artifact or ROUT-02 pass.

## Target identity and command class

- Target: production Convex deployment selected by the root `.env` entry named `Convex_Production_deploy_key`. Only the deployment token was compared; its SHA-256 is `9067eabf7231a8e473de213cd304fa2fe52ec444e752e5ee9947cb0d29cbd055`. No deploy key or secret is recorded here.
- The token matched independent production identifiers in `.planning/audits/2026-09-10-live-acceptance-continuation.md` (release boundary) and `.planning/phases/20-media-canvas/20-20-SUMMARY.md` (earlier production read), among ten documentation hits. The root `.env.local` target was not substituted for production.
- The earlier `dst-boundary --deployment prod` collector attempt returned `UNREACHABLE` and wrote no artifact because this shell lacked a valid linked deployment. This is historical diagnostic evidence, not evidence of absent jobs. A first key-scoped CLI attempt also combined `--deployment` with `CONVEX_DEPLOY_KEY`; the CLI does not allow that combination. The corrected reads supplied only the production-scoped key as a process-local environment variable, removed it in `finally`, and used `convex run --inline-query` without `--deployment`. No environment file or deployment setting changed.
- Both corrected commands exited 0. Their inline queries only projected audit phase, zone, correlation, timestamp and fire instant, or scheduled-job ID/time/state. No customer payload, outbound message, write, re-arm, or paid model call was involved.

## Bounded production observation

The first query used `audit.by_tenant_event_ts` for sentinel tenant `dst-probe:unattributed` and event `clock.dst_probe`, newest 16 rows. It returned **four `armed` rows and zero `fired` rows**. The second query scanned eight `_scheduled_functions` rows (cap 800), matched the exact four armed fire instants, and returned **four `pending` jobs**; the scan did not hit its cap.

| Zone | Audit correlation | Exact scheduled UTC fire | Scheduled-job ID | Fresh state |
| --- | --- | --- | --- | --- |
| Pacific/Auckland | `dst-probe:Pacific/Auckland:1790434816712` | `2026-09-26T15:00:16.712Z` | `kc2820tv5xxdnt4e5njend2xn98e3qqz` | `pending` |
| Australia/Lord_Howe | `dst-probe:Australia/Lord_Howe:1791045016712` | `2026-10-03T16:30:16.712Z` | `kc2d42w5qr8cfg6hp63ra5y5fd8e2v6h` | `pending` |
| Europe/Berlin | `dst-probe:Europe/Berlin:1792893630774` | `2026-10-25T02:00:30.774Z` | `kc28mepayg2tvhyb3cjzp0syc98e2x4z` | `pending` |
| America/New_York | `dst-probe:America/New_York:1793516402649` | `2026-11-01T07:00:02.649Z` | `kc2abvahcp6z876hwcr0kahf418e36r2` | `pending` |

These observations refresh the 2026-09-09 historical arming record in `docs/playbooks/knowledge-search-routines.md`. All fire instants were in the future at this checkpoint. The audit pair, not the short-retention scheduler row, must later prove each live crossing. Preserve `convex/dstProbe.ts` and its `arm`/`observe` export names through the New York fire; do not repeat any arming.

## Collector production preflight (2026-09-24, before 18:16 UTC)

With that same fingerprint-verified production deployment key supplied only to the collector process, `dst-boundary --deployment prod` reached `audit:recentByType` and returned an expected refusal: Pacific/Auckland had **one armed row and no completed fired trace**. Exit code was 1; the collector wrote no artifact and made no state change. This closes the earlier collector-specific `UNREACHABLE` diagnosis without upgrading ROUT-02 to pass. The already-scheduled Auckland fire remains 2026-09-26T15:00:16.712Z.

That live refusal exposed contradictory operator guidance: it offered `dstProbe:arm` even while reporting an armed row. The collector now offers an arming command only when it sees no arm, and its offline self-check asserts that an armed-but-waiting refusal never invites a duplicate arm. Do not re-arm any of the four existing probes.

The offline follow-up also corrected the unarmed command's target calculation. Calendar-day noon UTC would have preceded Auckland's 2026-09-26 14:00Z offset change; the collector now bisects the first changed daily interval and chooses one hour after the actual change. An armed row whose scheduled instant has elapsed without a fired row now reports that distinct unobserved state instead of saying the transition has not arrived. These are collector refusal/guide changes only; no production probe was re-armed or run, and the live ROUT-02 artifact remains absent.

At 2026-09-24 18:33 UTC, the revised collector made a second key-scoped, read-only production preflight. It returned exit 1, wrote nothing, and named exactly **one** Auckland armed row with next scheduled fire `2026-09-26T15:00:16.712Z`, explicitly saying not to re-arm. This validates the revised production refusal path, not the future scheduler execution.

## Separate verification and boundary

- `node packages/backend/scripts/collect-recurrence-evidence.mjs --self-check`: exit **0**, offline false-observation/refusal checks passed. This does not certify a live fire.
- `node packages/backend/scripts/check-routine-gate.mjs .planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md --validate-decision`: exit **0**, decision remains `defer`.
- Next observation: after Auckland's actual UTC fire, verify the target again and read the paired `armed`/`fired` audit rows before allowing the collector to write its zone-specific artifact. The other three zones remain separate later checkpoints. No recurrence table, ADR supersession, external send, or `enable-safe` decision follows from this target check.
