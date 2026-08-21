# Phase 17 Calendar Actions — agent-operated live UAT runbook

**Requirement:** ACTN-02. **Operator:** the execution agent. **Owner involvement:** delegated OAuth
consent, one native-calendar edit per provider, and the final visual confirmation only. The owner is
never asked to run a terminal command, edit a database row, copy a token, or inspect provider prose.

This runbook gathers the remaining live evidence for Google and Microsoft availability/create/update,
Google delete, and Microsoft's explicit delete refusal. It does not weaken the shipped Google create
contract. Microsoft delete remains unsupported because Graph ignored stale `If-Match` in the measured
probe; cleanup of the Microsoft test event is therefore a separately recorded native action.

## Evidence artifact contract

The agent creates `.planning/phases/17-calendar-actions/17-LIVE-EVIDENCE.json` with schema
`phase17-calendar-live-evidence.v1` and these exact root keys:

```text
schema, deploymentUrlHash, capturedAt, preflight, creates, conflicts,
updates, deletes, cleanup, reconciliation
```

Every lifecycle row is generated from `smoke.calendarLifecycleReadback`; prose markers, screenshots,
and `rg` hits never satisfy a machine row. The artifact is refs/codes/counts/booleans only. It must
not contain event title, subject, body, description, attendees, email, raw provider response, token,
refresh token, access token, or scope value.

For each applicable provider section record:

- provider, plan id, calendar run/correlation id, registry id, external event id;
- staged/provider/created/updated/deleted etags and their transitions;
- exact audit names, payload-key sets, and counts;
- provider/registry duplicate counts and replay result;
- conflict, cleanup, content-leak, and token-leak booleans.

`preflight` records only commit/build/deployment hashes, env/callback presence booleans, safe provider
connection/account hashes, migration counts, H3 counts, and Graph-probe refs/statuses. `reconciliation`
records the owner's approval timestamp plus final zero-residue counts and leak booleans.

## Stop rules

- No provider write before a visible card and the owner's **Approve** action.
- No attendee-bearing live proof. Attendee refusal stays offline; no invite or notification is sent.
- A missing historical H3 row, incomplete migration, Graph PATCH-probe mismatch, duplicate, leak, stale
  overwrite, or unexplained residue leaves ACTN-02 pending.
- Never broaden a timeout, use an unconditional update/delete, call a provider cancellation endpoint,
  or treat native Microsoft cleanup as a governed product delete.
- Do not edit ROADMAP, REQUIREMENTS, or VERIFICATION until final reconciliation and owner approval pass.

## 1. Agent preflight — zero provider writes

The agent performs all repository, build, server, deployment, and query work:

1. Resolve the deployed commit, fresh web build timestamp, Convex deployment hash, and app URL.
2. Confirm Google and Microsoft OAuth client/secret env names are present using booleans only. Confirm
   callbacks return to the current app and both connection pages load.
3. Confirm fixture absence so provider availability cannot false-pass through offline data.
4. Run the Plan-10 offline gates once: core Calendar tests, the 90-second backend matrix,
   typechecks/build/playbooks, and record exact counts/durations.
5. Before reconnecting Google, exercise H3 against the real pre-widening stored grant. Require
   `reconnectRequired=true`, `providerFetchCount=0`, `providerEventDelta=0`, and zero success audits.
   If that historical state no longer exists, stop; do not synthesize it by editing the database.
6. Run the legacy `calendarEvents` migration dry-run, then bounded apply pages of at most 100 until
   `done=true`. Require `pending=0` before any manageable-event listing.
7. Validate the committed Graph probe independently of its collapsed `supported` field. Require
   `stalePatchStatus=412`, `stalePatchPreserved=true`, `cleanupMissing=true`, and current deployment
   and account hashes. A mismatch blocks Microsoft update; it never enables Graph delete.
8. Initialize all exact JSON root keys and validate the refs-only/forbidden-key contract.

Preflight must leave provider event counts unchanged.

## 2. Owner checkpoint A — delegated consent only

The agent opens the prepared Google and Microsoft connection pages. The owner selects the designated
disposable accounts, reviews delegated permissions, clicks consent, and returns to Connections. The
agent then reads connected booleans and account hashes without capturing tokens, raw scopes, or email
addresses. If either provider is not connected, stop with that provider named.

## 3. Availability and approved create — both providers

For Google and Microsoft separately, the agent:

1. obtains a known private busy interval in the disposable calendar, with owner authorization;
2. asks the cockpit for that provider's availability and compares returned ranges to the provider;
3. proves no title, description, attendee, or address crosses the response/audit boundary;
4. stages one uniquely identifiable timed, attendee-free event;
5. captures provider-specific trace and card, then proves the provider event is absent;
6. waits for the owner to click **Approve**;
7. attempts the same approval again and reads back the lifecycle.

