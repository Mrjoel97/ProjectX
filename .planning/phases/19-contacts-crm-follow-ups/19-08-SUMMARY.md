---
phase: 19-contacts-crm-follow-ups
plan: 08
subsystem: cockpit
tags: [cockpit-tool, contacts-first, plan-gate, registration-surfaces, smoke-op, mutation-proven, actn-05]
requires:
  - "19-02: the contacts/followUps person store this READS in-loop"
  - "19-06: crm_write, patchPlan's crmOperations arg, and parseCrmOperations at both boundaries"
  - "19-07: the Pipeline page that renders what an approved crm_write plan writes"
provides:
  - "contacts-first precedence inside the EXISTING resolveContacts — saved record beats a Gmail-header inference"
  - "internal.contacts.savedForName — the module's first COCKPIT read, a name lookup + that contact's open follow-ups, with no write in it"
  - "stageCrmWrite — ONE tool carrying a LIST, staging a crm_write plan and applying nothing"
  - "the agentSteps.tool literal + cards.tsx VERB entry, both mutation-proven red-able"
  - "SMOKE::agent::crm=<email>[:<note>] — the fifteenth offline op, $0, no model call, no smoke.ts change"
affects:
  - "docs/playbooks/cockpit.md, contacts-crm.md (invariant 16), agent-runtime.md"
  - "packages/backend/convex/runCockpitAgent.test.ts (NOT on the plan's file list — the wipe-on-pick assertion the plan asked to EXTEND lives there)"
  - "19-09 (owns the cockpit-agent body edit that makes this tool visible to the model at all, plus the eval fixture)"
  - "19-10 (UAT: the CRM card, and the trace verb no human has seen)"
tech-stack:
  added: []
  patterns:
    - "ONE ranker over two data planes, so a saved record and a header inference cannot disagree about who a name means"
    - "prove an ORDERING by counting the rows the skipped path would have written, never by reading the reply"
    - "a refusal is a RETURNED SENTENCE; every governed-loop tool exit is a string the model can say"
    - "narrow the WRITE boundary below the data contract: the union carries four ops, the agent may stage two"
    - "hardcode provenance server-side rather than accepting it as a model input"
key-files:
  created: []
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/contacts.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/cockpitTools.test.ts
    - packages/backend/convex/contacts.test.ts
    - packages/backend/convex/runCockpitAgent.test.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - docs/playbooks/cockpit.md
    - docs/playbooks/contacts-crm.md
    - docs/playbooks/agent-runtime.md
decisions:
  - "THREE registration surfaces, exactly as the plan said — the first plan enumeration in this phase that was right. But the SMOKE op is FIVE sites, not the plan's four (the grammar comment is the fifth)."
  - "Tasks 1 and 2 are ONE commit. Task 1 adds the tool KEY; Task 2 adds its literal and VERB. Committing Task 1 alone would ship precisely the partially-registered state the plan exists to prevent."
  - "stageCrmWrite refuses completeFollowUp/cancelFollowUp even though CrmOperation carries them. Closing a follow-up is a judgement about work being finished, and the Pipeline page is where a human makes it. It also removes the need to hand the model row ids."
  - "The follow-up due date is the user's WORDS through parseSendTime against the trusted clientContext clock (the proposeCalendarEvent rule), never a model-supplied epoch. A fabricated date would render on an approvable card."
  - "`origin` is hardcoded `mailbox-resolved` server-side, not a model input — the same literal applyCrmOperations already uses when a follow-up upserts its contact."
  - "stageCrmWrite REFUSES over a half-composed email. A thread has ONE plan row, so patching kind/status onto a row with recipients/subject/body would turn a live draft into a CRM card and strand it. Not in the plan; a data-loss guard."
  - "No smoke.ts change and none needed: crm= seeds no fixture (unlike brief=) and makes no model call (unlike create=). The plan listed smoke.ts as a file to modify."
  - "The plan's 'nested SMOKE::route=direct_llm:: prefix required to keep a turn offline' is FALSE for this op and the playbook says so with the reason, rather than carrying a prefix that would land inside the email address."
  - "Line endings measured AGAIN and they are MIXED per file: cockpit.md and contacts-crm.md are LF (0 CR), agent-runtime.md is CRLF (852/852). Both 19-07's 'the playbooks are LF' and the standing 'they are CRLF' note are half-wrong."
metrics:
  duration: ~1h 15min
  tasks: 3
  files: 10
  completed: 2026-08-09
---

# Phase 19 Plan 08: Contacts-first resolution and the CRM staging tool Summary

The cockpit now READS the person store in-loop and STAGES its writes through the plan gate. A saved
contact beats a Gmail-header match and brings its open follow-ups with it; `stageCrmWrite` proposes a
`crm_write` plan and applies nothing; the tool key, its schema literal and its VERB entry landed in
one commit with **both** registration guards observed going red.

## What shipped

### Task 1 — contacts-first + the one staging tool (`b982c68` RED, `c9b42eb` GREEN)

**RED was real:** 10 of 101 `cockpitTools.test.ts` tests failed before any implementation existed
(`unknown cockpit tool: stageCrmWrite`, `expected null to deeply equal { kind: 'crm' … }`, and the
row-count assertions), and they were committed red.

**`resolveContacts` checks `contacts` first.** Not a second tool — a second resolution tool would be
a second registration surface for one job. The saved lookup is `internal.contacts.savedForName`, an
`internalQuery` taking `tenantId` explicitly (the tool plane has no auth identity). On a hit it parks
the saved rows as candidates on the same content plane the header path uses, so the ResolutionCard,
the pick and the wipe are all byte-unchanged downstream; on a miss it falls through to
`internal.gmail.search` unchanged.

Both planes rank with the SAME `rankCandidates` from `@pikar/core`, fed saved rows shaped as header
records (`"Name <addr>"`, or the bare address for a nameless contact). One definition of "does this
name mean this person" — two would let the saved plane and the header plane disagree about who Sarah
is. The `SMOKE::` sentinel strip was hoisted above both planes for the same reason.

A hit returns that contact's **OPEN** follow-ups in the same call, so "what do I owe them?" costs no
second tool call. Each note goes through `scanText` first: a note is prose that could hold an
address, and this tool's contract is that no address reaches the model (§2-D).

**`stageCrmWrite`** takes an operations array, runs `parseCrmOperations` at the **write** boundary
(19-06's note — idempotent over its own output, so the plan row stores NORMALIZED addresses the
applier never re-derives), and patches `kind: "crm_write"`, `status: "proposed"`, `crmOperations`.
It applies nothing. Four narrowings, all deliberate and all documented in `cockpit.md`:

| Narrowing | Why |
|---|---|
| ADD only — `completeFollowUp`/`cancelFollowUp` refused | closing a follow-up is a human judgement, made on the Pipeline page. Also removes any need to hand the model row ids. |
| `due` is the user's WORDS through `parseSendTime` + `clientContext` | §2-D. A model-supplied epoch is a fabricated date on an approvable card. No clock ⇒ refusal. |
| `origin` hardcoded `mailbox-resolved` | provenance is not a model input; the same literal `applyCrmOperations` uses. |
| refuses over a half-composed email | a thread has ONE plan row; patching `kind` onto a drafted row turns it into a CRM card and strands the draft. |