Required machine results for `creates.google` and `creates.microsoft`:

- pre-Approve provider count 0, post-Approve count 1;
- one plan/run/registry/external-event chain with a nonempty created etag;
- `duplicateProviderCount=0` and `duplicateRegistryCount=0` after the repeat;
- exact created-audit name/key set/count and no DLQ success-path row;
- `contentLeak=false` and `tokenLeak=false` recursively.

The owner should see a provider-accurate card and no email recipient/subject chrome. No provider request
may occur between staging and Approve.

## 4. Stage updates, then owner checkpoint B — make both etags stale

The agent lists only migrated manageable rows, inspects each provider event, and stages one update/move
proposal per provider. It records the exact staged etag and verifies the card's current/proposed states.

The owner opens each exact event in its native Calendar UI, moves it by five minutes, saves, and returns
without touching Pikar. The agent requires a nonempty provider etag different from the staged etag for
both providers. It must not silently restage or refresh the approved proposal.

## 5. Conflict refusal, fresh restage, and approved updates

For each now-stale Google/Microsoft plan, the owner clicks Approve. The agent requires:

- `failureCode="conflict"` / provider 412 evidence;
- the out-of-band provider edit is preserved and no stale overwrite occurs;
- registry state is unchanged, success-audit count is zero, and no provider prose leaks.

The agent then re-inspects, stages a fresh proposal, shows the fresh card, and waits for Approve. The
successful readback must bind the new provider etag to the registry etag, show exactly one update
success audit with the exact allowed key set, and show no duplicate audit/write on replay.

## 6. Delete semantics and cleanup

### Google governed delete

The agent stages delete/cancel language for the Google event, shows the destructive card, and waits for
Approve. It then repeats the operation. `deletes.google` must show provider absence, registry status
`deleted`, exactly one deletion audit, `replaySuccess=true`, zero duplicates, and no content/token leak.

### Microsoft explicit refusal and native cleanup

The agent requests Microsoft cancel/delete and requires `provider_unsupported` before token fetch or
provider write. The copy must say the event is still on Microsoft Calendar. Evidence records:

- provider fetch count 0 and provider event still present after refusal;
- registry status still `active` and deletion-success audit count 0;
- no hidden Graph DELETE or `/cancel` call.

With owner authorization, the agent removes the Microsoft test event directly in the native provider
session. Record this only as external cleanup: provider absent, registry still active at the last
governed state, and still zero product deletion-success audits.

The agent removes busy blocks and all other residue, scans audit/DLQ/notification/log planes for
forbidden content/token keys, and populates `cleanup` with zero provider-event, test-plan, and
test-notification residue counts.

## 7. Owner checkpoint C — final visual check

The owner opens Google Calendar and Microsoft Calendar and confirms:

1. the two Pikar test events and known busy blocks are gone;
2. provider-visible times/counts matched the staged cards during the run;
3. no attendee was invited or notified.

The owner replies `approved` or names the mismatched provider/evidence row. No terminal work is asked
of the owner.

## 8. Final machine reconciliation

Only after owner approval, the agent re-runs exact `calendarLifecycleReadback` calls for both providers
and fills `reconciliation` with `ownerApproved`, `approvedAt`, `lifecycleEvidenceConsistent`, final
zero-residue counts, and false leak booleans. The Microsoft final state must show provider absent,
registry active, and no product delete audit after native cleanup.

The agent recursively rejects keys `title, subject, body, description, attendees, email, accessToken,
refreshToken, scope, rawResponse` and any token-prefixed key except boolean `tokenLeak`. Only a fully
green artifact may be cited into VERIFICATION, REQUIREMENTS, ROADMAP, and the Calendar playbooks.

## Evidence checklist carried into Plan 17-11

| Gate | Google | Microsoft |
|---|---|---|
| OAuth env/callback/account hash | pending live | pending live |
| H3 pre-widening zero-fetch negative | pending live | n/a |
| Legacy migration complete before listing | pending live | pending live |
| Availability exact ranges/content absence | pending live | pending live |
| Stage/card/Approve create; duplicate no-op | pending live | pending live |
| Owner stale-etag edit and 412 refusal | pending live | pending live |
| Fresh restage and approved update | pending live | pending live |
| Approved delete/replay | pending live | explicit unsupported refusal |
| Final native cleanup and owner visual check | pending live | pending live; native-cleanup divergence recorded |

Offline attendee-bearing refusal remains proven by the focused mutation-tested suite and is deliberately
not repeated against a live attendee.