`CrmOperation`'s required `email` on `addFollowUp` was **not** relaxed. Every refusal — draft in
progress, add-only, no clock, empty list, unparseable list, contactless or undated follow-up — is a
RETURNED SENTENCE, never a throw out of the governed loop (18-06's rule).

### Task 2 — the three registration surfaces (same commit, `c9b42eb`)

`llm.ts`'s tool key, `schema.ts`'s `agentSteps.tool` literal and `cards.tsx`'s VERB entry
(`["Preparing a records update…", "Records update ready to approve"]` — the done state must not read
"Saved", because the write happens on Approve). Neither scan needed extending: both derive their sets
from source, so the new key was covered on arrival.

### Task 3 — the offline SMOKE op and three playbooks (`c3cf060`)

`SMOKE::agent::crm=<email>[:<note>]`, registered at all five `llm.ts` sites. It drives
`stageCrmWrite` with a deterministic list — the contact, plus its follow-up due `tomorrow` when a
note is given, which resolves to `2020-01-02T09:00Z` because the SMOKE path pins the clock. `$0`,
no model call, `agentSteps` reads `["stageCrmWrite"]`, zero `contacts` rows written.

## The enumerations, independently checked

**Registration surfaces for `stageCrmWrite`: THREE. The plan was right** — the first enumeration in
this phase that was (19-05 said one `gmail.send` caller and there were two; 19-06 said eleven sites
and there were fourteen). Verified by `graphify query` plus grep over `buildCockpitTools`'s key
record, the `agentSteps.tool` union and the `VERB` record, and by both parity scans passing on
arrival.

**SMOKE sites: FIVE, not the plan's four.** All in `llm.ts`: the grammar comment (`:3436`), the
`AgentSmokeOp` union arm, the `parseAgentSmoke` case, the `SMOKE_OP_TOOL` record, and the
`runAgentSmokeOp` case. The union and the two switches are compile-forced; the comment is not, which
is the one a hurried author drops. Recorded in `agent-runtime.md`.

## The mutation checks — all three observed RED, with the text

| Mutation | Result |
|---|---|
| delete `v.literal("stageCrmWrite")` from `schema.ts` | `cockpitTools.test.ts` RED: **`AssertionError: expected [ 'stageCrmWrite' ] to deeply equal []`**. `traceParity.test.ts` ALSO RED on the orphan side: *"VERB keys that are not agentSteps.tool literals — dead entries that can never render… stageCrmWrite"*. **And `tsc` RED** — see below. Reverted. |
| delete the `stageCrmWrite` VERB entry from `cards.tsx` | `traceParity.test.ts` RED: **`agentSteps.tool literals with no VERB entry — their trace rows render the generic "Working…"/"Done" fallback. Add them to VERB in cards.tsx: stageCrmWrite`**. Reverted. |
| insert an unconditional `gmail.search` above the saved-contact branch (contacts-first ORDERING) | `cockpitTools.test.ts` RED: **`expected [ { …(8) } ] to have a length of +0 but got 1`** — the `mailbox.searched` audit row count. Reverted. |

**A guard nobody predicted, found by the first mutation.** Dropping the schema literal also fails
`tsc`: `convex/llm.ts(3788,3): error TS2322: Type '"stageCrmWrite"' is not assignable to type
'"thinking" | "resolveContacts" | …'`. `SMOKE_OP_TOOL` is `Record<AgentSmokeOp["kind"], StepTool>`
and `StepTool` derives from the schema union, so a SMOKE-registered tool is compile-protected as
well. This is strictly stronger than the 19-06 `crm_write` case (typecheck stayed green there) — but
it exists **only** for tools with a SMOKE op, and `agent-runtime.md` says so explicitly rather than
letting the next author generalise it into a false sense of safety.

The contacts-first ORDERING proof is the same shape as 19-04's inert-GET: `gmail.search` always
writes exactly one refs-only `mailbox.searched` audit row (SMOKE and live paths share the emitter),
so **zero rows means the mailbox was never touched**. A reply-string check would pass on a header
search that happened to return the same labels. The pair is non-vacuous in both directions: the
pre-existing `resolveContacts` test was extended to assert the count is **1** when nothing is saved.

## Verification

| Check | Result |
|---|---|
| `pnpm test` (full turbo) | **9/9 tasks** — backend **72 files / 1415 tests** (1405 → 1415, +10), web **122**, core **697**, all green, no fork crash |
| `pnpm typecheck` (full turbo) | **10/10, exit 0**, backend `tsc --noEmit` delta **0** vs the measured zero baseline |
| `pnpm --filter @pikar/web build` | green |
| `node scripts/check-playbooks.mjs` | exit 0 |
| verbatim-smoke-string assertion on `agent-runtime.md` | `ok` |
| `grep -n stageCrmWrite` across the three surfaces | hits in all three (`schema.ts:722`, `cards.tsx:1683`, `llm.ts:2314`) |
| codegen | **not needed and not run** — a new FUNCTION on an existing module leaves `_generated/` untouched (19-07 measured the same); `git status packages/backend/convex/_generated` is empty |
| `biome check` per touched file vs its `git show HEAD:` copy | **zero delta on all seven** (`llm.ts` 8 warnings both sides, `cockpitTools.test.ts` 3 errors/66 warnings both sides, the rest clean) — all pre-existing CRLF-format noise |
| `graphify update .` + `extract-convex-edges` | 14704 nodes / 16790 edges, +416 convex edges, +62 table edges |

Test deltas: `cockpitTools.test.ts` 91 → **101** (+10), `contacts.test.ts` 62 → 62 (the export-set
pin was widened, not added to), `runCockpitAgent.test.ts` unchanged in count (+2 assertions inside an
existing test).

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — missing critical functionality] `stageCrmWrite` would have hijacked a live email draft**
- **Found during:** Task 1, tracing what `patchPlan({kind, status})` does to the ONE plan row a
  thread has.
- **Issue:** the plan specified no draft guard. `stageResearchPlan`, `stageMediaPlan` and
  `stageImagePlan` all carry a `draft_in_progress` refusal for exactly this hazard; a CRM staging
  onto a row holding recipients/subject/body would have turned a half-composed email into a CRM card
  and stranded the user's work with no way back.
- **Fix:** the tool reads the plan and refuses with the same wording family, plus a test that the
  subject and recipients survive intact.
- **Commit:** `c9b42eb`

**2. [Rule 2 — missing critical functionality] the follow-up due date had no §2-D story**
- **Found during:** Task 1, designing the tool's input schema.
- **Issue:** `CrmOperation.addFollowUp` carries `dueAt` as epoch ms. Taking that straight from the
  model would be exactly the fabricated-instant failure `setSendTime` and `proposeCalendarEvent`
  exist to prevent — and unlike a send time it lands, dated, on a card the user approves.
- **Fix:** the tool's input takes `due` as the user's WORDS and resolves them through `parseSendTime`
  against the trusted `clientContext`, with `CALENDAR_HORIZON_MS` (a follow-up legitimately sits
  months out, unlike a send). Four named refusals for the non-resolved outcomes.
- **Commit:** `c9b42eb`

**3. [Rule 1 — bug] the resolveContacts tool description broke the §5 200-char literal ceiling**
- **Found during:** Task 1 verification. `skills.test.ts`'s inline-string scan went RED:
  `llm.ts: 224-char inline string`.
- **Fix:** split into three chunks, the idiom the file already uses. The scan is the guard working.
- **Commit:** `c9b42eb`

**4. [Rule 3 — blocking] a THIRD playbook had to be bumped**
- **Issue:** the plan names `cockpit.md` and `agent-runtime.md`. `contacts-crm.md` watches
  `packages/backend/convex/contacts.ts` + `contacts.test.ts`, both of which this plan modifies.
- **Fix:** invariant 16 — "resolution NEVER writes a contact row, and it is proven by COUNTING" —
  with the mutation that reddens it and an explicit *do not "warm the cache" by upserting what
  resolution found*.
- **Commit:** `c3cf060`

### Judgement calls recorded

**Tasks 1 and 2 are ONE commit.** Task 1 adds the tool KEY and Task 2 adds its schema literal and
VERB entry. Committing Task 1 alone would have shipped precisely the partially-registered state the
plan exists to prevent — and (per the new finding above) would not even have typechecked.

**`smoke.ts` was NOT modified, and needed nothing.** It is on the plan's file list. `crm=` seeds no
fixture (unlike `brief=`, which needs `smoke.seedInboxFixture`) and makes no model call (unlike
`create=`). `agent-runtime.md` was bumped anyway, because 19-09 and 19-10 need the verbatim strings.

**The plan's nested-prefix requirement is FALSE for this op.** The plan says the string must carry
`SMOKE::route=direct_llm::` "to keep a turn offline". That is `create=`'s constraint —
`createDocument` calls `draftDocument`, which fires `generateObject` for real without it.
`stageCrmWrite` calls no model, so the turn is offline the moment `parseAgentSmoke` matches; and a
prefix would land inside the email address and the op would refuse. `agent-runtime.md` records both
strings, the difference and the reason, which is also what satisfies the plan's grep.

**The wipe-on-pick assertion went into `runCockpitAgent.test.ts`, not the plan's file list.** The
plan says "extend the existing assertion rather than writing a parallel one" — the only existing
`resolveRecipients` test is there, and it had no candidates assertion at all. Two lines added to it;
no new harness, no new component registration (the fork-crash lesson).

**One new `internalQuery` in `contacts.ts` deliberately broke the 19-02 export-set pin, and that is
the pin working.** It was widened with a comment naming where the zero-write proof lives.

**Line endings, measured a third time, are MIXED per file.** `cockpit.md` and `contacts-crm.md` hold
**0** CR; `agent-runtime.md` holds **852/852** (fully CRLF), as does `ROADMAP.md` (1334).
`STATE.md` holds 0. Both the standing "the planning and playbook files are CRLF" note and 19-07's
"the playbooks are LF" correction are half-wrong: **measure the individual file**. Each edit here
wrote back with the file's own ending and re-counted afterwards (agent-runtime 852 → 890 CR over 890
lines, zero bare LF).

**`ROADMAP.md` is hand-ticked but NOT committed** — it still mixes the concurrent phase-25 lane's
uncommitted lines. 19-10 reconciles it. No phase-25 file was touched, and `graphify-out/*` is in no
commit. **No `gsd-tools state *` subcommand was run** (every one clobbers this project's STATE.md
frontmatter); hand-edited.

## Notes for the next plans

- **19-09 owns making this tool VISIBLE.** Registering a tool does not put it in the model's context;
  the active `cockpit-agent` skill body must teach it (the 18-06 → 18-08 lesson, verbatim). Until
  that body ships, the ONLY thing that reaches `stageCrmWrite` is `SMOKE::agent::crm=`. Its eval
  fixture is the one owed by the 18-08 override condition.
- **The verbatim smoke strings are in `agent-runtime.md`** and are the only two that work:
  `SMOKE::agent::crm=new@example.com` and `SMOKE::agent::crm=new@example.com:send the quote`. Do not
  add a nested route prefix to them.
- **19-10 UAT owes an eyeball to a trace verb nobody has seen** — `Preparing a records update…` /
  `Records update ready to approve` — on top of the CRM card and Approvals strings 19-06 listed and
  the Pipeline page 19-07 listed.
- **If the agent starts closing follow-ups**, it is not a bug in this tool: `stageCrmWrite` refuses
  `completeFollowUp`/`cancelFollowUp` at the write boundary. Someone will have widened it. The
  refusal sentence points the model at the Pipeline page on purpose.
- **The saved lookup is a bounded scan** (`SCAN_LIMIT` = 1 000 contacts, `by_tenant_createdAt`) with
  the in-memory ranker. The upgrade path named at the site is a `searchIndex` on `contacts.name` —
  at which point the ranker still decides and only the shortlist changes.
- **Do not "warm the contacts cache"** with what resolution found. It is one line and it re-opens
  SC#7. `contacts-crm.md` invariant 16 and a row-count test are what stop it.

## Self-Check: PASSED

- `packages/backend/convex/llm.ts` — FOUND (3 `stageCrmWrite` hits: the tool key, the SMOKE comment, `SMOKE_OP_TOOL`; `savedForName` called from `resolveContacts`)
- `packages/backend/convex/contacts.ts` — FOUND (`savedForName` internalQuery, `rankCandidates` imported)
- `packages/backend/convex/schema.ts` — FOUND (`v.literal("stageCrmWrite")` at :722)
- `apps/web/.../workspace/cards.tsx` — FOUND (VERB entry at :1683)
- `packages/backend/convex/cockpitTools.test.ts` — FOUND (101 tests, 91 → 101)
- `packages/backend/convex/contacts.test.ts` — FOUND (export-set pin carries `savedForName`)
- `packages/backend/convex/runCockpitAgent.test.ts` — FOUND (wipe-on-pick assertion)
- `docs/playbooks/cockpit.md` / `contacts-crm.md` / `agent-runtime.md` — FOUND (`19-08` in all three; `check-playbooks.mjs` exit 0)
- `packages/backend/convex/_generated/` — clean (no codegen needed)
- commits `b982c68`, `c9b42eb`, `c3cf060` — all FOUND in `git log`
