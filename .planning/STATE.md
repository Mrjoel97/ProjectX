---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 19
current_plan: 1 (done)
status: in_progress
stopped_at: "MULTI-LANE — per-lane position lives in '## Lane Status'; this block is the single tool-readable summary. Phase 19 is 1/10: 19-01 landed the contacts substrate (0abc73b, 38ac3d2, a78a169) — the ONE `normalizeAddress`, three pure predicates, the contacts/followUps/suppressions tables, `tenantProfiles.postalAddress`, and `docs/playbooks/contacts-crm.md` registered in `watch.json`. Backend typecheck baseline RE-MEASURED at 0 (exit 0, zero output); the 13 and the 150 quoted elsewhere in this file are both STALE. Next is 19-02. NOTE: `gsd-tools state record-session` CLOBBERED this block once during 19-01 (dropped `current_phase`, reverted `current_plan` to a stale `7 (done)`) and was hand-restored — verify this block after ANY gsd-tools state call. Do NOT re-add a second frontmatter block on merge."
last_updated: "2026-08-09T10:24:40.821Z"
progress:
  total_phases: 51
  completed_phases: 30
  total_plans: 343
  completed_plans: 251
---

---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 15.3
current_plan: 9 (done)
status: Phase complete — ready for verification
stopped_at: "**PHASE 15.3 IS 9/9 AND OWNER-APPROVED. THE LIVE GATE IS PARTIAL — READ THE SECOND HALF OF THIS BEFORE CLAIMING VALT-13.** 15.3-09 shipped the Google Drive rail (commit cf675c7) plus TWO owner-directed follow-ups. **(1) d677d84 — WE RENDER THE DRIVE PICKER OURSELVES.** The plan shipped a paste-a-Drive-link field; the owner rejected it on sight and was right — if the user must open Drive, navigate and copy a URL, they are already in Drive and may as well drag the files in. DriveBrowser.tsx is a breadcrumb + one-level-at-a-time folder list over a new listDriveFolders. **Google's Picker SDK is deliberately NOT mounted and that is not a compromise:** the Picker exists to make the NARROW drive.file scope usable, and we took drive.readonly, so files.list already returns the folders and we draw them with our own tokens — no external apis.google.com script, no API key, no app id, no CSP hole. THE SCOPE CHOICE IS WHAT MADE THE PICKER CHEAP; do not restore the Picker without re-opening the scope decision. **THE ROOT LEVEL IS THREE LISTS, NOT ONE** (drives.list + 'root' in parents + sharedWithMe) — collapse them and a user whose company runs on a shared drive is told they have no folders; drives.list 403s on a personal account and degrades to empty, which is an ordinary shape of this feature. dispatchGuard now LOOPS over BOTH Drive actions for scope-before-refresh, because the browse is what a pre-widening tenant hits FIRST. **(2) 39522a1 — THE PICKER SHOWS THE FILES, FROM THE SAME SINGLE REQUEST.** Folder-only browsing meant an empty folder and one holding 200 documents looked identical until you pressed Import; TWO REAL FOLDERS WERE PROBED THAT WAY DURING THE GATE. The fix is CHEAPER than what it replaced — drop the mimeType folder filter, keep ONE files.list per level, split server-side. Files are shown but NEVER clickable (the unit of import is the folder), each carrying a readable verdict from classifyOne — THE SAME FUNCTION THE IMPORT RUNS, extracted for this reuse so the picker and the import cannot disagree; a test pins classifyOne at 3+ call sites. The count is the LEVEL and the import is the TREE, and the copy says so. **A MUTATION CAUGHT MY OWN TEST BEING VACUOUS TWICE IN THIS PLAN.** (a) the audit name-leak scan tested for `name:` and the SHORTHAND `name,` walked straight through; (b) restoring the folder-only filter left all 13 tests GREEN, because a stub answers with whatever it was told to answer, so asserting on the RESPONSE cannot see a QUERY that changed. **RULE, now in vault.md: when a stubbed test covers behaviour that lives in the REQUEST, assert on the request** — same class as the shared-drive params, which is why those are a source scan. **WHAT THE LIVE RUN PROVED (real Google account, local deployment, 2026-08-05):** the scope widening reaches a real consent; **the reauth gate fired against a genuinely pre-widening token** (the vault said 'your Google connection was made before Drive access existed' while Gmail and Calendar kept working — driveReady distinguishing connected from Drive-ready, live); files.list returned TEN REAL ROOT FOLDERS; drill-down and the breadcrumb work against real subfolders; the empty_folder guard refused rather than creating an empty folder and calling it complete; the file listing reads 'No files at this level, plus everything inside 18 subfolders' and 'Nothing here — no folders and no files', WHICH IS WHAT SETTLED THAT THE EARLIER empty_folder RETURNS WERE CORRECT AND NOT AN ENUMERATION BUG. **WHAT HAS NEVER RUN, AND IS STILL OWED — DO NOT READ OWNER APPROVAL AS THESE BEING DONE:** (1) **THE IMPORT PATH ITSELF.** No document has ever been exported from Drive and landed in the vault; every folder opened during the gate was empty, so exportOne -> landFile -> the fan-in -> walkFolderMembers -> the digest has NEVER executed against real bytes, and ZERO CENTS have been spent on this rail. The reservation, the dedup branch, the re-import diff and folder completion are unit-proven and live-UNproven. (2) **THE SHARED-DRIVE HALF.** No shared drive surfaced for that account, so supportsAllDrives/includeItemsFromAllDrives have still never been exercised against a real one — the failure whose live symptom is a SILENTLY EMPTY FOLDER, and the reason the source scan exists. A stub proves we SEND them; only a real shared drive proves Google honours them. **VALT-13 and the Phase-15.3 checkbox stay UNTICKED** (the Phase-17 human_needed convention): one import of a POPULATED folder closes item 1, access to ANY shared drive closes item 2. Full suite 9/9 packages (backend 1177/1177), backend typecheck at the exact 15-error baseline with zero non-test, apps/web typecheck 0, web build green, check-playbooks exit 0. Servers left running during the session: convex dev on :3210 and next start on :3000."
last_updated: "2026-08-05T02:55:00.000Z"
progress:
  total_phases: 42
  completed_phases: 28
  total_plans: 247
  completed_plans: 236
---

---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: - Platform -> Private Beta
current_phase: 17.1
current_plan: 10
status: in_progress
stopped_at: "MULTI-LANE. 15.2 Vault Formats is COMPLETE at 8/8 and pushed. 16 Research is 8/9 and DEFERRED 2026-08-02 by the owner — engineering complete and probe-verified (last full gate 32/33; the single red is fixed and re-verified), blocked ONLY on an OpenAI balance of $0; see its deferred-items.md for the one-command resume and the 18-08 knock-on. 17 Calendar is 4/4 implementation-complete with goal verification `human_needed` for owner UAT M1-M5. 17.1 Business Blueprint is 9/10 with the profile confirmation surface complete and 17.1-10's live gate next. 18 Document & Content Creation is 7/10 — WAVES 1, 2, 3, 4 AND 5 COMPLETE (18-01, 18-02, 18-03, 18-04, 18-05, 18-06, 18-07), next is 18-08 (Wave 6), which is GATED on Phase 16 closing the shared cockpit-agent candidate stream. This is the single tool-readable frontmatter block; per-lane detail lives in '## Lane Status'. Do NOT re-add a second block on merge."
last_updated: "2026-08-01T08:05:00.0000000+03:00"
progress:
  total_phases: 40
  completed_phases: 24
  total_plans: 231
  completed_plans: 209
  percent: 90
---

# Project State

## Lane Status

Four phases execute concurrently in ONE working tree (they are NOT separate git worktrees). This
table is the source of truth for per-lane position; the frontmatter above is the single
tool-readable summary because `gsd-tools state advance-plan` and `roadmap update-plan-progress`
read only the first frontmatter block.

| Lane | Phase | Position | Next | Notes |
|------|-------|----------|------|-------|
| C19 | **19** Contacts, CRM & Follow-ups | 1/10 plans (wave 1 of 9) | 19-02 (wave 2 — the person store: tenant-scoped write surface, suppression/footer/unsubscribe-token internals, the asA/asB isolation block) | **19-01 COMPLETE** (`0abc73b`, `38ac3d2`, `a78a169`). The substrate: `packages/core/src/contacts.ts` (`normalizeAddress` = trim+lowercase and NOTHING more, `needsAttention`, `followUpIsDue`, `renderFooter`), THREE tables (`contacts`, `followUps`, `suppressions`), `tenantProfiles.postalAddress` optional, and `docs/playbooks/contacts-crm.md` registered in `watch.json`. **EVERY later plan MUST import `normalizeAddress` — never write `.toLowerCase()` at a call site**; that single function is what makes "the guard and the contact row agree by construction" true. **`suppressions` is address-keyed and SEPARATE from `contacts` on purpose**: the send guard reads it and never `contacts`, so `contacts.unsubscribedAt` is a display mirror only and suppression outlives the contact. **THE BACKEND TYPECHECK BASELINE IS 0, RE-MEASURED — `npx tsc --noEmit` from `packages/backend` exits 0 with zero output.** Both the `13` in `19-VALIDATION.md` and the `150` elsewhere in this file are STALE; re-measure before quoting either. Full `pnpm test` 9/9 packages (backend 71 files / 1310 tests), `check-playbooks` exit 0, delta 0. **Schema-only changes need NO `npx convex codegen`** — `_generated/dataModel.d.ts` derives table types generically from `schema.ts`; codegen is only needed for a new MODULE. **A FOREIGN LANE'S WORK LANDED IN `38ac3d2`**: `git commit -m` commits the whole shared index, and the `cash-business-finance` lane had five files staged. NOT rewritten (a `reset --soft` while another agent commits to this branch risks losing their work). **From 19-03 on, use the pathspec form `git commit -m "…" -- <paths>`, which ignores the index** — `a78a169` is clean at exactly 2 files because of it. VALIDATION rows 2, 3 and 22 are green; ACTN-05/PIPE-01 stay Pending (nothing ticked — the 17.1-01 early-flip trap). |
| P26 | **26** Connected Product Pages | 4/20 complete; 26-05 at Task 2 checkpoint | Valid authenticated Approvals E2E + blocking owner UAT | **CHECKPOINT 2026-08-05.** The connected Approvals route is committed (`65b1159`) and its owner-preview navigation link is active after the owner rejected the disabled `Soon` entry as inaccessible. This is an access correction, not UAT approval: component contracts 13/13 and web typecheck pass, but authenticated Playwright still needs valid credentials and owner UAT remains blocking. No browser/provider pass was fabricated. Rollback can disable the one link without removing plan state or provenance. Pipeline remains Phase 19 ownership and is consumed only by 26-18. |
| V4 | **15.4** Vault Redesign | 4/4 plans complete | Complete — Phase 26 pending-pages planning is separate | **OWNER-APPROVED 2026-08-05.** Connected Playwright 2/2, both full package suites, both typechecks, production build and playbook watcher passed. Folder-scoped search is server-enforced; Nord Edge root/folder/preview/empty states retain upload, Drive, digest, correction, citations, download and confirmation-gated delete. The executed browser gate caught and fixed synthetic `smoke::<hash>` deletion without weakening real RAG cleanup (`4df7ac0`); evidence/playbooks committed in `c4c041b`. VALT-16 Complete. |
| F | **15.3** Vault Folders | 4/9 plans (wave 4 of 9) | 15.3-05 (wave 5 — sealing: a folder's members are excluded from retrieval until it is `complete`) | **15.3-02 COMPLETE** (`fefb9e4`, `034e28a`, `36d2944`, `e0a2c5e`, `bc72c41`, `8f3ec57`) — the B1 read-cap blocker is closed and the phase's acceptance demo can now render. **THE BOUND IS ROWS AND BYTES, AND THE BYTE HALF IS THE ONE THAT MATTERS:** the plan specified `.take(200)`, which does NOT bound the read (200 rows × 400k chars ≈ 80 MB against a 16 MiB cap), so `readVaultPage` streams `by_tenant`/`by_tenant_folder` and breaks on `VAULT_GRID_PAGE` (200) rows OR `VAULT_GRID_READ_BUDGET_BYTES` (8 MiB) of text, whichever bites first — `constants.test.ts` asserts BOTH directions, so deleting the byte budget as a 'simplification' fails. **NEVER put `text` back on `listVaultDocs`**: it now returns a projection (no `text`, no `tenantId`, no `contentHash`) and one document's words come from the new `vault.vaultDocText`. Three shipped consumers were repaired onto it — `PreviewModal`, the onboarding intake poll, and voice `AbnormalBriefBanner`; **the banner is the cautionary one, it CAST the query result to a local type so the break would NOT have typechecked and would have seeded an empty cockpit plan** (the cast is deleted, the row type now comes from the query). `vaultStats` shares the same window and returns `capped`, rendered as `200+` plus one plain sentence (a '+' alone encodes meaning in a glyph, BRAND §6). **THE CAP IS 200 MB AND IS DECLARED ONCE** — five literal sites deleted; `Dropzone.tsx` imports `@pikar/vault/constants` (the SUBPATH — verified via a prod build that SheetJS does NOT enter the client bundle, chunks 1.7 MB), `apps/web` gained `@pikar/vault`, and copy is derived through `capMB()` because `DocGrid`'s binary `fmtSize` would print '190.7 MB' for the 200 MB constant. **`VAULT_VIDEO_CAP_BYTES` IS UNCHANGED AT 25 MB** — the transcription API's number, pinned with the strict `video < file` relationship. 200 MB is reachable only on a fast link (Convex's upload POST times out at 2 min ⇒ ~13.3 Mbit/s); plan 04 owns the manifest outcome. **KNOWN CEILING, ACCEPTED:** the `category` filter runs over the bounded window (no `by_tenant_category` index, `schema.ts` closed) so a narrow tab can under-report at scale. `packages/core/src/vaultSurface.test.ts` is the FIRST test ever to read the vault UI — 6 tests, non-vacuity anchors first, **mutation-verified RED** (reintroducing `100 * 1024 * 1024` + `max 100 MB` failed 2 of 6). Verified: `pnpm test` 8/8 green (backend 1109/1109), `pnpm typecheck` delta ZERO against the 15-error all-test baseline, `pnpm --filter @pikar/web build` succeeds, `check-playbooks` exit 0. **`gsd-tools state advance-plan` CLOBBERED the first frontmatter block AGAIN** — it dropped `current_phase` entirely and rewrote `current_plan`/`stopped_at` from a stale pre-15.3-01 source (`current_plan: 7 (done)`, `stopped_at: Phase 15.3 context gathered`); hand-restored. `update-progress` worked (229 from disk). VALT-05/VALT-14 deliberately left Pending |
| — | **17.1** Business Blueprint | 9/10 plans, waves 1-7 through the profile confirmation surface done | 17.1-10 (wave 8, playbooks + live gate) | 17.1-09 is complete, core 360/360 and web build green, D5-safe confirmation UI landed |
| V | **15.2** Vault Formats | 8/8 plans complete, owner-approved LIVE | Complete | Final 15.2-08 false-ready/PPTX fan-out closure is committed and pushed |
| R | **16** Research Sub-Agent | 8/9 plans | **DEFERRED 2026-08-02 (owner) — billing only** | **ENGINEERING COMPLETE, DEFERRED ON BILLING.** All six previously-failing fixtures are probe-verified green (29/30/31 run `73583564` 3/3; 32/33/34 run `1246bb4a` 3/3; 32 re-verified `e106bc36` 1/1) and committed (`52a421d`, `3f77378`, `d57dcce`). Last full gate `3ec490ab` was **32/33** and its only red is the one since fixed. Blocker is an OpenAI balance of $0 (`credit_balance_exhausted` verified directly against the key); free daily tokens do NOT unblock it (embeddings + hosted web search sit outside that programme). **Do not re-diagnose — read `deferred-items.md`, which carries the one-command resume recipe and the 18-08 consequence.** ACTN-03 stays Pending; nothing is ticked |
| K | **17** Calendar Actions | 4/4 plans complete | Owner UAT M1-M5 | Offline goal verification is `human_needed`; Google-only create path is implementation-complete |
| O | **22** Owner Authorization (GOVN-01) | 3/3 plans code-complete, serialized on `main` (d62c46c, eda6f10, 6dd86f6) | 2 BLOCKING owner checkpoints | Closes the standing Phase-8 owner-auth blocker. Full backend 860/860; backend typecheck delta ZERO (back to the exact 150 baseline). **Not complete** — needs (a) live owner bootstrap and (b) two-identity `/ops` UAT incl. four direct non-owner API calls. Checklist in `docs/playbooks/authorization.md`. Phase **21 is dependency-blocked** (needs 16-19); **22.1 PARTLY OPEN** — 22.1-01 (Gmail disconnect + Google revoke) is COMPLETE and OWNER LIVE-VERIFIED 2026-08-01 (the grant is gone from myaccount.google.com/permissions; `privacy/page.tsx:312` is now a true statement). 22.1-02 (per-tenant budget keying) is also COMPLETE 2026-08-01 — `dailySpendCents` is keyed by tenantId and a deliberately keyless `deploymentSpendCents` ceiling sits behind it, so one tenant can no longer drain everyone (the Phase 25 multi-user blocker) without trading that for unbounded N × budget exposure. ONE item remains: the CI/typecheck gate. 22.1-03 is PLANNED and PARTLY EXECUTED 2026-08-01 — `.github/workflows/ci.yml` (install → convex codegen → typecheck → lint → test → build, on push(main) + every PR) and `docs/playbooks/ci-gate.md` are landed and PUSHED, and the gate's first run failed at codegen because `CONVEX_DEPLOY_KEY` has never been set on this repo. That also exposed that `skillopt.yml` has been passing VACUOUSLY since forever — its kill-switch step's `|| true` swallows the failed `convex run`, so it logs `enabled=` (empty, not false) and reports green regardless. The remaining Tasks 2-7 (150 backend type errors → 0, 323 biome errors → 0, the red `onboarding.test.ts §4.2`, the anti-vacuous proof) reformat ~200 files and sweep ~40 test files, so they stay an owner call taken BETWEEN lanes, not during them — Task 0 of the plan is the enforcement and it FAILED on 2026-08-01 when Lane 18 wrote `convex/createdDocs.test.ts` between two typecheck runs (150 → 160). 22.1-02 is LIVE-VERIFIED: `pnpm smoke:guardrails` 7/7 PASSED 2026-08-01, incl. 5/6 "C (other tenant) unaffected". That run also fixed a 19-day-old non-idempotency in the smoke itself (case 2/6 counted rows in the INSERT-ONLY audit table keyed on a constant goal hash, so it accumulated across runs — unrunnable since 2026-07-12; the goal now carries a per-run uid) |

| D | **18** Document & Content Creation (ACTN-04) | 10 plans authored; **18-03 COMPLETE** (`8f94e4e`, `d056941`, `67e2d4c`) — the ungated `content-drafter` row at v1 active, zero eval spend; **18-01 COMPLETE with SUMMARY** (`9e54550`, `8a83d12`, `21c2165`, `dc990a5`) — `formatSpec`/`DocFormat` + a 4th defaulted `format` param on `buildDocFilename` (both `.pdf` literals gone, the two shipped 3-arg call sites byte-identical) and `renderHtmlDocument`, pure `packages/core`, zero new deps; **18-02 COMPLETE with SUMMARY** (`476d4c5`, `efc8a82`) — Registration Checklist rows 1/2/13/14: the `createDocument` schema literal + its `cards.tsx` VERB entry in ONE commit (traceParity 2/2, both sets 26→27, `>= 22` floor untouched), plus `vaultDocuments.origin` and `vaultSources.role`/`snippet`/`form`, all `v.optional` ⇒ zero tables, zero indexes, zero migrations, zero backfill. **WAVE 1 IS COMPLETE**; **18-04 COMPLETE with SUMMARY** (`3b669fc`, `a90b417`, `6bc39fa`) — the vault write plane: `insertCreatedDoc` + `patchCreatedDoc` + the Output-card row shape, SC1/SC1b/SC3/SC7 at 10/10, typecheck 150 delta 0. **WAVE 2 IS COMPLETE**; **18-05 COMPLETE with SUMMARY** (`a154c9d`, `e06cd45`, `6360ac9`, `1b53e32`) — Registration Checklist row 4: `draftDocument` now takes `{ tenantId, safeText, safeTextHash, skillVersion?, skillName? }` with `skillName` a CLOSED `v.union` of the two drafter literals, defaulted, feeding BOTH lookup branches through one `const name`; `renderAndStore` gained a 4th DEFAULTED `format` and `generateAttachment` an OPTIONAL `format` property. **`content-drafter` IS NOW REACHABLE — 18-03's row is no longer dead weight.** 142/142 across four suites, typecheck 150 delta 0, biome byte-identical, `document-drafter` body byte-unchanged. **WAVE 3 IS COMPLETE**; **18-06 COMPLETE with SUMMARY** (`bc9ec08`, `47fc7dd`, `8751315`, `a139696`) — Registration Checklist rows 3 and 16: the `createDocument` tool is a key in `buildCockpitTools` with a CLOSED `form` enum (selects BOTH the skill row and the PDF branch) and an OPTIONAL `replace` #index on the SAME schema, so the locked replace-in-place revision costs ZERO registration surface. `execute` always returns a SENTENCE — PII refusal, drafter failure and bad `#index` are returned strings, never throws. `document.created` audit is `{ topicHash, form, vaultDocId, hasPdf }`, emitted from the TOOL, so `cockpit.ts` still has exactly 2 audit call sites. `create=<short or long>:<topic>` registered at all four SMOKE sites. 82/82 cockpitTools (was 71), 268/268 across 10 suites, typecheck 150 delta 0. **WAVE 4 IS COMPLETE**; **18-07 COMPLETE with SUMMARY** (`1c53030`, `b1b7030`, `590ee9a`) — the artifact is SEEN: `OutputCard` is `SourceCard`'s dumb self-querying shape with ONE extra arg on the SAME `byThread` query (`role: "created"`), so zero new tables/queries/routes/deps and no component library; it returns `null` on a turn that created nothing and the shipped grounding `useQuery` call is BYTE-UNCHANGED (91 added lines, ZERO removed; traceParity 2/2). The vault grid gained an `AGENT` chip gated on `origin !== undefined` (so `agent_promoted` keeps its provenance). The SC#6 e2e spec is AUTHORED and `--list`-discoverable but has NEVER RUN. **WAVE 5 IS COMPLETE** | 18-08 **BODY EDIT LANDED 2026-08-02** (owner override — see PARALLELIZATION.md); next is 18-09 | **18-07 SHIPPED THE COPY AND THE TOKENS, AND THEY ARE NOW THE THING TO MATCH:** `✍️ Created` / `✍️ Created · N` (capsTeal), an UPPERCASE `DOCUMENT`/`POST` badge read off the row's own `form` (absent ⇒ DOCUMENT), the titles as `/dashboard/vault` links, the subline **`Saved to your vault. Nothing was sent.`**, and `snippet` as the artifact preview; tokens are `--card`/`--rule`/`--canvas`/`--ink`/`--ink-soft`/`--teal-600`/`--teal-400` only, **zero hex added and ZERO `--held`** (its 3 occurrences are comments forbidding it). **THE PLAN'S `titles[0]` HEADING WAS NOT IMPLEMENTABLE and was replaced by the `#index` title list:** the row ACCUMULATES and a `replace: 2` revise lands the newest title in slot 2 — nothing on the row records WHICH slot moved, so any single-title heading is wrong after the first revision; the `#N` prefixes double as the affordance for the `replace` grammar the tool teaches. **BRAND §6 BEAT THE IN-FILE PRECEDENT:** `ConfChip` (`cards.tsx`) sets `--teal-600` as 0.62rem TEXT, which §6 bans at ~2.9:1, so the badge and the vault chip put the teal in the FILL (`color-mix(in srgb, var(--teal-400) 30%, var(--card))`) and keep `--ink` for the label — do not "restore" teal text there. **TWO THINGS ARE STILL OWED AND BOTH ARE 18-09's: (a) the PLAYWRIGHT RUN ITSELF** — `playwright.config.ts` pins `baseURL 127.0.0.1:3111` with NO `webServer` block, so it needs a live `convex dev` (not `--once`) + the app pinned to `:3111` (`next start` defaults to `:3000`) + `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` an executor cannot mint; **(b) the BRAND CONFORMANCE JUDGEMENT (SC#6's human half)** — the card has NEVER been rendered in a browser. A green `--list` is not a green run, and the spec's own header says so. The spec sends the verbatim sentinel and asserts the testid, the offline title `Smoke Document` (`draftDocument`'s SMOKE short-circuit), the `DOCUMENT` badge and the subline; a SECOND test pins the null case, which is what makes the first non-vacuous. **THE VAULT-SEARCH CEILING IS ANNOTATED AT THE SITE IN `DocGrid.tsx`:** created docs BROWSE for free (`listVaultDocs` has no kind/status/origin filter) but will NEVER match `vault.vaultSearch` (same rag primitive; they are deliberately never ingested — that absence IS the retrieval exclusion); upgrade = a ~3-line title-substring fallback unioned into `hitIds` right there. **Do NOT close it by ingesting** — open owner question at 18-09's gate. **BIOME BASELINES WERE TAKEN WITHOUT `git stash`** (banned here): write `git show HEAD:<path>` to a throwaway sibling inside `apps/web`, `biome check` it, delete it — both edited files' diagnostic sets came back IDENTICAL to baseline (whole-file CRLF format + 3 pre-existing lint/assist findings in `cards.tsx`, shifted +88 lines), so `biome check --write` was never run. **`cockpit.md` (watches `dashboard/workspace/` AND `apps/web/e2e/`) AND `vault.md` (watches `dashboard/vault/`) ARE BOTH OWED under §9 and were deliberately NOT bumped — 18-09 owns them, and `check-playbooks` exits 0 for the FOURTH plan running only because foreign lanes keep bumping them.** **18-07's e2e MUST send `SMOKE::agent::create=long:SMOKE::route=direct_llm:: Quarterly one-pager` — the NESTED route prefix is part of the TOPIC and load-bearing: `create=` only picks the tool, it does NOT keep the model out of the loop, and without the prefix `generateObject` fires for real, throws with no key, and NO vault row is written at all.** **THE `createDocument` TOOL IS INVISIBLE TO THE MODEL UNTIL 18-08 TEACHES IT** in the active `cockpit-agent` body — the key exists, the schema literal and VERB entry exist, the SMOKE op drives it offline, and none of that puts it in the model's context. 18-08 must teach the description VERBATIM (it is recorded in 18-06-SUMMARY.md), not a paraphrase: the locked trigger rule has NO code branch and the body's wording IS the mechanism. **THE OUTPUT CARD ACCUMULATES, NOT PER-TURN:** there is no turn identity inside a tool closure and `buildCockpitTools` is rebuilt per invocation, so the tool READS the thread's latest `role: "created"` row and APPENDS — the index is monotone over the whole conversation (which is what the tool description promises) and `#2`/`#3` stay addressable across turns. That needed one additive `internal.vaultSources.latestCreated` because `byThread` is a `tenantQuery` (auth-derived) and the tool plane passes `tenantId` EXPLICITLY. **18-07's badge reads `vaultSources.form`** — written on every create AND every revise, and FOUR tests now go red if it stops being. **NEVER `git stash` IN THIS TREE** — 18-06 used `git stash -u` for a biome baseline and got away with it (verified against stash object `ea07c31`: only graphify-out + its own file + untracked `Skills/`, all restored), but a foreign lane's uncommitted work would have been swept into a stash it does not know about; compare against `git show HEAD:path` instead. **Do NOT run `biome check --write` on `cockpitTools.test.ts`** — it reformats 92 lines of PRE-EXISTING test code to the configured width for zero correctness; its `assist/source/organizeImports` diagnostic is pre-existing. **Backend typecheck baseline for all of Phase 18 is 150, ALL in `convex/*.test.ts`, ZERO non-test — 18-02 re-measured it and 18-04 held delta 0.** ⚠️ **THE 150 IS STALE AS OF 2026-08-02 — THE LIVE COUNT IS 13.** Re-measured by 20-04 with a foreground `npx tsc --noEmit` from `packages/backend`: **13 errors, all still in `convex/*.test.ts`, still zero non-test** (`runCockpitAgent` 4, `dispatch` 3, `llmRedaction` 2, `blueprint` 2, `optimizerConfig` 1, `evaluations` 1). Something already swept the bulk — most plausibly the `@ts-expect-error import.meta.glob` sweep this same block describes as "100 of the 150 errors across 37 files". **Do NOT gate on 150; re-measure before quoting any baseline.** Also note: a NEW convex module reads as +1 until `npx convex codegen` runs (the generated API has no entry for it yet), which is a codegen artefact and not a type error — CLAUDE.md §7. `CONVEX_DEPLOYMENT` here is a **local** deployment, so codegen needs the local backend up; `npx convex codegen --typecheck disable` starts it and the first attempt may time out before it is listening. **TWO MEASUREMENT TRAPS, found by 18-04: (a) do NOT read a BACKGROUNDED `turbo typecheck`'s output file** — it can be read mid-flush and returned a false **27** with a plausibly-empty non-test list, nearly adopted as a new baseline; three foreground re-runs gave 151/151/150. **(b) do NOT copy the sibling `// @ts-expect-error import.meta.glob` line into a new backend test file** — `tsconfig.json` includes `vitest.config.mts`, which pulls Vite's global types in, so the directive is DEAD (TS2578) and costs a real +1 delta; that one line is **100 of the 150 errors across 37 files** and 22.1-03 is sweeping them. **`startIngest` CALL SITES in `vault.ts` are the exclusion invariant and stand at 5** — the grep-for-the-word count is 9 and is meaningless (the mandated comment names it 4×). **`vaultSources.byThread` no longer bare-`.first()`s**: no-role now means `role === undefined`, so `SourceCard` cannot start rendering created rows. **ONE `vaultSources` row per turn carries ALL N `docIds`** — that is what makes `replace: 2` addressable via `docIds[index-1]`; do not split it into N rows later. **`vault.md` IS OWED under §9 and was deliberately NOT bumped (18-09 owns it) — `check-playbooks` exits 0 only because foreign lane 22.1-02 bumped it earlier today, so 18-09 must NOT read a green hook as the obligation being discharged.** `resetPlan`/`recordScorecardAnswer` stay deliberately trace-less (18-RESEARCH Pitfall 2, fix parked in 18-09's gate); the ponytail note naming them uses BARE identifiers because traceParity regexes the union slice *including comments*. `vaultSources` is now DUAL-PURPOSE — any Output-card read MUST filter `role === "created"`, never a bare `.first()`. **18-03's row is REACHABLE as of 18-05** — `draftDocument({ skillName })` is the only loader, and **18-06 MUST pass `skillName` AND `skillVersion: skillVersions?.[skillName]`** (the record is name-keyed; `skillVersions?.[CONTENT_DRAFTER_SKILL]` resolving to `undefined` is CORRECT, since `content-drafter` is deliberately outside `GATED_SKILLS`). **HTML is reachable on the ATTACHMENT path ONLY, by design** — `renderHtmlDocument` is called from `renderAndStore`'s html branch and `renderAndStore` is reached only by `generateAttachment`/`regenerateAttachment`; **18-06's `createDocument` will find no HTML in its flow and must NOT "fix" that** (markdown is the artifact of record; a non-markdown vault row lands at `pending_extraction`). `createDocument` is a SIBLING closure, never a caller of `renderAndStore` (which captures `planId` and writes `plans.recordAttachments` on failure). `document-drafter` + `cockpit-agent` bodies are byte-unchanged. **ONLY 18-08 (the `cockpit-agent` body edit) IS GATED ON PHASE 16 CLOSING** — the rest of Wave 1-5 is runnable. `cockpit-agent` is a GATED skill with ONE candidate stream and Lane R holds it un-activated at v16; Phase 18 must teach its new tool in that same body, so a concurrent edit would mint a candidate carrying both lanes' prose and the next eval would certify untested instructions. Contract: `PARALLELIZATION.md` § *Phases 18 + 19*. **18 → 19 run SERIAL, not parallel** (owner, 2026-07-31) |

| M | **20** Media Canvas (MEDIA-01) | 17/19 plans complete (waves 1-12, plus 20-11 tasks 1-3) | **20-11 Task 4 — the owner-run live gate (≈$0.75)**, then 20-12 | **NOTHING IN THIS PHASE HAS EVER SPENT A CENT.** No fal request, no STT minute and no `Sandbox.create` has ever run; every figure in `docs/playbooks/media.md` is MODELLED, not measured, and the whole 17-plan build cost **$0**. 20-11 tasks 1-3 landed (`1db8a03`): **ADR-012** (the dispatchable route whose product costs money and whose specialist cannot spend it, the reel scope, the whole-job reserve, the once-only cents floor, the two budget rails, delete-on-success retention) and **ADR-013** (Vercel Sandbox, the token-free `apps/web` route handler, `persistent:false` + `deny-all` as DECISIONS, the script-is-code-not-a-registry-row rule) are the decisions of record. **`docs/decisions/011-*.md` is deliberately BYTE-UNCHANGED** — only its `<=15 s` scope line is superseded (a CLIP is ≤15 s; a DELIVERABLE is N clips assembled), so ADR-012 amends it from outside rather than editing it. `REQUIREMENTS.md` MEDIA-01, `PROJECT.md` S3 and the koda todo's reversed `/assemble` deferral are corrected; five ROADMAP plan checkboxes for plans that had already shipped were still unticked and now are; **20-17 (captions) was the designated CUT LINE and was NOT cut.** **THREE THINGS ARE OWED AND NONE OF THEM IS CODE: (a) 20-11 Task 4**, the ≈$0.75 owner live gate — Run A the Wan spine at 480p (≈$0.29), Run B the LongCat-720p resolution-for-price A/B (≈$0.12), Run C one 30 s block (≈$0.33) that empirically backs out **fal's billed-seconds fps divisor, which NO automated fetch has ever read — fal 429s them all, and a wrong divisor puts every LongCat reservation off by 2×**. Its evidence table is the LAST subsection of `## Reconciliation` in `media.md` and **every row is blank; a blank row means NOT RUN, never that it passed.** Preflight: `FAL_KEY` / `FAL_WEBHOOK_SECRET` / `MEDIA_RENDER_SECRET` / `MEDIA_RENDER_URL` on the **deployment** env (**NOT `.env.local`** — the Phase-2 lesson), `MEDIA_RENDER_SECRET` + `MEDIA_SANDBOX_SNAPSHOT_ID` as Vercel project vars, and one `pnpm --filter @pikar/web bake:sandbox` — the only place the `awk` assumption gets settled. **(b) `20-11-SUMMARY.md` and `20-VALIDATION.md`'s Manual-Only rows**, both specified to carry the gate's numbers verbatim, so neither can honestly be written first. **(c) 20-12**, the conversational entry point, **PARKED behind Phase 16 closing the shared `cockpit-agent` candidate stream** — it edits the same body as 18-08 and the two serialize with each other. **MEDIA-01 stays Pending and the Phase-20 checkbox stays unticked** until 20-12 lands (the 17.1-01 early-flip trap). Settled numbers, already recorded in `media.md`: Vercel tier **Pro**, route `maxDuration` **300 s**, sandbox `timeout` **240 s**, `MEDIA_JOB_CAP_USD` **$3.50**, per-tenant `mediaSpendCents` **1,000**, keyless `deploymentMediaSpendCents` **10,000**. Backend typecheck baseline for this lane is **13** (all in `convex/*.test.ts`), not the stale 150 |

**Counts above are recomputed from disk** (40 phase checkboxes, 24 `[x]`, 231 `*-PLAN.md`,
207 `*-SUMMARY.md`), not carried forward from any lane's stale block. Recounted 2026-08-01 by
18-05's executor (the phase-checkbox total moved 41 → 40 between 18-04 and 18-05 — a foreign lane's
edit, not this plan's). The earlier 203/197 predated Phases 18, 19 and 22.1 being planned, so the
frontmatter `percent` DROPPED (97 → 89) without anything regressing: the denominator grew.

⚠ **The phase counts moved 40/26 → 41/24 between 18-02 and 18-04 and NEITHER change is 18-04's.**
A phase checkbox was added and two were un-ticked in `ROADMAP.md` by a foreign lane during that
window. The numbers above are the honest disk recount; if a lane believes a phase was wrongly
un-ticked, re-tick it in ROADMAP.md and recount — do not hand-edit the frontmatter to disagree
with disk.

### Shared-tree discipline (learned the hard way, 2026-07-27)

- **Never `git add -A`.** Use the pathspec form `git commit -m "msg" -- path1 path2`. Observed: one
  executor's uncommitted ROADMAP edit was swept into a sibling's commit.
- **Check `ls .git/MERGE_HEAD` before every commit.** A foreign merge in flight means STOP — the
  owning session is usually live and will finish it. A pathspec commit failing with "cannot do a
  partial commit during a merge" is the same signal.
- **Never bump `Last verified` on a playbook your work does not own.** `check-playbooks` sees other
  lanes' uncommitted code and will demand foreign playbooks; satisfying it claims verification of a
  diff you never read.
- **`roadmap update-plan-progress <N>` can edit the WRONG phase's section** (observed: it wrote
  phase 16's plan count over phase 17.1's `**Plans:**` line). Always `git diff .planning/ROADMAP.md`
  after and confirm every changed line belongs to the phase you named.
- **Do not background a long test suite and then edit files it imports** — vitest transforms a module
  graph changing underneath it and reports reds indistinguishable from a real regression.


## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** A user speaks or types a goal; the system plans it, shows the plan for a single approval, executes it under governance (cost/PII/quality), and follows through to real delivery — with a full audit trail. v2.0 grows this from a governed email cockpit into a broadly-capable, business-aware AI chief-of-staff, then opens the invite-only private beta.
**Current focus:** See `## Lane Status` above. Phase 15.2 is complete. Phase 16 is paused at
16-09's live model gate pending a securely available OpenAI key. Phase 17 is implementation-complete
and goal-verified offline with status `human_needed` for owner UAT M1-M5. Phase 17.1 has completed
plans 01-09 through the profile confirmation surface and continues at 17.1-10's live gate.

## Current Position

**PHASE 15.3 — Vault Folders (Wave 4 of 9) — 15.3-04 COMPLETE: folder ingest is orchestrated.**
Commits `289aa0c`, `116bf14`, `0ed56c5`, `4b6c5c6`, `9ddaca2`. Extraction left the raw scheduler
for a named `vaultIngestPool` (`@convex-dev/workpool@0.4.7`, now a real dependency at its exact
pin) with an EXPLICIT `maxParallelism: VAULT_INGEST_PARALLELISM = 6`, asserted strictly below the
smallest deployment concurrency class. The shared `WorkflowManager` was NOT widened — and note it
actually runs at **25**, not 10: `@convex-dev/workflow@0.4.4` declares its own
`DEFAULT_MAX_PARALLELISM = 25` and workpool's default is never reached.
⚠ **THE PLAN'S CANCEL MECHANISM DOES NOT EXIST AND WAS REPLACED DELIBERATELY.**
`Workpool.cancelAll` takes `{before, limit}` and NOTHING else — it cancels every pending item in
the pool for every folder and every tenant, and per-item `pool.cancel` needs a `WorkId` nothing
persists (`schema.ts` is closed). The stop moved one layer down: `vault.markExtracting` refuses to
start work whose `folderId` no longer resolves and fails the row `folder_cancelled`. Folder-scoped,
tenant-scoped, one `db.get`. `cancelFolder` therefore settles, then DELETES the row, writing ZERO
`vaultDocuments` rows.
⚠ **THE WATCHDOG NOW MEASURES WORK TIME, AND `watchdogStalled` NARROWED TO `extracting` ONLY.**
The two halves are one decision: once the arm fires from `markExtracting` the row is `extracting`
in the same transaction, so a fire finding `pending_extraction` can only mean a Retry re-queued it
— killing that is the same fabricated failure through a different door. What it gives up
(enqueued-but-never-dispatched) is recovered by `npx convex run vaultSweep:runSweep`.
⚠ **RESERVE IS STEP 3, AND IS ALSO THE CLOSE SIGNAL.** `createFolder` → members upload at
`reserving` and DISPATCH NOTHING → `reserveFolder` takes the money, flips to `ingesting`,
evaluates completion once (the all-duplicate case) and then dispatches. Any other order breaks one
of the two locked invariants: a folder already `ingesting` while members arrive settles at
`1 === 1` and synthesises a third of itself.
⚠ **COMPLETION COUNTS THE TRANSITION, OFF THE PRIOR ROW.** Neither terminal writer is idempotent
and workflow mutations are replayed; a post-state test counts twice, overshoots `memberCount` and
strands the reservation. `tryComplete` CASes on `ingesting` and tests `>=`.
⚠ **`settleFolder` REFUNDS THE FULL RESERVATION AND THAT IS CORRECT** — `recordSpend` debits actual
cents separately, so subtracting spend would charge the tenant twice. The plan's Task-5 wording
("reservation minus spend") was written against shipped behaviour instead.
Nine source mutations were applied, observed RED and reverted (see the SUMMARY table); the
watchdog pair went RED before Task 2 and GREEN after, which is the plan's own proof.
Verified: `pnpm test` 1131/1131 across 58 files, `tsc --noEmit` clean in every touched file
(backend + web), `packages/vault` 160/160, `check-playbooks` exit 0. `pnpm boot:check` is
UNRUNNABLE here (it shells `npx convex codegen`, which times out; `convex dev --once` would kill
the owner's live backend) — the running `npx convex dev` codegen+pushed the component on save.
⚠ **`pnpm typecheck` IS RED AT THE PHASE BASELINE** in seven unrelated test files (five unchanged
since `c888acb`, two owned by the media lane) — out of scope, logged in the phase's
`deferred-items.md`.
15.3-05 MUST use `folder != null && folder.status !== "complete"` for the seal, NEVER bare optional
chaining: `undefined !== "complete"` is TRUE and would seal a cancelled folder's members forever.

**PHASE 15.3 — Vault Folders (Wave 3 of 9) — 15.3-03 COMPLETE: the folder budget wall.**
Folder ingest has its OWN $25/day window (`ingestSpendCents` + a keyless $250 deployment
ceiling), a whole-folder `reserveFolder` that refuses INTACT with numbers rather than throwing,
and a `settleFolder` that is the ONE release path — clamped, window-rollover-guarded and
CAS-idempotent. The B3 defect is closed: every paid step of vault ingest used to charge the
COCKPIT's $5 at six sites, so a folder both starved the agent and could be refused halfway.
⚠ **THE REFUND IS A NEGATIVE `count` — ARITHMETIC, NOT AN API.** `@convex-dev/rate-limiter@0.3.2`
has no refund call, is EXACT-pinned and pre-1.0, and a bump can silently stop refunds. Two guards
are both load-bearing: the capacity clamp AND a window-rollover skip. `getValue` returns the
STORED state (no roll-forward), so `settleFolder` rolls it forward with the component's own
exported `calculateRateLimit` — clamping the raw number IS the 2900-against-2500 bug.
⚠ **THE CROSS-WINDOW REFUND HAS NO OFFLINE PROOF.** Every test runs inside one 24h window; the
case that manufactures budget needs a day boundary. Use the operator check in
`docs/playbooks/guardrails.md` §15.3-03 (`npx convex run guardrails:ingestRemainingCents`).
15.3-04 MUST: call `reserveFolderInner` in the same mutation that inserts the folder row, persist
`reservedAt` (settle refuses to refund without it), route cancel AND completion through the one
`settleFolder`, and pass `rail:"ingest", reserved:true` on every folder member's ingest.

**PHASE 15.3 — Vault Folders (Wave 1 of 9) — 15.3-01 COMPLETE: the whole phase schema, landed once.**
`schema.ts` is the repo highest-collision file and this phase touches it for five unrelated reasons,
so all of them landed together in wave 1: the `vaultFolders` table (with a block comment recording
the four decisions a later reader would otherwise undo), six optional `vaultDocuments` fields
(`folderId`, `docType`, `identityLine`, `identityUserSet`, `driveFileId`, `driveModifiedTime`), the
`by_tenant_folder` and `by_tenant_driveFileId` indexes, and the `folder_digest` origin literal.
**NO LATER WAVE EDITS `schema.ts`.** Every addition is a new table or an optional field, so this is a
PURE WIDENING that ships and sits inert — zero backfill, zero migration, zero behaviour. Also landed:
VALT-05..VALT-14 in REQUIREMENTS.md (the coverage gate was vacuous — the file held only VALT-01..04,
all completed in Phase 5), a corrected ROADMAP entry (SEVEN scope items, not five; nine plans; the
Drive-moves-bytes and probe-stage research corrections), `watch.json` coverage for the three convex
modules later plans create, and the `## Phase 15.3` container in `docs/playbooks/vault.md`.
⚠ **THE `folder_digest` LITERAL IS INERT AND THAT IS THE MOST MISREADABLE FACT IN THE PHASE** — it
excludes nothing and includes nothing, because there is ZERO `origin` predicate in any retrieval
path (verified: exactly one `origin` predicate exists in the whole non-test convex tree, and it is
`patchCreatedDoc` revise guard). A digest is groundable ONLY because its insert calls
`startIngest`; the observable check is `ragEntryId != null`, never the literal. Gates: codegen green,
`tsc` 15 errors ALL in `convex/*.test.ts` and ZERO in `schema.ts`, vault+blueprint 154/154,
`check-playbooks` exit 0. VALT-05..14 are deliberately left **Pending** — schema satisfies none of
them. Next: 15.3-02 (wave 2 — the vault page read-cap fix, without which the phase own acceptance
demo cannot render).

PRIOR — **PHASE 18 — Document & Content Creation (Wave 5 of 7) — 18-07 COMPLETE: the Output card.** SC#6's
automated half. `OutputCard` is `SourceCard`'s dumb self-querying shape with ONE extra arg on the
SAME `byThread` query (`role: "created"`) — zero new tables, zero new queries, zero new routes, zero
new dependencies, no component library — and it returns `null` on a turn that created nothing, so
the diff on `cards.tsx` is 91 added lines and ZERO removed and the shipped grounding call is
byte-unchanged. The copy that shipped: `✍️ Created` / `✍️ Created · N`, an UPPERCASE
`DOCUMENT`/`POST` badge read off the row's own `form` (absent ⇒ DOCUMENT), the titles as
`/dashboard/vault` links, the subline `Saved to your vault. Nothing was sent.`, and `snippet` as the
artifact preview — tokens only, zero hex, zero `--held`. The plan's `titles[0]` heading was replaced
by the `#index` title list because the row ACCUMULATES and nothing on it records which slot a revise
moved; the `#N` prefixes double as the affordance for the `replace` grammar. BRAND §6 beat the
in-file `ConfChip` precedent: the teal moved into the badge/chip FILL so the label can stay `--ink`.
The vault grid marks agent-authored rows with an `AGENT` chip gated on `origin !== undefined`, and
`DocGrid`'s filter carries the `ponytail:` ceiling note that created docs browse but never match
`vaultSearch` — do not close that by ingesting. Gates: web `tsc --noEmit` exit 0, production build
green, `--list` discovers 3 tests in 2 files, Biome diagnostic sets identical to `git show HEAD:`
baselines on both edited files (taken without `git stash`), the new spec Biome-clean, traceParity
2/2, every locked-file diff empty. ⚠ **TWO THINGS ARE STILL OWED AND BOTH BELONG TO 18-09: the
Playwright RUN itself (the spec has never executed — it needs a live stack on `:3111` and seeded
E2E credentials) and the BRAND conformance judgement (the card has never been rendered in a
browser).** Next: 18-08 (Wave 6), which is GATED on Phase 16 closing the shared `cockpit-agent`
candidate stream.

PRIOR — **PHASE 18 — Document & Content Creation (Wave 4 of 7) — 18-06 COMPLETE: the `createDocument`
tool.** The surface the model actually calls now exists: one key in `buildCockpitTools`, a closed
`form` enum that deterministically selects BOTH the skill row (`content-drafter` for `short`,
`document-drafter` for `long`) and the PDF branch, and an OPTIONAL `replace` #index on the SAME
schema — so the locked replace-in-place revision costs zero registration surface. Every governed
stop is a returned SENTENCE: a PII refusal, a drafter failure and a bad `#index` all come back as
prose, never as a throw out of the loop. `execute` returns a title and what the user can do with it,
never bytes, never a URL, never a raw `_id`. Long-form stores a derived PDF; short-form's lack of a
Download button is the structural ABSENCE of `storageId`, which `PreviewModal`'s shipped
`canDownload` already handles. The `document.created` audit carries exactly
`{ topicHash, form, vaultDocId, hasPdf }` and is emitted from the TOOL, so `cockpit.ts` still has
exactly 2 audit call sites. `create=` is registered at all four SMOKE sites — Registration Checklist
row 16, the blocker for 18-07's e2e. Mutation proofs: an injected `internal.cockpit.` reference made
the SC2 no-side-effect scan exactly 1 RED; dropping `form` from the Output-card write made 5 RED.
Gates: cockpitTools 82/82 (was 71), 268/268 across ten suites, backend typecheck 150 with delta 0
and zero non-test, every locked-file diff empty. ⚠ The tool is INVISIBLE to the model until 18-08
teaches it in the active `cockpit-agent` body. Next: 18-07 (Wave 5 — the Output card).

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 7 of 8) — 17.1-09 COMPLETE: profile confirmation
surface.** `/dashboard/profile` now mounts one self-contained Blueprint card driven by the
four-state query. `none` offers one governed model-call build; `live` renders a ruled report whose
stated and derived provenance is written in words; `live_stale` adds the neutral, no-amber
unincorporated-document banner and makes Rebuild primary; and `draft` takes precedence for review.
Additions are one default-on group, while contradictions are native, individually default-off
checkboxes with typed and document-derived values side by side. Confirm updates only the Blueprint;
discard clears the proposal and never traps the user behind draft precedence. Mutation proof:
planting `defaultChecked` made exactly 1 of 53 Blueprint tests red. Gates: core 18 files / 360 tests,
web typecheck and production build green, both components Biome-clean with non-vacuous zero-byte
format deltas, and the playbook hook empty. Next: 17.1-10.

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 6 of 8) — 17.1-08 COMPLETE: D2 confirmation
gate.** `confirmBlueprint` promotes a reviewed draft into one tenant-owned `business_blueprint`
document at `ready`; reconfirmation patches the same `_id`, and the document never enters ingest,
embedding, or graph extraction. Accepted contradictions select their cited derived entries while
default confirmation preserves typed values and the user's `business_profile` bytes. The
`blueprint.confirmed` audit payload is pinned to one ref plus four counts, `discardDraft` clears
only draft state, and `blueprintState` derives `none`, `live`, `live_stale`, and `draft` from the
same live/drift helpers used by the agent seams. Mutation proofs caught both an added audit value
and forced duplicate insertion. Gates: backend 51 files / 775 tests, zero non-test TypeScript
errors, playbook hook empty, and zero `startIngest` references in `blueprint.ts`. BLPR-01 and
BLPR-02 are complete. Next: 17.1-09.

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 5 of 8) — 17.1-07 COMPLETE: explicit grounding
spine.** `vaultGroundHydrated` returns `{ docIds, titles, chunks, spine }`, querying the live
blueprint only after retrieval hydration so the spine never enters the retrieval arrays or
`TOTAL_CHAR_CAP`; blueprint read failures remain fail-open as `null`. Evaluations order profile
seeds, blueprint, then retrieval using the real blueprint document ID, while voice prepends the
spine above the `docRef` filter without consuming the document passage-count or character budget.
`searchVault` and `llm.ts` remain unchanged. Mutating the spine into the retrieval arrays made four
vault tests and two real cockpit-tool search tests red; restoration returned both suites green.
Gates: backend 51 files / 766 tests, zero non-test TypeScript errors, playbook hook empty, and zero
`llm.ts` edits across the plan range. BLPR-02 is complete. Next: 17.1-08.

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 4 of 8) — 17.1-06 COMPLETE: standing cockpit
business-blueprint context.** `buildTurnPrompt` is the one cockpit turn-prompt assembly: a live
spine leads, then bounded history, plan context and the current user line; a null spine contributes
zero bytes and preserves the pre-17.1 prompt exactly. `runCockpitAgent` reads
`spineForTenant` only after the no-model SMOKE return path and fails open so a blueprint problem
costs context, never the turn. `system: skill.body` is unchanged. VALIDATION item 24 drives the real
`spineForTenant → liveForTenant → renderSpine` chain on a no-tool turn, pins no-blueprint bytes,
tenant isolation and a dangling pointer, and comment-strips the source before requiring exactly two
`buildTurnPrompt({` call sites. Mutation proof: replacing production's spine query assignment with
`null` made item 24 exactly 1 RED / 4 green while the pre-existing cockpit suite stayed 24/24;
restoring it returned 5/5 green. Gates: llmRedaction 43/43, serial backend 50 files / 761 tests,
zero production type errors, playbook hook empty, zero plan-07 path changes, and zero changed
`system: skill.body` lines from base. BLPR-02 remains pending until SEAM 2 and drift are complete.
Next: 17.1-07, not started by this executor.

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 4 of 8) — 17.1-05 COMPLETE: governed blueprint draft
synthesis.** `deriveCandidates` performs exactly one registry-governed strict-schema model call
after `preCall` and redaction, with a fail-closed skill load before the offline seam and actual
priced spend recorded afterwards. `buildBlueprintDraft` reads the tier row before any spend,
grounds blank derivable fields in closed-field order, dedupes index-parallel sources, citation-gates
all candidates, merges through typed-wins precedence, and replaces one JSON draft blob. A missing
`tenantProfiles` row throws `NO_TENANT_PROFILE`; `writeDraft` patches exactly the two draft fields,
never invents a tier, never writes a vault document, and leaves live source IDs unchanged. A current
live blueprint with zero Stage-1 drift makes a fully typed profile edit probe/model/spend-free; new
documents re-enable synthesis. Mutation checks proved both traps: moving SMOKE before the skill load
and changing the writer refusal into a hardcoded-solopreneur insert each made its test red, then
reverted green. Gates: blueprint 23/23, llmRedaction 42/42, serial full backend suite exit 0, zero
production type errors, playbook hook empty. BLPR-01 remains pending until 17.1-08's confirm gate.
Next: 17.1-06, not started by this executor.

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 2 of 8) — 17.1-03 COMPLETE: the three functions that carry
this phase's guarantees.** All pure `@pikar/core` (§1), 20 → **48** tests in `blueprint.test.ts`,
full core suite **355/355**, typecheck exit 0, ~21 min, ZERO model calls. **(1) D5 IS NOW
STRUCTURAL.** `mergeBlueprint` has **no branch that assigns a derived entry over a stated one** —
that absence IS the guarantee (the `businessProfile.ts:78` idiom), and the proof is a **LOOP over
`BLUEPRINT_FIELDS`**, not the one hand-picked `targetCustomer` case the owner asked for (that is
there too), so it survives someone adding a twelfth field. **Mutation-verified: `out[field] =
candidate ?? typed` ⇒ 3 RED; reverted ⇒ green.** A contradicting candidate raises a `contradiction`
ROW and changes nothing. **Only TWO diff kinds, and the split falls out of D5 rather than UI taste:**
`addition` (blank→value) is non-destructive BY CONSTRUCTION ⇒ one Accept, defaulted ON;
`contradiction` (typed ≠ derived) is the only destructive case ⇒ per-item, defaulted OFF, carrying
both values + the derived source so the surface never re-derives the distinction. **A CHANGED
derived value stays an `addition`** — a contradiction is only ever raised against content the USER
typed, and a changed inference replaces a *system* inference. **An identical rebuild yields an EMPTY
diff** (the whole Stage-2 drift contract), made true by merge rule 3: when neither stated nor derived
has the field, `live` is carried FORWARD, so a probe pass that comes back empty cannot blank a field
the blueprint already had. **(2) THE CITATION TRUST BOUNDARY.** `validateCandidates` drops a claim
whose `sourceIndex` is out of range, the strict-schema `-1` sentinel, or a non-integer — all in the
SAME branch as CONTEXT requires — **DROPPED, never kept uncited**; and drops one naming an unknown
field or a `derivable:false` one, so **a model cannot rename the business, reclassify the tier or
write the entity graph**. Narrowing is a membership test against `BLUEPRINT_FIELDS`, **never a
cast**, and `field` is typed `string` on the way in because it is untrusted. **Drops are REPORTED**
(`{field, reason}`) — VALIDATION L2 calls 0 drops and 8 drops both signals and neither is observable
if the gate swallows them. **THE PLAN'S LITERAL SECOND MUTATION IS BEHAVIOUR-PRESERVING HERE AND
THAT IS RECORDED, NOT PAPERED OVER:** widening the range test to `i < sources.length + 1` left the
suite GREEN, because `sources[i]` yields `undefined` for every bad index anyway — **both gates are
deliberate belt-and-braces and the source now says so**, and the check was re-run against the actual
DEFECT SHAPE (`sources[i] ?? {title:"unknown"}`, i.e. keep the claim and invent the citation) ⇒
**3 RED**, exactly the item-3 drop tests. **(3) THE SPINE.** `renderSpine` is the ONE renderer both
seams inject (cockpit turn prompt + `vaultGroundHydrated`'s separate `spine` field), budgeted
OUTSIDE `TOTAL_CHAR_CAP`, `[stated]` vs `[source: <title>]` with a stated fact **never** cited, a
staleness line iff `unincorporatedCount > 0`, plain `- <Label>: ` labels so the `- **Persona:**`
detector cannot fire on it either, and an all-null blueprint renders `- (nothing confirmed about
this business yet)` rather than throwing (a grounding call must not crash on a sparse-start tenant).
**THE SIZE GUARANTEE BECAME ARITHMETIC, VIA THE ONE REAL DEVIATION:** 17.1-01's `cap` was a VALUE
budget summing to 2280, which **cannot** close under `SPINE_CHAR_CAP = 2500` once eleven labels
(126), the `- `/`: ` scaffolding (55), eleven `[source: …]` markers and the block's own fence + intro
+ staleness line (~325) are counted — the pathological render lands ~2765 and **the tripwire would
have fired on a legitimate max-size blueprint.** `cap` is now the budget of the **WHOLE RENDERED
LINE**, so `line.length ≤ cap` is guaranteed per field and the total is `sum(cap) + framing`, both
constants; caps retuned to sum **1960** and the worst case **MEASURED at 2294 of 2500** (every field
10k chars + a 70-char source title). `tier` had to rise 20 → 60 because `- Tier: solopreneur
[stated]` is 28 chars — itself evidence the value-level reading was wrong. **Legitimate because
CONTEXT assigns "per-field char-cap constants" to Claude's discretion and `cap` has NO consumer
outside `renderSpine`** (verified: `FIELD_SPEC` appears in exactly two source files). `SPINE_CHAR_CAP`
was NOT weakened — still exactly 2500. **The hard total assertion has been SEEN TO FIRE:** `offering`
240 → 1000 ⇒ `renderSpine` throws `blueprint spine is 3052 chars, over SPINE_CHAR_CAP (2500)`, 3 RED;
reverted ⇒ 48/48. **`check-playbooks` BLOCKS, entirely on FOREIGN work** — `growth-diagnostic.md`
(`packages/core/src/specialists.ts`) and `cockpit.md` (untracked `packages/backend/convex/
research.ts`, Lane R's). **Deliberately NOT satisfied:** bumping either would claim verification of a
diff this plan never read. This plan's own obligation IS discharged — `onboarding.md` is not in the
stale list, verified after every task. **BLPR-01 AND BLPR-02 LEFT PENDING ON PURPOSE:** BLPR-01's
text covers the confirm gate (17.1-08) and BLPR-02's covers the seams (17.1-06/-07); flipping either
after plan 3 of 10 is a false signal. **A HARNESS DETAIL WORTH KNOWING: a TDD RED that fails at
COLLECTION prints `Tests no tests`, not a count** — task 3's test file calls `renderSpine` in a
`describe` body, so before the export existed vitest could not collect the file at all. **STILL OWED
BY 17.1-07: the preflight re-read of `vaultGround.ts`/`vault.ts`/`schema.ts`** (inherited from
17.1-01; this plan touches none of them). Next: 17.1-04 (Wave 3 — the backend read plane).

PRIOR — **PHASE 17.1 — Business Blueprint (Wave 1 of 8) — 17.1-01 COMPLETE: the pure blueprint core.**
`packages/core/src/blueprint.ts` is live — Convex-free, portable (§1), 20 tests, and the type
contract every later 17.1 plan is written against. **The one thing worth carrying forward is that
BOTH of its guarantees are structural, and both were mutation-checked rather than asserted.**
(1) **Totality:** one `as const satisfies Record<BlueprintField, FieldSpec>` table (`label`/`list`/
`cap`/`derivable`/`probe`) makes the serializer, the diff, the probe map and the spine caps total AT
ONCE — deliberately not a switch, whose `default` branch would make a new field silently inherit
another's behaviour and make the coverage test vacuous forever (`TIER_REASON`/`armFor` lesson).
**Proven: a 12th `BLUEPRINT_FIELDS` member with no spec entry ⇒ `TS2741` at the `satisfies`;
reverted ⇒ exit 0.** (2) **The `- **Persona:**` collision:** the stored markdown uses the PLAIN
`- <Label>: ` scalar shape, because that exact bolded string is the BUSINESS-PROFILE DETECTOR in
`evaluations.ts` and `vault.profileSeedDocs` and a blueprint wearing it is misread as a profile doc
by BOTH. **Proven: making the marker bold turned the suite 4 RED** — without that check,
`not.toContain("- **Persona:**")` would have passed forever. **A THIRD trap is closed by SIGNATURE,
not by a comment:** `statedFromProfile(profile: BusinessProfile, tier: Tier, entities)` takes the
typed profile and nothing else, so `tenantProfiles.revenueStage` — the closed union with the
confusingly similar name to `BusinessProfile.stage`'s free string — is structurally unreachable;
CONTEXT names reading the wrong one "a silent correctness bug NO test would catch". Cost scales with
BLANKS (`probesFor` emits nothing for a typed field, and never for `name`/`tier`/`entities`, which
are `derivable: false`); a blank is ABSENT/`null`, never an empty entry (`trim().length > 0` per
value — the `SLOT_PRESENT` rule, never `!value`); `deserializeBlueprint` is TOTAL and never throws,
so a foreign blob degrades to "no blueprint" instead of crashing a grounding call. Per-field caps sum
to **2280** chars (measured, not estimated) inside the ≈2500 spine budget — **17.1-03 owns the hard
total assertion.** **TWO THINGS RECORDED RATHER THAN PAPERED OVER. (1) The plan's preflight
("confirm 15.2/16/17 have merged; if a lane is still live, STOP") was OVERRIDDEN by the orchestrator
and all three lanes were live throughout** — 16-06, 15.2-08 and wave-mate 17.1-02 all committed into
this tree DURING execution. Safe here only because this plan shares NO file with any lane
(`packages/core` + docs only); every commit checked `.git/MERGE_HEAD` first and used the
`git commit -- <paths>` pathspec form with an explicit file list, never `git add -A`. **The
preflight's `vaultGround.ts`/`vault.ts`/`schema.ts` re-read was NOT performed and TRANSFERS TO
17.1-07**, the plan that actually edits `vaultGround.ts` and the one Lane R overlaps. **(2)
`check-playbooks` BLOCKS, entirely on foreign work** — `skill-registry.md` (17.1-02's four
uncommitted skill files) and `vault.md` (15.2-08's `officeText.ts`). **Deliberately NOT satisfied:**
bumping either `Last verified` would write a verification claim about a diff this plan never read and
would discharge another plan's §9 obligation. This plan's own obligation IS discharged —
`onboarding.md` is not in the stale list, and no blueprint path is in the creation-gap list, which is
what the new `watch.json` entries bought. **CONTEXT's Definition-of-Done line *"blueprint.ts needs no
new watch.json entry — the packages/core/ prefix covers it"* is FACTUALLY WRONG** (there is no such
prefix — only three specific `packages/core` paths), as `17.1-VALIDATION.md` §3 already flagged; all
four blueprint paths are now registered under `onboarding.md`. **`BLPR-01` was left PENDING in
REQUIREMENTS.md on purpose:** `gsd-tools requirements mark-complete` flipped it to Complete, but SIX
of this phase's TEN plans claim BLPR-01 (01, 02, 03, 05, 08, 09, 10) and the requirement's own text
covers the confirm gate, which is 17.1-08's — so the flip was REVERTED. **`gsd-tools state
advance-plan` was NOT run** (this file holds four lanes' frontmatter blocks and the tool reads only
the first); the 17.1 block was hand-added. **ROADMAP `update-plan-progress` DID work this time**
(contrary to the standing warning) but left the plan checkbox and the date cell stale — both
hand-fixed, and it also corrected a pre-existing false *"7/7 plans complete"* line for this phase.

PRIOR — **PHASE 15.2 — Vault Universal Format Recognition & Extraction Fan-Out — ALL 7 PLANNED WAVES
COMPLETE; owner-created 15.2-08 still outstanding.** Runs on `main` as **Lane V**, an explicitly contracted THIRD lane alongside the
live Phases 16 (Lane R) and 17 (Lane K) in their own worktrees. The contract is
`.planning/PARALLELIZATION.md` § *Phase 15.2 — vault format recognition (Lane V)*, written in this
plan's FIRST commit before any code landed. Lane V owns `packages/vault/src/*`, `vaultExtract.ts`,
`vaultSweep.ts`, `vaultLlm.ts` and the vault UI route; `packages/backend/convex/vault.ts` is the ONE
shared-risk file (Lane R stores web research in the vault) and Lane V's edit there is confined to
`vaultUpload`'s scheduling block plus `markReady`. **There is NO Wave-0 union freeze for this lane,
deliberately** — 16∥17 needed one because both add literals to the same closed unions and to
`schema.ts`; 15.2 touches no closed union and needs no schema change. Do not "restore" a Stage-1
commit that was never meant to exist.

Status (15.2-07): **SC#3 IS FULLY CLOSED — LEGACY `.xls` READS ITS NUMBERS, PROVEN LIVE AND
OWNER-APPROVED. The phase's highest-risk item passed, and it was made to prove it could FAIL first.**
`xlsx` (SheetJS) **0.20.3 is pinned EXACTLY to the vendor CDN tarball**
(`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, no caret, §6) and **deliberately NOT npm
`xlsx@0.18.5`** — the last registry publish carries **CVE-2023-30533** (prototype pollution) and
**CVE-2024-22363** (ReDoS), and this code parses UNTRUSTED UPLOADS. **THE SPIKE RAN BEFORE THE
PARSER WAS WRITTEN**, so a failure would have cost a dependency revert rather than a wasted module.
Rebuilt with Convex's exact node-action esbuild flags (read out of
`convex/dist/esm/bundler/debugBundle.js` + the `platform:"node"` call site in `cli/lib/config.js`;
`format:"esm"`, `conditions:["convex","module"]`, `splitting:true`, esbuild 0.27.0): **STATIC import
→ 19 REAL NAMED EXPORTS** (`read`=function, `utils.sheet_to_csv`=function), **dynamic → also 19**,
and the **`pdf-lib` CONTROL still collapsed to 1 key (`default`), `PDFDocument`=undefined**.
**THE CONTROL IS THE ACTUAL RESULT:** without a known-collapsing case, "SheetJS was fine" and "my
probe cannot see a collapse" produce identical output. **PITFALL 9's PREDICTOR WAS WRONG AND IS NOW
CORRECTED — the plan assumed SheetJS was "CJS-first, same shape as pdf-lib"; it is not.** The
discriminator is **THE PACKAGE MANIFEST, NOT THE IMPORT FORM**: `pdf-lib` has `main: cjs/index.js`
and **NO `exports` map**, while `xlsx` 0.20.3 ships `"exports": {".": {"import": "./xlsx.mjs"}}` — a
real ESM build — so it is the **`unpdf` case** and survives BOTH forms. **That rule was promoted OUT
of the phase narrative into `## Invariants — what must never break` and `## Dependencies & blast
radius` in the playbook**, because a rule only a SUMMARY reader finds is not a rule: **before adding
ANY dependency to a node action, read its `package.json` for an `exports` map + ESM build.** The
static import was kept anyway — it is the shape actually proven, it costs nothing, and a version
bump could drop the ESM build with no test going red. **A HAZARD THE PLAN DID NOT PREDICT, CAUGHT BY
MEASURING: SheetJS's `read()` FALLS BACK TO A DSV/PLAIN-TEXT GUESSER**, so **64 bytes of noise come
back as a workbook holding ONE CELL OF MOJIBAKE** — non-empty, therefore clearing `empty_extraction`
and landing as a `ready` document. A plausible failure that would have shipped. Fixed by REUSE
(rung 2): `xlsText` gates on **`sniffContainer`** (dep-free, already on the barrel) and accepts only
`ole2`/`zip`. **`xlsText` is SUBPATH-ONLY** (`@pikar/vault/xlsText`) — the `officeText` rule for
~1 MB instead of a few KB — and **its success signal is `okSheets`, a COUNT** (the 15.2-06 `okPages`
rule), with the `Sheet N` header emitted ONLY for a sheet that yielded content, so **it is
deliberately NOT a third instance of the false-ready family**. **TWO HONEST TERMINAL ENDINGS, one
earlier than expected and both pinned:** an OLE2 file with a `Workbook` stream but no BIFF content →
`xls_parse_failed`; a real `.xls` **truncated in half** → **`unsupported_format`**, because halving
removes the CFB DIRECTORY SECTOR so `ole2Kind` cannot find `Workbook` and the dispatcher refuses one
rail EARLIER — **do not "fix" that reason to the one that reads better.** **THE LIVE RESULT:**
freshness proved by touch probe (**2.984 s CPU vs 0.000 s idle**); `npx convex dev --once` **REFUSES
while the local backend holds `:3210`**, so no one-shot push verdict was available without stopping
the owner's `convex dev` (not done unilaterally); the **deployed module was proven to LOAD with
SheetJS in it** via a throwaway-tenant probe (`vaultSmoke:insertBrief` → live
`vaultExtract:extractDoc` → terminal `no_stored_bytes`, **$0**, row purged); then **a real legacy
`.xls` upload reached `ready` with its NUMBERS visible — OWNER APPROVED.** **EVIDENCE LEVEL RECORDED
PRECISELY AND NOT ROUNDED UP: the owner confirmed the stated criterion (`ready`, numbers present,
NOT headings-only); NO individual figures were transcribed back and NOTHING was diffed against
Excel** — so "the round trip works and did not degrade to header recovery" is proven, "every value
is correct" is not claimed. **THE DATE-SERIAL CEILING IS NOT CLOSED BY THAT APPROVAL:** a
SheetJS-WRITTEN `.xls` yields the Excel serial **`46067`** (its BIFF8 *writer* emits no date
number-format record; **`cellDates: true` does NOT help** — measured), while the same workbook as
`.xlsb`/`.xlsx` renders `2/14/26`; **a real Excel-AUTHORED `.xls` with a format record remains
UNOBSERVED** (upgrade path: a per-cell `t === "d"` walk instead of `sheet_to_csv`). **THREE
MUTATION-CHECKS, each confirmed applied and each reverted green:** the SheetJS import made dynamic ⇒
**1 RED (the scan) WHILE ALL 10 BEHAVIOUR TESTS STAYED GREEN** — Pitfall 9's invisibility reproduced
on demand inside our own suite; the `sniffContainer` guard removed ⇒ **1 RED** (mojibake); the
`Sheet N` header emitted unconditionally ⇒ **2 RED**. Three auto-fixed deviations, all from
verifying rather than assuming: **(a) `xlsx` does NOT resolve from `@pikar/backend`** (the same
arrangement that keeps `fflate` out of the V8 bundle, confirmed by `ERR_MODULE_NOT_FOUND`), so it
was added as a **DEV-ONLY** dep there to keep the fixture SheetJS-written rather than a committed
binary — **nothing in production imports `xlsx` from `@pikar/backend`**; **(b) my own static scan
matched the banned form inside a COMMENT** (the file deliberately spells out `await import("xlsx")`
so the next reader knows what is forbidden), so the scan now strips comments and asserts against
CODE; **(c) my truncated-`.xls` assertion was an ASPIRATION** — corrected to the observed
`unsupported_format` routing, with 15.2-03's synthetic OLE2 fixture repurposed to cover the parser's
own `xls_parse_failed` ending. **The spike probe was deliberately NOT committed** — a test that
esbuild-bundles a 2.4 MB package on every run is debt; the durable lock is the static scan and every
observed number lives in the playbook. Gates: `@pikar/vault` **125/125** (was 114), `vaultExtract`
**47/47** (was 41), backend `test vault` **121/121** (was 115), backend `tsc` **52 errors ALL in
test files, ZERO non-test** (baseline held exactly), `check-playbooks` exit 0, graph refreshed
(+261 convex edges). **`nyquist_compliant: true` NOW STANDS ON EXECUTION EVIDENCE** — all 3
Manual-Only rows executed, recorded and passing — rather than planning-time conditions alone.
**STILL OPEN AND NOT TOUCHED HERE: (1) the parser false-ready family** — `xlsxText`
(`officeText.ts:65`) and `pptxText` (`:74`) emit `` `Sheet ${n}` ``/`` `Slide ${n}` ``
UNCONDITIONALLY, so scaffolding-only output defeats `empty_extraction` and reports `ready`; **that
is 15.2-08's scope** and `okSheets` is the pattern it should reuse. **(2) `failureCopy` has STILL
never been rendered in a browser** at any point in this phase, and the `:3000` `next start`
(PID 14512) **still predates its own build** — restart it before trusting any vault-UI observation.

PRIOR — Status (15.2-06): **SCANNED PDFs ARE TRANSCRIBED, NOT SUMMARISED — proven LIVE and owner-APPROVED,
with the `attachment-extractor` prompt BYTE-UNCHANGED.** `extractPdf`'s hosted fallback used to slice
the PDF to the page cap and send the whole thing as **ONE** file part. The skill's contract is
written for *a single image or document (PDF page…)*, so a 12-page deck asked it to do something its
prompt never promised and it digested. **CLAUDE.md §5 is satisfied by REUSE, not a new skill row:
`extractHosted`'s signature is unchanged and is called ONCE PER PAGE.** Three pieces landed.
(1) **`fanOutPages`** — bounded-concurrency batches, **SEQUENTIAL across batches**, reassembled into
a **pre-sized array indexed BY PAGE** so ordering is *structural* rather than a sort someone must
remember. A failing or timed-out page contributes an **`[unreadable]` marker, never a throw** (§4 —
no SDK string, no parser string, no document content). **The success signal is `okPages`, a COUNT,
not the text being non-empty** — a document made entirely of markers IS non-empty, so
`empty_extraction` would never fire on it, which is the identical false-ready shape as the
`Slide N`/`Sheet N` parser gap. **15.2-08 should reuse this pattern.** (2) **`pdfPages`** — N
one-page PDFs from **ONE loaded source** (reloading per page is the memory pressure the playbook
flags); `VAULT_EXTRACT_PAGE_CAP` (50) still binds. (3) The hosted branch rewired; `okPages === 0`
throws into `extractDoc`'s **existing** outer catch rather than adding a second failure mechanism.
**FOUR CONSTANTS, each with a reason: `PAGE_BATCH_SIZE` 6 — also the OCC-CONTENTION WIDTH, because
each page is its own `recordSpend` write against ONE KEYLESS `dailySpendCents` window;
`PAGE_TIMEOUT_MS` 60 s — `CALL_TIMEOUT_MS` (480 s) is PER CALL and was tuned for one whole-document
call, so under fan-out ONE STUCK PAGE WOULD EAT THE 10-MINUTE ACTION CEILING; `FANOUT_BUDGET_MS`
420 s; page cap 50 unchanged.** **THE LIVE RESULT** on `local-joel_feruzi-pikar_ai_50c69-1`,
2026-07-27 15:00Z: row `mx78ake083gn575pg43sw9j66x8b86eb` (`The_AI_Executive_OS.pdf`) went
**2,161 → 7,868 chars (3.64×)**, headers **`Page 1`…`Page 12` ascending**, **0 `[unreadable]`**,
per-page 344–986 chars evenly spread, **no digest tell anywhere in the text**, figures verbatim
(`$53.2B`, `44.9% CAGR`, `2,136 commits`). **77 s, 13¢ across 12 calls, ZERO OCC and zero new
`deadLetters`** — which **RESOLVES RESEARCH §11 item 4 BY OBSERVATION** rather than by argument.
**DEPLOYMENT FRESHNESS WAS PROVED BEFORE A CENT WAS SPENT:** an idle CPU reading is equally
consistent with "already pushed" and "watch not running", so the source file was TOUCHED and the CPU
measured — **3.77 s vs 0.125 s idle**, i.e. watch mode demonstrably re-pushed. **OWNER VERDICT:
APPROVED — *"the text reads as transcription, not summary."* RECORDED PRECISELY AND NOT ROUNDED UP:
the verdict rests on the Page 3/Page 11 excerpts plus the char-count/page-header/no-digest-tells
evidence, and it was given FROM THE ROW DATA, NOT FROM A BROWSER** — at verdict time `:3000` was
still the stale `next start` (PID 14512, launched 2026-07-26 21:35:06 against a `.next` built
2026-07-27 16:22:39), unrestarted since 15.2-05 flagged it. **No vault-UI check happened; the preview
pane's rendering of a fanned-out scan is UNOBSERVED, as is `failureCopy` still.** **TWO PROPERTIES OF
THE NEW PATH TO CARRY FORWARD: `extractionTruncated` WILL NOW START APPEARING ON LONG SCANS** — a
verbatim 50-page transcription is far likelier to reach the 400k `VAULT_EXTRACT_CHAR_CAP` than a
summary ever was, and **that is NOT a regression** (15.2-04 made sure the flag survives into
`ready`); and **13¢/12 calls (~1.08¢/page) is the new per-scan cost shape**, replacing one call per
document. **TWO MUTATION-CHECKS, each confirmed applied and each reverted green:** reassembly written
in COMPLETION order instead of by page index ⇒ **3 RED**; the loop advancing by `pageCount` plus the
deadline check disarmed ⇒ **5 RED** (including both deadline rows). **THE OFFLINE SUITE PROVES SHAPE,
NOT VERBATIMNESS, AND STAYS GREEN WHEN THE MODEL DIGESTS** — which is exactly why a static scan named
*"the hosted branch no longer sends the WHOLE DOCUMENT as one call"* was added, and why SC#5 was NOT
reported closed on green. Two auto-fixed deviations: the plan's literal `const { text, okPages }`
**collided with `extractPdf`'s existing `text` binding** and esbuild refused the whole module, taking
all 32 tests red (a transform failure, not a logic one) — renamed to `transcribed`; and an existing
test **asserted the OLD `NO_ACTIVE_SKILL` failure string**, which the fan-out necessarily changes
(per-page throws become markers, §4), so it was **INVERTED, not deleted** — it now asserts the branch
was still taken and the row is TERMINAL — because left alone it would have gone red on `main` and
read as a regression in the fix. **`slicePdfToPageCap` KEPT despite having no production caller**
(owner-confirmed): `must_haves` names it a required export and its page-cap test still covers it —
explicitly NOT a deviation. Gates: `vaultExtract` **41/41** (was 28), backend `test vault`
**115/115** (was 102), `@pikar/vault` **114/114**, backend `tsc` **52 errors ALL in test files, ZERO
non-test** (baseline held exactly), `check-playbooks` exit 0. **STILL OPEN AND NOT TOUCHED HERE: the
parser false-ready family** — `pptxText` (`officeText.ts:74`) and `xlsxText` (`:65`) emit
`` `Slide ${n}` ``/`` `Sheet ${n}` `` UNCONDITIONALLY, so scaffolding-only output defeats
`empty_extraction` and reports `ready` — **that is 15.2-08's scope, after 15.2-07.** SC#3's XLS half
remains 15.2-07's and is now the **LAST** open Manual-Only row.

PRIOR — Status (15.2-05): **[Phase 15.2] THE PHASE GATE WAS PAID LIVE — and it is the first thing in this
phase that was.** Deployment **`local-joel_feruzi-pikar_ai_50c69-1`** (local, `:3210`, project
`joel-feruzi:pikar-ai-50c69`), sweep executed **2026-07-27T13:58:34Z**. **The owner's stranded
`.xlsm` (`mx725hvxy1vsjvtaa4hza18pms8b8gp4`, `Zainab_Blowing_Operators_KPIs_Feb_2026.xlsm`, created
2026-07-26T21:33:43Z, stranded 16.4 h) went `pending_extraction` / 0 chars / no `failureReason` →
`ready` / 256,439 chars / no `failureReason`.** The content is SUBSTANTIVE, not plausible: **46
sheets, 3,084 lines, 2,313 numeric-bearing lines**, real cell values (`Zan Aqua 1.5 Ltr *6 → 80000 /
4800 / 16.666666666666668 / 600000`) with `#DIV/0!` preserved — headers AND numbers, i.e. NOT the
degraded shape SC#3 warns about. A full row-by-row diff of `vaultDocuments` shows **exactly 1 of 55
rows changed**, zero collateral. **TWO FINDINGS THE GATE ITSELF PRODUCED, both recorded rather than
smoothed over. (1) `npx convex run vaultSweep:runSweep` — the plan's own gate command, and the one
written into `vaultSweep.ts`'s header comment — IS A SILENT NO-OP.** It returned *"Migration already
done"* (`lastFinished: 2026-07-18`): `runSweep` is `migrations.runner(...)`, a `@convex-dev/migrations`
migration that records completion and refuses to re-run, and the `.xlsm` was uploaded EIGHT DAYS
AFTER it finished, so a bare invocation would never have seen that row. Recovery required
**`'{"reset": true}'`** (the component's own `toStartOver` hint); safe by construction because
`migrateOne` early-returns unless `pending_extraction` + `storageId` (55 processed, 1 changed).
**Any future backlog recovery MUST pass `{"reset": true}` or it will report success having done
nothing** — the same silent-success family this phase exists to delete, found in the phase's own
tooling. **(2) `size` and `contentHash` are REWRITTEN on every successful extraction** —
`vault.ts:632-633` (`ingestExtractedText`) sets `size: byteLen(text)` / `contentHash: contentHash(text)`,
so `size` describes the EXTRACTED TEXT, not the uploaded file (803281 → 256569). Pre-existing and
intentional (hash-dedup keys on text), **but it means the 803,281-byte fingerprint identifying this
row in every 15.2 planning document NO LONGER MATCHES IT** — search by `_id`/title, do not conclude
the row was deleted. **OWNER VERDICT: APPROVED but only PARTIALLY OBSERVED, and the unobserved half
is recorded as unverified rather than rounded up.** OBSERVED: a fresh **`.pptx`** upload
**auto-progressed to `ready` with no button pressed** — the FIRST live confirmation of the
15.2-01/02/03 spine on a NEW upload rather than a recovered row, for a format never in the old
three-entry MIME allow-list. **NOT OBSERVED:** the `.xlsm` preview PANE contents; the junk-file →
plain-English `failed` + remedy path, so **15.2-04's `failureCopy` HAS STILL NEVER BEEN SEEN IN A
BROWSER and SC#4's live half is only partially paid**; and legacy `.doc`/`.ppt`/`.xls`.
**NEW KNOWN GAP, NOT A WAVE-5 REGRESSION — the owner's `.pptx` came back TITLES ONLY**
(`mx7a40n7460cj3d1ww97bms6wd8bb9zg`, `ready`, `ragEntryId` populated so full ingest incl.
`extractGraph` ran, **`size: 356` = the entire text**). Root cause: `pptxText`
(`packages/vault/src/officeText.ts:70-76`) reads `<a:t>` runs from `ppt/slides/slideN.xml` and
NOTHING ELSE — the deck's KPI content lives in `ppt/charts/chart*.xml`, embedded worksheets and
images, **entries already present in the same `unzipSync` result and never opened**; the entity graph
was empty because it was handed 356 chars of headings, so do NOT go debugging `extractGraph`.
**The trap: line 74 emits `` `Slide ${n}` `` UNCONDITIONALLY, so a deck with zero extractable runs
still yields non-empty text, `empty_extraction` never fires, and the row reports `ready` — a
FALSE-READY of exactly the family this phase exists to delete. `xlsxText` has the same shape at
line 65 (`` `Sheet ${n}` ``), so it is a FAMILY, not one site: the honesty gap was closed at the
scheduler in 15.2-03 and is STILL OPEN one layer down, in the parsers.** Owner disposition: **new
plan 15.2-08, sequenced AFTER 15.2-07**, covering both halves (chart/diagram/notes walk +
scaffolding-only output failing honestly). Deliberately NOT fixed here — a verification plan does
not smuggle in an edit. **ENVIRONMENT: the deployment was DOWN at plan start and had to be recovered
first (owner-approved).** Nothing on `:3210`/`:3211`, no `convex-local-backend` process at all, and
three orphaned convex CLI processes from the previous day — a `dev --once --configure existing` hung
since 21:51 (18 min after the `.xlsm` upload, the likely cause, cf. the untracked
`.env.local.bak-*` files) plus a `convex dev` that had burned **860 s of CPU** against a dead backend
(a burnt-out retry storm; all three measured at 0.00 s CPU delta over 12 s before being killed).
Recovery: kill exactly those three PIDs → verify ports free and no respawn → **ONE**
`convex dev --run skills:seedSkills`. **Seeding in the same push is not optional** — the ingest
workflow's graph-extract step fails closed with `NO_ACTIVE_SKILL` when unseeded, which would land the
row at `failed` for a reason unrelated to this phase. Push reported `Convex functions ready! (36.14s)`
with no bundler or type error. **A SECOND TRAP, reported not worked around: the `:3000` server is
`next start` launched 2026-07-26 21:35:06 while `.next` was rebuilt 2026-07-27 16:22:39** — a process
predating its own build, the exact Phase-14 `voice.md` trap; the owner was told to restart before
trusting any vault-UI symptom, and `failureCopy`'s unverified status is partly downstream of this.
Offline pre-flight all green: `pnpm install` with **`pnpm-lock.yaml` diff = 0 lines**, `@pikar/vault`
**114/114** + tsc exit 0, backend `test vault --maxWorkers=1` **102/102**, backend tsc **52 errors
ALL in test files, ZERO in any non-test file**, `pnpm --filter web build` green, `check-playbooks`
exit 0. **`nyquist_compliant` LEFT UNCHANGED at its planning-time `true`** — the plan expected to
find it `false`; flipping a flag to match a plan's assumption is the paper-over this phase forbids,
and the VALIDATION file's own text says the flag describes planning-time conditions. 07-T5 owns the
final call. **STILL UNPROVEN: SC#5** (verbatim scanned-PDF output — the 12-page deck
`mx78ake083gn575pg43sw9j66x8b86eb` is still `ready` at 2,191 chars carrying a stale
`extract_error: The operation was aborted due to timeout`) belongs to 15.2-06, and **SC#3's XLS
half** to 15.2-07. Recovery spend: **$0** on extraction (pure `zip` rail).

PRIOR — Status (15.2-04): **THE HONESTY PLAN — three closes, no schema change, `pnpm-lock.yaml` untouched,
and STILL OFFLINE-ONLY (no upload re-run, no failure card ever viewed in a browser).** (1) **Stale
attempt state can no longer survive into a success.** `markExtracting` — which runs at the START of
every attempt, before any parsing — clears BOTH `failureReason` and `extractionTruncated`;
`markReady` clears **`failureReason` ONLY**. **THIS IS A DELIBERATE, DOCUMENTED DIVERGENCE FROM THE
LOCKED 15.2-CONTEXT WORDING** (*"markReady clears failureReason + extractionTruncated"*), which is a
DEFECT: `ingestExtractedText` writes `extractionTruncated` on the CURRENT attempt moments before the
ingest workflow reaches `markReady`, so clearing it there would erase a TRUE truncation flag on every
successful large-document ingest — and that flag is the only thing telling a downstream consumer the
grounded text is a head slice. Pinned by a named anti-regression test and written into the playbook
as a trap; **anyone "restoring" the spec's wording re-breaks truncation reporting for every large
document.** `markReady` keeps its half rather than relying on `markExtracting` alone because
`vaultIngestText`'s late-text `docId` seam reaches `processing` → `markReady` WITHOUT passing through
`markExtracting`. (2) **`extractGraph` is no longer the one uncapped model call in the repo** —
`GRAPH_EXTRACT_CHAR_CAP` (120_000) + `capGraphText` on the `@pikar/vault` barrel, applied as
`prompt: capGraphText(safeText)`. Ordering is **REDACT-then-CAP, never cap-then-redact** (the PII
scan must see the whole document or tail PII escapes both the scan and the audit counts) and the
SMOKE short-circuit stays ABOVE the cap. A test asserts `GRAPH_EXTRACT_CHAR_CAP <
VAULT_EXTRACT_CHAR_CAP` (400k) — the RELATIONSHIP is the point, because lowering the storage cap
under the graph cap makes the graph cap dead code. `ponytail:` ceiling — a HEAD SLICE, not chunk-wise
fan-out; tail entities in a very long document are MISSED and **nothing persists a "graph truncated"
flag** (no schema change permitted this phase). (3) **`apps/web/.../vault/failureCopy.ts` is the ONE
place a refs-only reason code becomes prose** — 21 codes → a plain-language title + an actionable
remedy, rendered on BOTH vault surfaces, and **the raw code is NEVER shown** (it rides in `title=`
only, §4). `PreviewModal`'s HARDCODED "scanned or image-only PDFs" sentence is DELETED — it was wrong
for most of 15.2-03's vocabulary (a legacy `.xls` is not an image-only PDF) — while the DOCV-01
no-voice clause and the Retry button survive; `DocGrid`'s failed card carries the title as one muted
ellipsis-truncated line. `unsupported_legacy_spreadsheet`'s remedy (*"open it in Excel and re-save as
.xlsx"*) is **what lets the SheetJS spike in 15.2-07 fail without taking SC#3 with it.** THREE
AUTO-FIXED DEVIATIONS, all from verifying the prior session's cut-off work before building on it:
**(a) the `failureCopy` import was MISSING from `PreviewModal.tsx`** — the three call sites were
written but the file could not compile, so the plan's own build gate would have failed on first run;
**(b) FOUR reason codes had no row** — the plan enumerated the extraction rail but not the TRANSCRIBE
rail's three honest endings (`no_audio_track_or_undecodable`, `transcribe_timeout`,
`transcribe_failed`) nor the legacy `not_implemented` that pre-3.8 rows still carry, and
`no_audio_track_or_undecodable` is the one worth distinguishing because a soundless screen-recording
is not a broken file and "re-save it" is a loop that cannot succeed; **(c) the source comment
described a `startsWith('extract_error:')` branch that does not exist** — the `Object.hasOwn` lookup
already misses and falls through to GENERIC, which is exactly what the branch would produce, so the
branch was deliberately NOT written (the 15.1-04 `?? "lean"` dead-branch lesson) and the comments now
say so. Two choices inside the plan's latitude: **the `DocGrid` failure line is card TEXT, not an
`aria-label`** — the card `<button>` has no aria-label, its accessible name IS its text content, and
adding one would REPLACE that name and take the filename with it (a net accessibility LOSS); and
**no unit test for `failureCopy`**, because `apps/web` has no unit-test runner (playwright only) and
adding vitest there is a `pnpm-lock.yaml` change in a tree with two other lanes merging — the map's
real risk is COVERAGE, verified by exhaustive grep over every `fail(...)`/`markFailed` producer and
pinned in the playbook table with the standing "you owe a row" rule. Gates: `@pikar/vault`
**114/114** (was 108), backend `vault.test` **28/28** (was 24), backend `tsc` **52 errors ALL in test
files, ZERO in any non-test file** (baseline unchanged), `pnpm --filter web typecheck` exit 0,
`pnpm --filter web build` GREEN, biome at the touched files' pre-existing CRLF baseline,
`check-playbooks` exit 0, and `git diff --name-only | grep -E "pnpm-lock|schema.ts"` returns **0**.
Environment: another lane committed into this shared tree mid-plan (`ead805f`, a 16/17 handoff doc,
landed between a `git status` and a commit) — harmless ONLY because every commit used the
`git commit -- <paths>` pathspec form. **DO NOT READ THIS AS A LIVE FIX.** SC#7 is the live gate, it
is 15.2-05's, and `vaultSweep:runSweep` has still not been run against any deployment.

PRIOR — Status (15.2-03): **THE UNBLOCK — the first plan of this phase to touch `convex/`, and it is STILL
OFFLINE-ONLY: no upload was re-run and the owner's stranded `.xlsm` has NOT been recovered.**
Three things landed. (1) **`vault.scheduleExtraction` is now the ONE scheduling decision**, the
`vaultIngest.startIngest` precedent applied to extraction: `vaultUpload`, the recovery sweep and the
user's Retry button all route through it, and all THREE copies of
`extractionKindFor(...) === null → schedule nothing` are DELETED. It schedules unconditionally
(`schedulingRailFor` is total by type) and it ALWAYS arms `internal.vaultSweep.watchdogStalled` at
`+EXTRACTION_WATCHDOG_MS` (15 min). Referencing `internal.vaultSweep.*` from `vault.ts` while
`vaultSweep.ts` imports `scheduleExtraction` from `vault.ts` is **NOT a module cycle** — `internal.*`
is codegen, not an import. (2) **`watchdogStalled` gives `pending_extraction`/`extracting` the
governor `processing` has had since the 2026-07-20 stranding fix**, and it is the SAME shape:
it flips ONLY a doc still at those two statuses, through `internal.vault.markFailed`, so a watchdog
firing one second after a success — or after an honest `unsupported_format` — changes NOTHING. It
deliberately does NOT cover `processing`: `onIngestComplete` owns that, and **two governors on one
status is a flip war**. It is a SCHEDULED FUNCTION, not a cron over a table scan, and that is
load-bearing: no "status began at" field exists, `createdAt` is UPLOAD time, so a `createdAt` cutoff
would kill a Retry on a 20-hour-old row on its first tick. (3) **The dispatch inside
`vaultExtract.extractDoc` now reads the BYTES** — `resolveRail(bytes, meta.mimeType, meta.title)`
after `ctx.storage.get`, the only runtime where that is possible — widening pdf/image/office/else
into pdf, image, zip, legacy_doc, legacy_ppt, legacy_xls, rtf, markup, text and an honest terminal
refusal. **`fail("unsupported_format")` has existed at that line since 03.8-02 and was UNREACHABLE;
it is reachable now**, which is the entire defect in one sentence. `legacy_xls` refuses with
`unsupported_legacy_spreadsheet` ON PURPOSE — a printable-run sweep over BIFF recovers the column
headers and silently loses every number, i.e. it fails PLAUSIBLY, which is the exact shape this
phase exists to remove (SheetJS is 15.2-07's, and this is why that plan can fail without taking
SC#3 with it). A new **`empty_extraction`** guard fails a 0-char extraction rather than storing a
`ready` document with no text. A sniffed image with a wrong/EMPTY MIME is sent with a REAL
`mediaType`, or SC#1 would "work" right up to the point the model call was silently malformed.
**SEVEN MUTATION-CHECKS, each confirmed applied before being trusted, each reverted green:** watchdog
arming disarmed ⇒ **4 RED**; `watchdogStalled`'s status guard removed ⇒ **3 RED** (ready, processing,
and the failed row's ORIGINAL reason); watchdog armed at +0ms ⇒ **1 RED**; **the CONTENT override
blinded (`resolveRail(new Uint8Array(0), …)`) ⇒ 10 RED** — the `.xlsm`, the renamed `.dat`, legacy
doc, RTF, HTML, JSON and the static scan, i.e. the original defect reproduced on demand; the
`empty_extraction` guard removed ⇒ **1 RED**; the unsupported branch made plausible ⇒ **3 RED**;
`legacy_xls` routed into `oleText` ⇒ **1 RED**. **THREE TESTS ACROSS TWO FILES ASSERTED THE DEFECT AS
A REQUIREMENT and were INVERTED, not worked around** — two in `vaultSweep.test.ts` (the plan named
these) and **one the plan did NOT name, in `vault.test.ts`** (*"an unrecognized binary (zip) stays
pending_extraction, nothing scheduled"*); left alone it would have gone red on `main` and read as a
regression in the fix. **TWO FIXTURES WERE CONTENT-LIES the sniff exposed:** the image test wrote
`"\x89PNG …"` as a JS string, and a Blob encodes `U+0089` as UTF-8 `0xC2 0x89` — decodable text, not
a PNG — so it honestly resolved to the `text` rail; and printable `SMOKE::extract::` bytes sniff as
`text`, so the audit `kind` on those rows is now `"text"`. Both were CORRECTED (real PNG magic; the
honest label), never suppressed — the sniff was right and the fixtures were wrong. Also fixed: my
own watchdog-delta assertion was a **1 ms flake** (`scheduleExtraction`'s two `runAfter` calls read
`Date.now()` independently — observed 900001 vs 900000), now a window. One deviation of ordering:
`watchdogStalled` had to land in **Task 1**, because `vault.ts` references
`internal.vaultSweep.watchdogStalled` and Task 1's own gate is a typecheck. The ZIP fixtures use a
~35-line STORE-method writer instead of `fflate`'s `zipSync`: **`fflate` does not resolve from
`@pikar/backend`** (it is a `@pikar/vault` dependency only — the arrangement that keeps it out of the
V8 bundle), verified with a throwaway probe, and adding a devDependency to build three fixtures is a
lockfile change to save thirty lines. Gates: `@pikar/vault` **108/108**, **backend FULL 47 files /
669/669 — fully green, the long-standing `audit.test.ts` red is GONE on merged `main`** (vault suites
are 98/98 of that), backend `tsc` **52 errors ALL in test files, ZERO in any non-test file**, biome
back to the file set's pre-existing baseline (1 finding, pre-existing), `check-playbooks` exit 0, and
`grep -c "kind === null" packages/backend/convex/*.ts` returns **0**. **ENVIRONMENT — THREE HAZARDS
FROM SHARING ONE WORKING TREE WITH TWO MERGING LANES, all observed, all cost time:** (a) uncommitted
edits under `packages/vault/` were **REVERTED by another session mid-plan** and had to be reapplied —
commit early, and re-verify a file after any pause; (b) `git commit -- <path>` fails outright with
*"cannot do a partial commit during a merge"*, which happened TWICE — a bounded poll on
`.git/MERGE_HEAD` is the cheap answer; (c) another lane's files sat **STAGED in the index**, so a
bare `git commit` would have swept them into a Lane V commit — every commit here used the
`git commit -- <paths>` pathspec form deliberately. **DO NOT READ THIS AS A LIVE FIX.** SC#7 is the
live gate, it is Wave 5's (15.2-05), and `vaultSweep:runSweep` has not been run against any
deployment.

PRIOR — Status (15.2-02): **EVERY FORMAT THE PURE LAYER CAN READ WITHOUT A NEW DEPENDENCY NOW ACTUALLY
READS — and again NOTHING LIVE WAS PROVEN: this plan touched ZERO `convex/` files by design and
added ZERO dependencies (`pnpm-lock.yaml` untouched).** `extractOfficeText` LOST its second
parameter — it takes the BYTES ONLY, unzips once, and dispatches on the MARKER ENTRY the archive
carries (`word/document.xml` → DOCX/DOCM, `xl/workbook.xml` → XLSX/**XLSM**, `ppt/presentation.xml`
→ PPTX/PPTM, a `mimetype` entry starting `application/vnd.oasis.opendocument.` → ODT/ODS/ODP,
`META-INF/container.xml` → EPUB; OOXML markers FIRST, with a test pinning that an archive carrying
BOTH a `word/document.xml` and an ODF `mimetype` resolves deterministically to DOCX). **The owner's
`.xlsm` needed NO NEW PARSER — only routing:** an `.xlsm` is byte-structurally an `.xlsx`, same zip,
same entries, same walker, which is why the defect looked far larger than it was, and why entry
dispatch makes coverage true BY CONSTRUCTION instead of by an enumeration that is always one format
behind. No marker at all now throws `office_parse_failed: unrecognized zip` — the message names the
ZIP, not a mime type, because there is no longer a mime type to name. The three `*_MIME` constants
are DELETED, and so is `docxText`'s `missing word/document.xml` guard, which entry dispatch made
UNREACHABLE (the 15.1-04 `?? "lean"` dead-branch lesson); `odfText`'s `missing content.xml` throw is
REAL by contrast — the ODF branch is gated on the `mimetype` entry, which does not guarantee
`content.xml` — so it moved UP into the dispatcher where it is still reachable and is pinned.
The two new walkers write NO second XML walker (rung 2): `odfText` and `epubText` reuse `rawRunsOf` /
`markupText`, and `runsOf` was split into `rawRunsOf` (undecoded) + `runsOf` (decoded) precisely so
the ODF walker can hand raw `<text:p>` runs to `markupText` without decoding entities twice.
`odfText` is ONE function for THREE formats: split on `</table:table-row>` and tab-join, else on
`</draw:page>`, else join `<text:p>` runs — chosen from what `content.xml` CONTAINS, never from the
declared `mimetype`. **NEW `packages/vault/src/rawText.ts`, dep-free and therefore ON THE BARREL**
(the same rule `sniff.ts` passed; `officeText.ts` stays subpath-only because it imports `fflate` —
state the RULE, not the current file list): `decodeEntities` MOVED here so there is exactly ONE
entity decoder for three callers; `markupText` removes script/style/comment **BODIES BEFORE** the
generic tag strip (strip tags first and you inline the script source as document text); `rtfText` is
a brace-DEPTH scanner, not a regex, because `{\*\...}` ignorable destinations NEST and a regex
cannot balance braces (flattening them would emit generator/font/colour tables as prose); and
`oleText` is the dependency-free half of SC#3 — maximal printable runs in CP1252 **AND** UTF-16LE,
merged in BYTE-OFFSET order (deterministic and roughly document-ordered), min run 4, a 13-name
stop-list matched on the **WHOLE RUN** (a substring rule would delete any sentence containing the
word "Data"). **`oleText` THROWS rather than returning `""`** — an empty extraction that "succeeds"
lands as a `ready` document with 0 chars, a plausible failure, which is worse than a failure; the
same one-line rule was extended to `rtfText`. `TextDecoder("windows-1252")` is constructed **LAZILY
inside the decode helper**, never at module scope: `rawText.ts` is on the barrel and that
constructor throws `RangeError` on a runtime without full ICU, so a module-scope throw would take
down every module that touches the barrel. **SIX MUTATION-CHECKS, each confirmed applied before
being trusted and each reverted green:** XLSM marker unhooked ⇒ **6 RED** (every XLSX/XLSM row incl.
the headline `.xlsm` routing test); `epubText`'s `.sort()` → `.slice()` ⇒ **1 RED**; `markupText`'s
script-body removal disarmed ⇒ **1 RED** (`alert(1)` leaked as text); stop-list removed + RTF
destination-skip disarmed ⇒ **3 RED**; `MIN_RUN` 4→1 ⇒ **2 RED**; `oleText`'s throw → `return ""` ⇒
**1 RED**. The last two are the load-bearing pair — together they prove the never-silent guarantee is
enforced by tests, not asserted in a comment. **KNOWN TRANSIENT, EXPECTED, DO NOT "FIX":**
`vaultExtract.ts:193` still calls `extractOfficeText(bytes, meta.mimeType)` and therefore FAILS
`@pikar/backend` typecheck until 15.2-03's first task; restoring an ignored second parameter to get a
clean tree mid-phase would reintroduce exactly the enumeration this plan deleted. Three deviations,
all recorded: `markupText` had to land in Task 1 (Task 1's `epubText` imports it, but the plan
scheduled `rawText.ts` in Task 2 — both halves still TDD, RED committed apart from GREEN); the plan's
`\x05`-strip before stop-list comparison was NOT implemented because `0x05` is not a printable byte,
so those runs already surface as the bare name and the strip would be a dead branch (the *test* still
plants the `\x05` prefixes); and `oleText`'s `kind` is unused (`_kind`) because the sweep is
format-agnostic and the stop-list is the union of both formats' names. **TOOLING TRAP THAT COST
REWRITES:** Bash heredocs in this environment HALVE backslashes even when quoted (`<<'EOF'`) — it
surfaced loudly in `rawText.ts` as an esbuild `Unexpected ")" in regular expression`, but the
matching damage in the TEST file would NOT have surfaced (a template literal containing `\r` is a
valid string), so it would have silently tested the wrong input. Separately the Write tool
JSON-decodes its content, so `\x05` in a source string literal lands as a literal control character.
**Do not use heredocs for backslash-bearing source in this repo.** Gates: `@pikar/vault` **108/108**
(was 77 — +17 officeText, +14 rawText), `tsc --noEmit` exit 0, `check-playbooks` exit 0, biome with
NO new findings (`officeText.ts`'s single format finding is byte-identical to the same finding on the
pre-change blob at `5d7e58e`), and both
`git diff 5d7e58e..HEAD --name-only | grep -c packages/backend/convex` and the same for
`pnpm-lock.yaml` return **0**. **DO NOT READ THIS AS A LIVE FIX.** `rtfText`/`oleText` have no
production caller, and `extractOfficeText`'s only caller is still on the old signature. SC#7 is the
live gate and it is Wave 5's.

PRIOR — Status (15.2-01): **THE ROOT CAUSE IS NOW UNEXPRESSIBLE IN THE TYPE SYSTEM, but nothing live was
proven — this plan touched ZERO `convex/` files by design.** Origin: a `.xlsm` sat at
`pending_extraction` ~20 h with 0 chars and no `failureReason`, because `extractionKindFor` returns
`null` for any MIME outside a three-entry allow-list and `null` schedules nothing. Two pieces
landed, both pure. (1) `packages/vault/src/sniff.ts` — dep-free and V8-safe, so unlike
`officeText.ts` it IS on the index barrel. `sniffContainer` is an offset-0 prefix table (3 ZIP
variants, OLE2, RTF, PNG/JPEG/GIF) → a BOUNDED `%PDF` search over the first 1024 bytes (leading junk
before `%PDF` is legal and happens; the window is what keeps a text file that merely *mentions*
`%PDF` from being read as one) → a UTF-8 text heuristic. **The heuristic uses `TextDecoder("utf-8",
{fatal:true})` with `stream:true`, and that is not decoration:** decoding a flat
`subarray(0,4096)` throws on any multi-byte character straddling byte 4096, which would report every
non-ASCII document over 4 KiB as binary. `stream:true` holds back the incomplete tail — the
stdlib answer rather than a hand-rolled trailing-byte trim — and it has its own test. BOM stripped
before counting, ≥95% printable required, empty input is `"binary"` and never a throw. `ole2Kind`
is an 8 KiB UTF-16LE needle scan over the directory stream names (`Workbook` checked BEFORE the
BIFF5 `Book`, which is a suffix of it), gated on the OLE2 header so it is honest standalone — this
is what tells a MIME-less `.xls` from a MIME-less `.doc`. `resolveRail` composes them with the
sniffed container as an **OVERRIDE AHEAD OF** the MIME/extension checks; `extractionKindFor` is
BYTE-UNCHANGED and survives as the FALLBACK behind it (rung 2 — the MIME table already exists, so it
is reused, not restated), which is why `image/webp` bytes the magic table does not enumerate still
reach the image rail. `video/*` resolves to `"unsupported"` **deliberately**: media is routed by
MIME at the SCHEDULING gate before any action runs, so anything reaching `resolveRail` as media has
already failed to be recognised as media, and failing honestly beats claiming a document rail.
(2) `schedulingRailFor` in `extractKind.ts` — `SchedulingRail = "transcribe" | "extract"`, three
lines of logic under a comment deliberately longer than the code. **`ctx.storage.get` is
ACTION-ONLY** (queries and mutations get `getUrl`/`getMetadata`), so a magic-byte sniff physically
cannot run at a scheduling site; rather than teach three mutations to guess, we schedule
permissively and let the one place that can read bytes decide — where
`fail("unsupported_format")` already existed at `vaultExtract.ts:200` and was, until this line,
UNREACHABLE. The owner's invariant is preserved and strengthened: an unresolvable format is TERMINAL
`failed`, never a silent `pending_extraction`; only its LOCATION moved, from the mutation to the
action. **TWO MUTATION-CHECKS, both confirmed present before being trusted and both reverted green:**
`PDF_SCAN_BYTES 1024→4` + `resolveRail`'s zip case → `break` ⇒ **2 RED**, exactly the junk-prefixed
PDF row and the SC#1 headline row (the `.xlsx` renamed `budget.dat` with an empty MIME fell through
to the MIME fallback and reported `"unsupported"` — the defect itself, observed); and
`schedulingRailFor` given back its old `if (k === null) return null` branch (needing an
`as unknown` cast, since the return type alone forbids it) ⇒ **3 RED**, including the ~20-row
property test. That second one is the load-bearing check: the property test is what fails if anyone
reintroduces "we don't know, so do nothing". Zero deviations — every interface the plan named was
where it said. Gates: `@pikar/vault` **77/77** (was 42 — +29 sniff, +6 scheduling), `tsc --noEmit`
exit 0, `check-playbooks` exit 0, biome clean on all five touched source files, and
`git diff --name-only | grep -c packages/backend/convex` returns **0**. **DO NOT READ THIS AS A LIVE
FIX.** No upload was re-run, no stranded row recovered, no rail exercised end to end; `resolveRail`
has NO production caller until 15.2-03 rewires the three `kind === null` sites
(`vault.ts:166`, `vaultSweep.ts:34`, `vaultSweep.ts:62` — the last being the user's Retry button,
where a press produced nothing observable). SC#7 is the live gate and it is Wave 5's, not this one's.

PRIOR — **PHASE 14 CLOSED — 2026-07-26 (9/9 plans, owner live human-verify APPROVED).** The flagship
voice-doc flow is verified on a REAL call: the agent discussed the uploaded report, a mid-call
drill-in returned a grounded answer from that document (proving the `search_document` relay reached
the model), and BOTH outcome paths landed — a memo saved to the vault AND a gap turned into a plan
that produced an email through the ordinary Approve gate. SC1/SC2/SC3 exercised end to end.

14-09 closed the SC4 half: the seven §4 static scans in `llmRedaction.test.ts` were shipped in
`0b6a1e9` labelled *"(pre-mutation-verification)"* — written but never proven able to fail — and are
now all mutation-verified (`f43bcba`), with the ledger in the test header. **The trap worth
remembering: in `docReviewSchema`, `properties` keys are indented 10 spaces and `required` 8, so a
literal-anchor mutation misses silently and reports a FALSE PASS.** Anchor on a regex.

**DELIBERATELY LEFT OPEN (do not fabricate either):** Open Question 3 — which tool-declaration branch
the API accepts — is **unrecoverable after the fact** (`toolsAtMint` is returned to the browser at
`voiceToken.ts:174-191` and never persisted; both branches are invisible in the UI). One line of
instrumentation settles it on any future session; `realtime.ts:107` names both routes. Retrieval
latency likewise unmeasured. Neither blocks anything.

**ENVIRONMENT — two traps that cost hours, both now recorded in `docs/playbooks/voice.md`:**
1. `pnpm start` serves a **FROZEN production build**. A live session read as a total grounding
   failure (a generic assistant: *"I can't access any knowledge vault"*) purely because the running
   bundle was compiled **4h14m BEFORE the first Phase-14 commit** — no picker, no `?doc=`, no
   `docId` at the mint, so no document scope. **Rebuild before any voice UAT and check the build
   timestamp against `git log` before believing a UI symptom.**
2. The local deployment's `packages/backend/.convex/local/default/config.json` had been deleted; the
   backend survived only because the running process held it in memory, so the break was invisible
   until a restart. Rebuilt from `.env.local` — and note `CONVEX_DEPLOYMENT`'s trailing
   `# team: … project: …` is a **dotenv COMMENT**, not part of the deployment name.
   `instanceSecret` legitimately falls back to the shipped public constant, so the file is
   reconstructible without inventing crypto.

**A LIVE `CONVEX_DEPLOYMENT` NOW EXISTS AGAIN** (local, `:3210`, functions pushed, skills seeded,
`document-analyst` active v1) — the "offline gates only" note below is SUPERSEDED.

PRIOR — Phase: 15.1 (Fact-Derived Tier & Conversational Onboarding) — **7 of 7 PLANS COMPLETE** (6 waves)
Current Plan: 7 (done)
Total Plans in Phase: 7
Plan: 15.1-07 COMPLETE (Wave 6 — both surfaces: the conversation and the facts).
Done: 15.1-01 … 15.1-07. Next: `/gsd:verify-work` on Phase 15.1.

**EXECUTION MODE: Phase 15.1 runs SERIALLY on branch `lane-a/dispatch-core` in
`.worktrees/lane-a-dispatch`.** No branch creation, no merges, no second session. There is NO live
`CONVEX_DEPLOYMENT` here: `npx convex dev|codegen`, `pnpm eval:golden` and Playwright all fail.
Offline gates only — `vitest`, `tsc --noEmit`, `check-playbooks.mjs`.

**THE DEPLOY BLOCK IS LIFTED.** Plans 03 and 06 warned that this branch must not be deployed before
plan 07, because `commitProfile` refuses until the tier facts exist and nothing called `converse` or
`saveFacts`. 15.1-07 closed that window: the onboarding page now runs the fact conversation and
writes the facts before the profile. First-time onboarding works end to end.

Status (15.1-07): **BOTH SURFACES LANDED, and the anti-manipulation mechanism is now visible to the
user instead of merely absent.** Plan 03 did design §9's subtraction; this plan supplies what
replaces it. THE ONBOARDING PAGE is a conversation in six steps: the three intake modalities (type /
upload / speak) still reduce to ONE `intakeText`, REUSED not rebuilt → `extractProfile` ONCE for the
narrative → the `converse` fact loop, where **the page never picks the next question and never
computes `done`** (it renders `reply` and a COUNT of what's left — never a checklist of slot names;
design §6 is a conversation, not a form wearing chat's clothes) → agent identity → the closing beat →
commit. **THE CLOSING BEAT COSTS A SECOND `converse` CALL, and that is the plan's substantive
decision:** `converse` derives `nextSlot` from the slots it was GIVEN, so the turn that finally
completes the set is still under `Next fact to obtain: <last>` and its reply is an acknowledgement.
Re-asking with the COMPLETED slots is what puts the registry prompt on its *"nothing left to obtain —
this turn is the closing beat"* branch. Using the acknowledgement instead would have been one call
cheaper and would have silently deleted §6's whole point (*"a tailored experience the user cannot
perceive is not a selling point"*). The wording stays the MODEL's throughout — a sentence composed in
the page would be prompt content in source (§5) and would drift from the skill body; if the second
call throws, the acknowledgement stands and the user is not stranded. A `ponytail:` comment names the
ceiling and the upgrade path (teach `converse` to report a post-merge closing instruction, then
delete the second call). **COMMIT ORDER IS `saveFacts` THEN `commitProfile`, and it is LOAD-BEARING,
not stylistic** — `commitProfile` reads `tenantProfiles` to splice the tier into the markdown
projection and refuses without a row, so reversing the two fails every first-time onboarding at its
last step; it is now a playbook invariant. The draft key is bumped to
**`pikar:onboarding-draft-v2`** carrying slots + transcript + identity, and an unknown version is
**DROPPED, never migrated** (a v1 draft carries a `persona` and no slots — rehydrating it resumes a
conversation whose facts were never asked, i.e. defect 1a in a resumability costume). THE PROFILE
PAGE is the FACTS surface: two cards, two writers. Business shape (five facts — digits-only numbers,
two `<select>`s over the closed unions — plus agent name and preset) → `saveFacts`, which RE-DERIVES
the tier; the narrative → `updateProfile`. **The tier renders as TEXT** with `TIER_REASON`,
`tierSource` in plain words and one line saying the facts are what move it — **never a disabled
control, because a greyed-out picker still reads as "there is a control here"**. A tier move is an
`role="status"` EVENT driven off `saveFacts`'s own `changed` flag, never a client-side diff of what
the page happens to be rendering (design §9: *"tier change is a moment, not a setting"*). Design §10's
legacy invitation is INLINE and non-blocking — never a modal, never a redirect, never a gate, because
`onboarding.status` deliberately still returns `needsOnboarding: false` for those tenants. Both
refusal codes render as recoverable gaps in the user's own language; a raw slot name or error code is
never shown. **THE SC#1c SCAN WAS RE-ARMED, not assumed** — plan 03's mutation targeted markup that
no longer exists in either file, so against rewritten source it would have been a no-op reporting
CLEAN. It went 9 → 14 rows: four NEW per-page anchors (`api.onboarding.converse` +
`pikar:onboarding-draft-v2`; `api.tenantProfile.saveFacts` + `TIER_REASON`) because the shared
`api.onboarding` anchor would survive reading the SAME file twice; a property-position
`tier:`/`persona:` rule; a runtime-`TIERS`/`PERSONAS`-import rule (the `Tier` TYPE is fine — a type
cannot be mapped over to render pills); a widened, CRLF-safe interactive-line scan; and **a POSITIVE
row asserting the `BEHAVIOR_PRESETS` group is still present**, which is what makes the set honest —
rows 1-4 are all `not.toContain` and a page with NO controls would satisfy every one of them. The
scan DISTINGUISHES rather than forbids: the vocabulary a control iterates is the discriminator, so
the legitimate preset radio group is not collateral damage. MUTATION-CHECKED with a CRLF-aware script
that exits non-zero on `NO MATCH` and re-reads the file to confirm the mutation applied: a planted
`<button onClick={() => saveFacts({ tier: "sme" })}>` ⇒ **2 RED, profile page only** (the onboarding
rows correctly stayed green); reverting restored **14/14**. Three auto-fixed deviations: the plan's
`role="radio"` group tripped `useSemanticElements` AND had no keyboard navigation (→ a native
`fieldset`/`legend` + `input[type=radio]`, which supplies checked state, group semantics and arrow
keys from the platform — ponytail rung 4); the new `tier:` rule first false-positived on
`{tierRow ? tierRow.tier : "—"}`, a ternary's colon in the read-only render (→ anchored on PROPERTY
position, because the obvious response to a rule that fires on correct code is to loosen it until it
stops, and a rule loosened under that pressure stops guarding); and the playbook still described the
persona confirm/change control plan 03 DELETED, in both Purpose and the frontend key-file bullet.
**A MEASUREMENT ERROR worth carrying forward:** `grep -c $'\r' <file>` under Git Bash here returned a
count EQUAL to the line count for three files — it matched every line — and I briefly concluded both
pages were CRLF; node's `(s.match(/\r\n/g)||[]).length` said 0. Nothing downstream was affected only
because the mutation script derived its EOL from the file rather than trusting that reading. **Do not
measure line endings with `grep -c $'\r'` in this worktree.** The four VALIDATION Manual-Only rows are
recorded as runnable debt with exact commands in the phase's `deferred-items.md` §2, explicitly NOT
to be conflated with Phase 15's still-unpaid specialist-body eval gate. Gates: `apps/web` typecheck
**exit 0**, @pikar/core **282/282** (was 277), the SC#1c scan **14/14**, onboarding+tenantProfile+
profileRedaction **45/45**, backend FULL **585/586** (the EXACT plan-06 number, sole red the
documented `audit.test.ts` `auditCounts` row), backend `tsc` at the EXACT **55**-error test-file
baseline with ZERO in any non-test file, turbo **8/10**, `check-playbooks` exit 0, `biome` with **no
NEW findings** on either page (baselines measured at the real path on the HEAD blobs; the remaining
`format` on the profile page is the documented CRLF carry-forward, proven non-vacuously by
LF-normalizing and re-running `biome format` with **byte counts printed** — 27343B vs 27343B, diff 0),
and `git diff --name-only -- packages/backend/` returns **ZERO files** — this plan is client-side
only, as specified. **Note:** `requirements mark-complete ONBD-01 ONBD-02` returns `not_found` for
both; they are already `[x]` Complete in REQUIREMENTS.md (lines 118-119, 238-239). Pre-existing tool
noise, nothing lost.

PRIOR — Status (15.1-06): **Onboarding stopped GUESSING the persona from prose and started ASKING — and the
two properties that make that true live in CODE, where a model's temperature cannot reach them.**
`onboarding.converse` is ONE `generateObject` turn returning
`{reply, slots, missing, nextSlot, done}` — a `tenantAction`, STATELESS, writing NOTHING (no row, no
audit, no telemetry, no dead letter; pinned by a before/after row-count assertion). **`nextSlot` is
`missingSlots(slots)[0]` in `REQUIRED_SLOTS` order and `done` is `canComplete(slots)`, never read off
the model** — a reply announcing "your onboarding is complete!" leaves `done: false` and `missing`
non-empty, and the non-vacuity turn says the OPPOSITE ("one more thing to check") while going
`done: true`, so the flag is demonstrably not being read from the text. The system prompt is the new
UNGATED `onboarding-agent` registry row (Q6), shipped through the FULL 5-file mirror and loaded
**FIRST, before the `SMOKE::onboard::` short-circuit** — the `extractProfile` ordering — so the §5
fail-closed read is exercised on the offline path too (SC#3c). THE SPLIT that keeps §5 satisfied
while the guarantee stays in code: the CODE supplies the slot NAME and its permitted shape
(`SLOT_SHAPE`, one terse definition per slot, the two enums listing their literals per Q7); the BODY
supplies the words, and deliberately does NOT enumerate the enums, so the closed union has exactly
ONE home. **The merge's admission test IS the completion predicate** —
`!missingSlots({[slot]: value}).includes(slot)`, reuse rather than a second copy of the presence
rules — so "was it merged" and "does it still count as missing" cannot disagree; `headcount: 0`
merges as an ANSWER and an off-union enum is DROPPED, never coerced. `turnSchema` is `jsonSchema`
(never zod — this V8 module stays off the inference cliff), STRICT, encoding "not learned this turn"
as an explicit `null` because strict mode requires every property in `required`. **Q1 HONOURED
LITERALLY:** `llm.ts` and `schema.ts` are BYTE-UNCHANGED (`git diff --exit-code`, both hard gates),
no new `agentSteps.tool` literal (the only occurrences are in the `ponytail:` comment explaining why
one was not added), no `"use node"`. The ceiling comment names the REJECTED alternative and its three
concrete blockers — `runAgentLoop` takes a mandatory `planId` and `plans.byThread` is `.unique()`;
`toolNames` FILTERS `buildCockpitTools` and cannot ADD; a new tool name needs an `agentSteps.tool`
literal or the trace insert throws inside an SDK callback the SDK SWALLOWS (blank activity card in
prod, every test green) — plus the cost (no CKPT-05 activity trace, no shared cost rail) and the
upgrade path. FOUR mutation-checks, every script CRLF-aware and exiting non-zero on `NO MATCH`, each
confirming the mutated text was present before trusting the result: moving the SMOKE short-circuit
above the skill load ⇒ **1 RED, exactly SC#3c**; `done` read off the reply ⇒ **2 RED**; `nextSlot`
following the model's order ⇒ **1 RED**; a one-char `.md` edit ⇒ **1 RED**, exactly the drift row.
**ZERO deviations** — every interface the plan named was where it said, and the `_generated/api.d.ts`
hand-edit was NOT needed (`converse` is a new export on an EXISTING module; `api.d.ts` enumerates
modules, not functions). **The one thing that nearly went wrong is the Wave-4 lesson repeating:** the
first biome verification loop wrote its normalized copy to `/tmp`, which does not exist under Git
Bash here, so both sides of the comparison were empty and all three files reported "CLEAN" — a check
that could not fail. Re-run from the scratchpad with the byte count PRINTED, it found the one real
diff (a pre-existing untouched `test.each` signature). Gates: contracts **17/17**, @pikar/core
**277/277**, `onboarding`+`profileRedaction` **26/26**, those two plus `skills`+`tenantProfile`
**87/87**, backend FULL **585/586** (sole red the documented `audit.test.ts` `auditCounts` row — the
multi-file flake did NOT reproduce), backend `tsc` at the EXACT **55**-error test-file baseline with
ZERO in any non-test file, `apps/web` typecheck exit 0, turbo **8/10**, `check-playbooks` exit 0, and
`git diff --stat` shows exactly the 9 owned files — `dispatch.ts`, `evaluations.ts`,
`tenantProfile.ts` and `apps/` all absent.

PRIOR — Status (15.1-05): **The tier is now PERCEIVABLE: a dispatched specialist is told, as a FACT in every
run, what shape of business it is advising — so a solopreneur's `money-model-designer` cannot propose
hiring (design §8.1).** Three parts. (1) THE VOICE, registry-owned: three UNGATED skills
`style-direct` / `style-coaching` / `style-concise`, one per `BEHAVIOR_PRESETS` member, shipped
through the FULL 5-file mirror (`.md` → derived `.ts` → `skill.ts` constant → `seedSkills` row →
`skillBodies.test.ts` drift row). The preset is a CLOSED ENUM mapping to a versioned row,
deliberately NOT a free-text box — user text injected into every future system prompt is a standing
prompt-injection surface and smuggles unversioned prompt content into every call (§5). Each body
STATES that it is a style overlay that never changes what the agent may do, claim, or ground and that
the agent's own instructions win on conflict (a directive that could widen capability would be
privilege escalation through a DB row, ADR-007's reasoning); no tool names, no capability language,
and NO tier language — presets and tiers are ORTHOGONAL, so there are three overlays, not nine
cross-product variants. UNGATED is Q6, LOCKED, matching `business-profile`, and the rationale sits as
a comment ON `GATED_SKILLS` because that is where someone would "fix" it. (2) THE FACTS,
code-owned: `tierBriefing({tier?, agentName?, styleDirective?})` in `packages/core/src/specialists.ts`
— pure, Convex-free, emitting `Agent name: <sanitized>` / `Business tier: <tier> — <structural
consequence>` / the directive body, each line OMITTED when its input is absent and `""` when nothing
is known. `TIER_FACT` is a `satisfies Record<Tier, string>` TABLE, never a switch/ternary (the
`armFor` lesson). An ABSENT tier yields NO tier claim — never an invented `solopreneur`, which is the
exact defect class this phase exists to close. `agentName` is sanitized INSIDE the function, so there
is exactly ONE place a user-authored string reaches a prompt. The code-owned/registry-owned split is
ADR-007's restated: the FACTS are the `TASK_LINE` class (driver-plane, not a skill), the VOICE is the
registry row. (3) THE WIRING: `buildSpecialistPrompt` reads `internal.tenantProfile.forTenant` +
`PRESET_SKILL[preset]` and PREPENDS the briefing on BOTH return paths — a tenant with no evaluation
snapshot still has a tier. The style read FAILS OPEN (an unseeded overlay costs voice, never a
dispatch) while the specialist BODY loader in `runSpecialistTurn` stays fail-CLOSED; mutation-checked
by making the `catch` rethrow. **THE HEADLINE LESSON — a mutation-check that does NOT go red is a
finding about the TEST.** The plan's own SC#5b assertion (`Set` over `TIERS.map(tierBriefing)`) stayed
**34/34 GREEN** with `startup`'s clause copied byte-for-byte from `solopreneur`'s, because the block
interpolates the tier NAME, so any two briefings differ by the label alone regardless of substance —
it proved only what the neighbouring test already proved and would have passed forever if every tier
got identical advice. Fixed by MASKING the discriminator (`.replaceAll(t, "<TIER>")`) before
comparing; the corrected form goes RED on that mutation and the observed vacuity is recorded in the
test comment. Two further auto-fixes: my insertion stranded `specialistMemoBody`'s jsdoc above
`PRESET_SKILL` (moved back), and two mutation scripts silently NO-OP'd because `dispatch.ts` is CRLF
in this worktree (`core.autocrlf=true`, 460 CRLF / 0 bare LF) and a `\n`-spanning pattern matches
nothing — now CRLF-aware with a loud `NO MATCH` + `exit 1`, because a mutation that never applied
reports a guard as proven when nothing was tested. **ADR-009 HELD, and it stays LOCKED:** `llm.ts` is
BYTE-UNCHANGED (`git diff --exit-code`, a hard gate), the router is not forked, `SPECIALISTS` gained
no filter layer and no per-tier grant, `diagnose()` was not widened, and `financialsPresent` still
picks the rubric (Q3). **A verifier must NOT read SC#5 as "the offer set is filtered" or "the rubric
pick changes"** — nothing about `evaluations.gaps.length`, `Prescription.route` or `PERSONA_FRAMEWORK`
moves. ADR-009 gains an implementation NOTE (permitted extension, §9); it is not re-decided.
`buildSpecialistPrompt` is exported ONLY for the test — driven through `t.run`, whose ctx DOES expose
`runQuery` (probed first), so the REAL internal queries run rather than the plan's fallback stub,
which would have been a second implementation free to drift. Gates: contracts **16/16**, @pikar/core
**277/277** + `tsc` exit 0, `skills.test.ts` **42/42** with three more seed rows,
dispatch+dispatchGuard+gapAction **45/45**, backend FULL **577/579** (the documented `audit.test.ts`
red + `voice.test.ts`, the latter 8/8 GREEN in isolation = the documented flake), backend `tsc` at the
EXACT **55**-error test-file baseline with ZERO in any non-test file, `apps/web` typecheck exit 0,
turbo **8/10**, `check-playbooks` exit 0, and `git status` proves `diagnose.ts`, `evaluations.ts`, the
three specialist bodies and `apps/` are ALL untouched.

Status (15.1-04): **The evaluation engine picks its rubric from the `tenantProfiles` ROW, not from a
string matched out of markdown — so a `business_profile` doc with a garbage `Persona` line can no
longer silently reclassify a tenant, and a new tier literal is now a COMPILE error rather than a
silent fall-through to `lean`.** This is the READ-side twin of 15.1-03's write-side subtraction;
together they close defect 1d. `PERSONA_FRAMEWORK` became `TIER_FRAMEWORK`, bound
`as const satisfies Record<Tier, Framework>` with `enterprise → swot` (operator-granted, D6, so an
SME-shaped rubric is the honest default rather than a fourth rubric nobody wrote), and
`runEvaluation` reads `internal.tenantProfile.forTenant({ tenantId })` ONCE beside the carry-forward
read — the `vaultGroundHydrated` explicit-`tenantId` convention, because the action carries no live
identity. **`personaHint` is DELETED** — it was the LAST authoritative reader of the markdown
persona, which is exactly what makes design §4.2's claim true that `deserializeProfile`'s
`"solopreneur"` fallback *"stops being a silent reclassification risk once nothing authoritative
depends on it"*. The fallback itself is UNTOUCHED and deliberately retained as a display convenience
(`getProfile` still pre-fills the profile page's edit form from stored markdown and must not throw on
a garbled line); the `text.includes("- **Persona:**")` block also SURVIVES, with all four `fillVault`
calls, because those are CONTENT fills (name/niche/avatar/offers) and the block is the profile-doc
DETECTOR — only the AUTHORITY was removed, and a source comment now says the line "selects no
behaviour" so a later edit does not re-create 1d. The trailing `?? "lean"` was **dropped, not kept
for safety**: with an exhaustive `satisfies` bind indexed by a `Tier` narrowed through
`?? "solopreneur"`, the lookup is total and the `??` would be a branch that can never be taken (the
Phase-15 `armFor` lesson) — and the mutation-check proves the payoff, because deleting
`enterprise: "swot"` now fails at BOTH the map (`TS2741`) and the INDEX SITE (`TS7053`); with the
fallback still present the index would have compiled and silently produced `"lean"`, the same defect
class one layer up. **Q3 is UNCHANGED and LOCKED**: `financialsPresent` still overrides with
`growth-os` (financials mean a growth-os diagnosis is actually possible), the tier's perceivable
effect lands on the specialist prompt / voice (ADR-009, plan 05) and NOT on the rubric, and this is
now recorded verbatim as a source comment, a pinned test, and an invariant in BOTH playbooks — **a
verifier must NOT read SC#5 as "the rubric must change" or "the offer set is filtered."** SC#2b is
proven by driving ONE byte-identical malformed document (`- **Persona:** wizard`, which `isTier`
rejects, with no financial figures) at TWO different table tiers and demanding TWO different
frameworks (`sme→swot`, `startup→bmc`) — a single-tier test would pass whenever the old fallback
happened to agree. Both were CONFIRMED RED first, returning `"lean"` — the defect itself, observed.
The no-row default (`lean`) and the Q3 override are pinned as separate tests, and the `.replace()`-
built fixture carries a non-vacuity guard so a serializer format drift fails loudly instead of making
all four pass for the wrong reason. **Zero deviations** — every interface the plan named at a line
number was exactly there, and 15.1-02's git-ignored `_generated/api.d.ts` hand-edit was still in
place so `internal.tenantProfile.forTenant` resolved in types on the first try. Gates: the SC#2b set
**5/5**, `evaluations` **23/23**, `evaluations`+`proactiveReview`+`gapAction` **36/36**, backend full
**573/575** (the documented `audit.test.ts` red plus one flake — `gapAction.test.ts`, 5/5 in
isolation), backend `tsc` at the EXACT **55**-error test-file baseline with ZERO in `evaluations.ts`,
`apps/web` typecheck exit 0, turbo **8/10** baseline, `grep personaHint` empty, and `git diff` shows
exactly the 4 owned files — `llm.ts` / `dispatch*` / `onboarding.ts` / `apps/web` /
`packages/contracts` / `skills.ts` all absent. **NEW CARRY-FORWARD:** `biome check` reports a
`format` error on `evaluations.ts` / `evaluations.test.ts`, and it is PRE-EXISTING, not this plan's —
the worktree has `core.autocrlf=true` so git-checked-out files sit on disk as CRLF while biome wants
LF; byte-untouched `dispatch.ts` fails identically and the pristine HEAD blob passes. Files a prior
agent REWROTE (`tenantProfile.ts`, `onboarding.ts`) are LF and pass. Do not "fix" it — normalizing
line endings is a whole-file diff for zero behaviour change, and commits are unaffected (git
normalizes on write).

PRIOR — Status (15.1-01): **The tier stopped being a model-temperature guess, and D6 became a compiler
error rather than a review note.** Four shared seams landed in ONE commit-set so plans 02-07 FILL
them rather than reshape them (the Phase-15 15-01 precedent). (1) THE RULE: `deriveTier` in
`packages/core/src/businessProfile.ts` — `paidStaff === 0 && headcount <= 2` ⇒ solopreneur; else
not(`steady-revenue` AND `bootstrapped`) ⇒ startup; else sme. Total by construction over CLOSED
unions (`REVENUE_STAGES`/`FUNDING_STATES`, owner Q7 — a free string here reintroduces the
string-matching defect class the phase exists to close), proven at runtime by a 135-case
cross-product sweep that is NON-VACUOUS because it enumerates from the exported unions. Branch ORDER
is load-bearing (solo test FIRST, so a pre-revenue one-person business is a solopreneur, not a
startup) and has its own boundary row. `yearsOperating` is CAPTURED but deliberately unused, pinned
by a test so nobody "fixes" the omission. Thresholds are a PRODUCT call retuned via the test's
boundary table, NEVER a config row — a DB-tunable threshold makes the tier DB-writable by proxy,
which D2 forbids. (2) **D6 IS A TYPE**: `DerivedTier` (= `Persona`, 3 members) vs `TIERS` (4,
`enterprise` included); the `@ts-expect-error` bind was MUTATION-CHECKED (marker removed ⇒
`TS2322: Type '"enterprise"' is not assignable to '"sme"|"solopreneur"|"startup"'`; restored ⇒ exit
0), and so was the boundary (`<= 2` → `< 2` ⇒ 2 rows RED, restored ⇒ 254/254). (3) THE SLOT GATE:
`REQUIRED_SLOTS`/`missingSlots`/`canComplete` test numbers for FINITENESS, never truthiness — `0` is
an ANSWER, and a `!value` check would make the design §6 conversation uncompletable for exactly the
solo founder the phase is about; an off-union enum value is MISSING, never admitted.
`sanitizeAgentName` (40-cap, `\p{C}` strip incl. Cf bidi/zero-width, collapse, trim AFTER the slice)
is the trust boundary for a name that rides into a model prompt in 15.1-05. (4) THE TABLE:
`tenantProfiles` + `by_tenant` in `schema.ts` — facts ALL optional and NEVER narrowed (a `legacy`
backfill row has none and design §10 forbids forced re-onboarding, so the "narrow" half of
widen-migrate-narrow is deliberately never taken; completeness lives at the WRITE boundary), while
`tier`/`tierSource`/`derivedAt` are REQUIRED so a half-written row cannot become a silent
"solopreneur". `Doc<"tenantProfiles">` resolves with NO codegen (non-vacuity confirmed by a rename
probe ⇒ TS2344). `watch.json` pre-registers `convex/tenantProfile.ts` + its test BEFORE plan 02
creates them, so the Stop hook cannot block that plan. **ADR-009** pins the Q2 deferral: `diagnose()`
returns at the first failing gate and emits ONE prescription (`diagnose.ts:32-179`), so
`leverageRank([prescription])` (`evaluations.ts:324-325`) sorts a single-element array — a tier
filter over a set of one can only REJECT, and a rejected route lands on the deterministic `buildMemo`
fallback (`evaluations.ts:685-692`), a downgrade wearing tailoring's clothes. **A verifier must NOT
read SC#5 as "the offer set is filtered" or "the rubric pick changes"**; Q3 stands
(`financialsPresent`, `evaluations.ts:286-295`, correctly keeps overriding the framework pick).
Deviations: 1 auto-fixed (Rule 2 — `businessProfile.test.ts` added to `watch.json`, since it now
carries the D6 bind and the boundary table and was otherwise unprotected). Gates: @pikar/core
**254/254** + `tsc` exit 0 with the `@ts-expect-error` in place, `convex/tenant.test.ts` 4/4, backend
`tsc` at the EXACT **55**-error test-file baseline with ZERO in `schema.ts`, `check-playbooks` exit 0,
turbo **8/10** baseline, and `git diff` proves `onboarding.ts` / `evaluations.ts` / `llm.ts` /
`dispatch.ts` / `apps/web` are ALL untouched — this plan is a freeze, not an edit. **NEW CARRY-
FORWARD:** the backend FULL suite is FLAKY here (6-7 failures, a different set each run, all
`Component "<rateLimiter|auditCounts>" is not registered`); every file passes in ISOLATION and the
sole genuine red remains the documented `audit.test.ts` `auditCounts` row. Logged to
`.planning/phases/15.1-.../deferred-items.md` — do not read a noisy full-suite number as a regression.

PRIOR — **EXECUTION MODE (owner decision, 2026-07-25): Phase 15 ran SERIALLY**, all 6 plans, in
`.worktrees/lane-a-dispatch` on branch `lane-a/dispatch-core`. No Lane B session, no concurrent
Phase-15 lane, no merges to `main` mid-phase. `PARALLELIZATION.md`'s Phase-15 lane table was
finalized anyway and is retained as the FILE-OWNERSHIP CONTRACT (which plan may touch which file)
— that still holds, and is what keeps 15-05's executor work from colliding with 15-02/03/04's
dispatch work even with one agent doing both.

Status (15-06): **The three specialists now instruct their own grounding through the one tool they
have — and the gate they must ride is UNPAID, so the phase ships dark.** All three bodies
(`offer-architect` / `money-model-designer` / `lead-engine`) carried 12-02's placeholder framing
*"Registered now; a full build runs later"* — honest when written, FALSE the moment 15-03 shipped
dispatch. Each `.md` (+ its byte-identical derived `.ts`; `skillBodies.test.ts` green) now drops it
and gains a **`## How to ground this`** section naming `searchVault`. That is the material change:
every body already ended with *"Cite the user's own material for every claim"* and the specialist
had NO retrieval tool until this phase, so the instruction was literally unsatisfiable. Three
properties are deliberate — the tool is NAMED not implied; the READ-ONLY posture is stated in prose
(*"You cannot send anything, save anything, or change the plan"*), reinforcing at the PROMPT layer
what `SPECIALIST_TOOLS` enforces STRUCTURALLY (ADR-007); and not-enough-data is an AFFIRMATIVE
answer, tuned per body (money-model: invention does the most damage on NUMBERS; lead-engine:
channel advice is worthless when guessed). METHOD content untouched, and each body's financial-spine
deferral now says it never restates a figure the evaluation did not ground. THE RUNNER: `SKILL_NAMES`
was a hardcoded three that excluded `reply-drafter` AND all seven Phase-12 skills — **eight of eleven
gated skills were unpinnable and `--skill offer-architect@N` THREW**, i.e. this plan could not have
run its own gate under the old runner. It is now DERIVED from `GATED_SKILLS`, read off
`packages/contracts/src/skill.ts` (the runner is plain `.mjs`; the `specialists.test.ts`
scan-the-source precedent), so a newly gated skill is pinnable the day it is gated with no second
list to drift. `--skill` is now MULTI-pin: every occurrence collected, the merged record threaded on
EVERY turn, evidence recorded ONE ROW PER PIN off the SAME run (each carrying the full merged
`skillVersions`), a repeated NAME rejected outright. THE FIXTURES: a new `actOnGap: <gapIndex>` field
taps the gap after the turns through `evaluations:actOnGapInternal` — an identity-less twin over a
SHARED `applyActOnGap` (the 12-04 `recordScorecardAnswerInternal` precedent; `npx convex run` carries
no auth identity), so the fixture drives the REAL path and not an imitation — then POLLS
`plans:getById` out of `collecting`, which is the right signal precisely because
`landSpecialistResult` lands in a `finally` on every outcome. Three new closed-vocabulary keys:
`planKind` (+ `status: proposed` = the collecting→proposed flip), **`attributionRoute`** (the one
that DISCRIMINATES — the fallback memo reaches `proposed` with `kind: "memo"` too, and `--self-check`
asserts exactly that before asserting the fallback FAILS attribution), and **`citesVaultDoc`**, which
probes the seeded corpus NEEDLE `evalgrd` rather than a vault title root: a title root ("Northwind")
is echoed straight out of the fixture's own turns, so it would pass with or without a search —
`validateFixture` now FORBIDS any turn from containing the needle. 12-06's pair-every-zero-count
lesson is enforced STRUCTURALLY, not by discipline: `actOnGap` requires `expect.gapCount > actOnGap`
and every dispatch observable requires `actOnGap`. Three fixtures added (29 gate-1 no offer, 30
gate-2 one offer type, 31 gate-3 no channel — three DIFFERENT routes, so `attributionRoute` cannot be
satisfied by one hardcoded string), floor 27 → 30. Three self-check assertions mutation-checked
(re-hardcode `SKILL_NAMES`, force `citesVaultDoc` true, drop the duplicate-pin guard → all RED),
reverted. Deviations: 3 auto-fixed — the plan's fixtures were UNBUILDABLE without a callable tap
(Rule 3 → `actOnGapInternal` over a shared helper, zero behaviour change, 54/54 dispatch-side tests
green unchanged); `citesVaultDoc` as literally specified would have passed VACUOUSLY (Rule 1 →
needle probe + validator rule); and `attributionRoute` was first validated against `GATED_SKILLS`,
which accepts `swot` — a gated skill no gap can ever dispatch to (Rule 1 → a second source
derivation of `SPECIALIST_ROUTES`; gated ⊃ dispatchable). **UNPAID GATE (carry-forward):**
`pnpm eval:golden` was NOT run — this worktree has no `CONVEX_DEPLOYMENT` (15-01 bootstrapped it with
a COPIED `_generated`). Nothing faked, no fixture weakened, nothing hand-activated. SHIP DARK per
CONTEXT: the candidates park, the ACTIVE v1 bodies stay live (so a dispatched specialist today still
runs the OLD body), and Phase 15's five success criteria are proven by 15-01..15-05 — none of them
requires a rewritten body. Gates: contracts 13/13, backend **544/545** (sole red the documented
`audit.test.ts` `auditCounts` row), @pikar/core 223/223, `--self-check` exit 0 (30 fixtures, 11
derived gated skills), backend `tsc` at the exact pre-existing baseline with ZERO in any non-test
file, `apps/web` typecheck exit 0 (Pitfall-4 tripwire held — explicit `Promise<ActOnGapResult>`),
turbo 8/10 baseline, `check-playbooks` exit 0, and `git diff` proves `cockpit.ts`,
`deliverApprovedPlan.ts`, `actionType.ts` and `apps/` all untouched.

PRIOR (15-04): **"Act on this" RUNS the specialist, and the phase's user-visible claim is one
test.** `actOnGap` stays a `tenantMutation` (a Convex mutation cannot call an action, and converting
to a `tenantAction` would make the `resetPlan`+`patchPlan` recycle interruptible while STILL leaving
the card blank for 30s) and now has TWO terminals chosen by a RUNTIME `resolveSpecialist(gap.route)`
at the entry point: a REGISTERED specialist stages `status: "collecting"`, `kind: "memo"`, subject
set, **`body: ""`** and schedules `internal.dispatch.runSpecialist`; `""` (diagnose()'s ask branch)
and `"scale"` (its healthy branch) keep the 12-05 memo at `proposed` with NOTHING scheduled — the
honest terminal when there is nothing to run, and the fail-closed guarantee now sits in front of the
scheduler as well as inside the dispatcher. **The Approve race is closed BY CONSTRUCTION, not by a
new guard:** `executePlan` has always returned `alreadyStarted` for any non-`proposed` row
(cockpit.ts:530), so a `collecting` plan is un-approvable — proven (executePlan on the staged row
persists ZERO vault docs, ZERO requests rows, no CAS flip), with NO new status literal and **zero
`apps/web` edits** (`PlanCard` renders only at `proposed`, cards.tsx:1624, so a `collecting` plan
already shows nothing and the CKPT-05 trace step is the progress indicator). `rootRequestId` is
minted fresh per call and the test proves it cannot be `planId`: two `actOnGap` calls on one thread
queue two jobs with an IDENTICAL `planId` (the row is RECYCLED, 12-05) and DIFFERENT roots — exactly
what ADR-008 forbids collapsing. `internal.evaluations.landSpecialistResult` (an explicit-tenantId
`internalMutation`, the 12-04 `recordScorecardAnswerInternal` precedent) is the ONLY writer of a
dispatched body and CASes three ways — wrong tenant, not `collecting`, not `kind: "memo"` ⇒ no-op
(mutation-checked: deleting the status check lets a finished run clobber a CANCELED plan's own
draft). `dispatchAndLand` wraps `governedDispatch` and lands in a **`finally`**, the same construct
that terminalizes the `agentSteps` row, so "the plan always leaves `collecting`" is unconditional
across success, an overrun, all four governed refusals AND a throw — a row stuck at `collecting`
renders no card at all, i.e. the user's tap would silently have done nothing. Both entry points call
it, so the landing cannot be true in tests and absent in prod. Success ⇒ the body STARTS with
`> Produced by the **<route>** specialist.`; an overrun ⇒ the cost-ceiling marker sits ABOVE the KEPT
partial output (asserted by string INDEX, not presence) — both in the BODY, never a `plans.status`
literal (the enum is PINNED). **The fallback stopped lying:** 12-05's *"That specialist does not
execute yet"* became false the moment dispatch shipped, so `buildMemo` gained an optional
`fallbackReason` and branches through a code-owned `FALLBACK_SENTENCE` map — the reason CODE never
reaches the user (asserted). A THROWN turn audits `subagent.refused` with `reason: "error"` (the code
only — `err.message` can carry prompt/grounded prose, §4), writes NO deadLetters row, lands the
fallback, and RETHROWS: `DispatchResult`'s refusal union is the four-member GOVERNED-stop contract and
an exception is not one of them, the `finally` already returned the user to an approvable row, and
15-03 ships a test asserting that a thrown turn rejects. The end-to-end test is the phase's claim:
tap → `collecting` + not approvable → the queued job really IS `runSpecialist` → replay its EXACT args
through the scripted twin → `proposed` + attribution → Approve → exactly ONE `next_step_memo` vault
doc → **ZERO `requests` rows on the whole path** (12-05's structural property SURVIVES dispatch) →
the lineage reconstructs from `audit.by_correlation` within one tenant. Four auto-fixed deviations:
`gapAction.test.ts`'s fixture routes at a REGISTERED specialist so 4 of its 5 tests asserted exactly
what this plan changes (re-pointed at `"scale"` so it keeps characterizing the memo TERMINAL, every
other assertion byte-identical); its untyped convex-test instance then broke the typecheck (52→56,
the SystemIndexes wall — fixed with `TestConvex<typeof schema>`); the e2e test RACED a real gateway
call and lost, because **convex-test flushes due scheduled work in the background** — the production
`runSpecialist` fired, threw `AI_LoadAPIKeyError`, landed the error fallback, and the twin's landing
correctly no-op'd (the CAS working); every dispatching test now CANCELS what it queued, so the suite
has no hidden `OPENAI_API_KEY` dependency; and the 15-03 §4 source scan fired on the new 4th audit
payload (the guard working — pin raised to 4, shared-refs scan follows the new `lineageRefs` helper,
mutation-checked with `body: String(err)`). Gates: backend **544/545** (sole red the documented
`audit.test.ts` `auditCounts` row), @pikar/core 223/223, `apps/web` typecheck exit 0 (Pitfall-4
tripwire held), backend `tsc` at the exact 52-error test-file baseline with ZERO in any non-test
file, `check-playbooks` exit 0, turbo 8/10 baseline, and `git diff` proves `apps/`, `schema.ts`,
`guardrails.ts`, `cockpit.ts`, `deliverApprovedPlan.ts` and `actionType.ts` are all untouched.

PRIOR (15-03): **The governed dispatcher is real: a named specialist runs in THE loop behind four
CONVERSATIONAL refusals, one tree-local cost envelope, and a call tree that reconstructs from an
index that already existed — no new table, no new index, no schema change.** `convex/dispatch.ts` is
ONE `governedDispatch` plus two thin entry points (`runSpecialist` production /
`__runSpecialistWithScript` offline twin), so a guard cannot be true in tests and absent in prod —
the whole 22-test suite drives the REAL loop through the REAL guards at zero model spend. The guard
ORDER is load-bearing and now documented as such: **resolve → depth → cycle → envelope → run**.
`resolveSpecialist` is FIRST because `gaps[].route` persists as `v.string()` (schema.ts:350), so
rows written before 15-02 closed the union — including `diagnose()`'s deliberate `""` — reach it
un-narrowed; the envelope check is LAST so a refusal that costs nothing is never charged against the
tree. All four refusals (`unknown_route` / `depth_exceeded` / `cycle_refused` / `budget_exhausted`)
RETURN a calm sentence that never names its reason code, write **ZERO deadLetters rows**, spend ZERO
model budget (asserted on the untouched daily rail, not inferred) and paint ZERO `agentSteps` rows —
a refused dispatch never started; the step is finished in a `finally`, the only construct that
terminalizes on success, on a thrown turn, AND on a governed stop that returns as data. `MAX_DEPTH =
1` makes cycles structurally impossible, but `wouldCycle` (the SHARED @pikar/core predicate, never a
re-derived inline `includes`) runs and is tested in both shapes, so the guarantee is tested the day
the cap rises rather than written that day. THE ENVELOPE: `floor(remainingDailyCents × 0.25)`,
derived at the ROOT only; a non-zero incoming value is carried through UNCHANGED, which is what makes
it ONE tree ceiling instead of a fresh allowance per hop — the drawdown is asserted on the
`subagent.completed` rows' `spentCents` so it is OBSERVABLE, not inferred. It is a TREE-LOCAL SECOND
ceiling over the deployment-wide (keyless) rail, not a replacement, and deliberately NOT
`guardrails.preCall` (which checks `{count: 1}` — "is there ANY budget left", not "enough for this
call"). A rail driven negative by `recordSpend(reserve: true)` clamps to a ZERO envelope and refuses,
never a negative ceiling (driven with a real 2000-cent overspend against a 500-cent rail). An
OVERRUNNING hop KEEPS its output and is labelled `incomplete: true` — stop AFTER the call that
overran, never discard work already paid for — with a non-vacuity companion proving a hop inside its
envelope is NOT so labelled. SC#3: three `internal.audit.log` inserts per hop, all with
`correlationId := rootRequestId`, so a two-hop run reconstructs as four ordered rows, `parentAgentId`
rebuilds the EDGES (executive → offer-architect → lead-engine) and the tree's cost is a SUM matching
the hops' returned `costUsd`. Three deliberate NON-decisions pinned as source comments: no
`subAgentRuns` table (a second log plane beside an insert-only audit is the anti-pattern), no
telemetry mirror (`telemetry.requestId` is `v.id("requests")` and a specialist run seeds ZERO
requests rows by design — 12-05), nothing on `agentSteps` (its own header forbids a shadow log). §4
is asserted TWICE and both mutation-checked: at runtime every payload VALUE of every audit row is
scanned against the scripted reply and its distinctive words, and statically `llmRedaction.test.ts`
pins `dispatch.ts` to exactly three `payload:` expressions and scans them PLUS the shared `refs`
object they spread. SC#5 is asserted under a deliberate COLLISION — tenant B dispatches with tenant
A's `rootRequestId` verbatim on the same `threadId`, both hops really write, and the lineage
partitions cleanly with NON-EMPTY partitions on both sides (a zero-size partition would pass a naive
no-leakage check vacuously); the audit table is read DIRECTLY because it has no public tenant-scoped
reader, so the `plans.byThread` form (also shipped) would prove isolation of the PLAN, not of the
lineage rows SC#5 names. **ADR-008** records why six pieces of state travel as validator-checked
`internalAction` args rather than DB state, and that `rootRequestId` is minted fresh — it is neither
`planId` (RECYCLED per thread, 12-05, so two dispatches would merge into one unreconstructable tree)
nor `plans.correlationId` (only written at `executePlan`, i.e. after Approve). Zero auto-fix
deviations: the plan's premises held. Gates: backend 528/529 (sole red the documented `audit.test.ts`
`auditCounts` row), @pikar/core 223/223, apps/web typecheck exit 0 (Pitfall-4 tripwire held — explicit
`Promise<DispatchResult>`), backend `tsc` at the exact 52-error test-file baseline with ZERO in any
non-test file, `check-playbooks` exit 0, and `git diff --name-only 4065571^..HEAD` shows exactly the
5 authorized files — `schema.ts`, `guardrails.ts`, `apps/`, `cockpit.ts`, `deliverApprovedPlan.ts`
and `actionType.ts` all absent.

PRIOR (15-05): **The approve→execute spine is action-agnostic, and "adding an action type without
an arm is a compile error" is a VERIFIED `tsc` failure rather than a comment.** `executePlan` no
longer branches on an ad-hoc `if (plan.kind === "memo")`; it is the DISPATCHER, selecting an arm via
`armFor(actionTypeOf(plan.kind))` in an exhaustive switch with an `assertNever` backstop. The memo
arm and the email arm are two entries in one table, and the arms are the EXISTING code paths — the
24-test `cockpit.test.ts` is unchanged and green, which is the refactor's proof. `armFor` is a
`satisfies Record<ActionType, Arm>` TABLE in `@pikar/core`, deliberately NOT the plan's ternary: a
ternary is total by construction, so widening `ACTION_TYPES` would compile fine and silently
classify a new type as `inline`, voiding the plan's own headline guarantee and making its totality
test (`armFor(t) !== undefined`) vacuous forever. `cockpit.ts` keeps its OWN `_ARM_TABLE` bind on
top of that, because the `workflow` case falls through to the GMAIL FAN-OUT (seed `requests` →
`startFanout` → `deliverApprovedPlan`): a new action type that merely *classified* as `workflow`
would inherit the email terminal without anyone deciding to. The switch's `assertNever` covers a new
ARM; `_ARM_TABLE` covers a new TYPE; both are compiler-forced, so they cannot drift — mutation-
checked by adding `"calendar"` to `ACTION_TYPES` and watching TS2741 fire in `actionType.ts`,
`actionType.test.ts` AND `cockpit.ts`. Honest qualification: "zero spine edits" means the spine's
STRUCTURE never changes again — a new type still adds one compiler-demanded line to `_ARM_TABLE`.
The branch ORDER is unchanged and now pinned on BOTH sides in `gapAction.test.ts`: a memo approves
with ZERO `gmailTokens` rows (selection is BEFORE the mailbox pre-check — 12-05 left that as a
comment, it is now an assertion) and an ESCALATED memo refuses with `review_escalated` running
NEITHER arm (selection is AFTER the fail-closed guard). `deliverApprovedPlan.ts` is BYTE-UNCHANGED
(a gate, not a claim): two-level dispatch — `executePlan` picks the arm, `deliverApprovedPlan` is the
workflow-backed EMAIL arm's entry point, not the universal dispatcher. And the human Approve gate is
statically fenced off from the model by three new `dispatchGuard.test.ts` scans: `cockpit.ts` must
declare `export const executePlan = tenantMutation({`; `executePlan`/`approvePlan`/
`deliverApprovedPlan` must be absent from `buildCockpitTools`' 20 `name: tool({` keys (floor ≥20, so
Phases 16-19 can add tools without breaking it); and `llm.ts` must contain no
`internal.cockpit.executePlan` / `api.cockpit.executePlan` / `deliverApprovedPlan` reference AT ALL,
so a tool cannot reach Approve under some other key. Both scans mutation-checked. Gates: `@pikar/core`
223/223, backend 508/509 (sole red the documented `audit.test.ts` `auditCounts` row), gapAction +
cockpit 29/29, `apps/web` typecheck exit 0, backend `tsc` at the exact 52-error test-file baseline,
`check-playbooks` exit 0, and `git diff` proves Lane B touched none of `llm.ts` / `dispatch.ts` /
`evaluations.ts` / `specialists.ts` / `apps/`.

PRIOR (15-02): **A named specialist is now a resolvable `(skill body, tool-set)` pair, and THE
governed loop can run one without being forked.** Two halves. (1) The REGISTRY: the three growth
specialists (`offer-architect` / `money-model-designer` / `lead-engine`) are registered as
`(skillName, tools, stepTool)` triples in `packages/core/src/specialists.ts`; `SpecialistSpec.tools`
is `["searchVault"]` for all three, asserted as an EQUALITY over the WHOLE registry so a write tool
added to any one of them fails a test instead of shipping quietly. `evaluateBusiness` is
deliberately NOT granted — its read-shaped name hides an `internal.evaluations.runEvaluation` call
that PERSISTS an evaluations row + an audit row per call and re-enters the diagnostic engine
mid-dispatch; the snapshot rides the PROMPT (`internal.evaluations.lastForThread`) in 15-03 instead,
and the reasoning is pinned as a comment so a later phase does not "fix" it. `Prescription.route` is
now closed to `SpecialistRoute | ""` with `""` deliberately representable (the not-enough-data ask
branch emits it; `resolveSpecialist("")` refuses it at runtime), direction `growth/ → specialists`.
The COVERAGE BIND is a real runtime assertion: `specialists.test.ts` reads `diagnose.ts` off disk,
balanced-paren slices every `rx(...)` call plus the object-literal `route:` branch (skipping quoted
spans whole — a depth-only walker mis-read `" money model"` out of the `"scale"` branch's prose) and
feeds all 11 literals through the real lookup, so a new gate with a new route fails until its
specialist is registered. Also shipped: `wouldCycle` (the A→B→A predicate, in core so it is correct
BEFORE `MAX_DEPTH` rises) and `specialistMemoBody` (the incomplete/cost-ceiling marker lives in the
BODY — a `plans.status` literal would touch the PINNED enum with `apps/web` blast radius).
(2) The LOOP SEAM: `runAgentLoop` gained ONE append-only optional `toolNames?: readonly string[]`.
ABSENT ⇒ the full 20-key record (the entire unchanged 79-test `runCockpitAgent`/`cockpitTools` suite
is the proof, not a claim); `[]` ⇒ an EMPTY record, because the filter tests `=== undefined` and a
truthiness test would hand a zero-tool specialist all 20 keys. Withholding is STRUCTURAL ABSENCE
from the record — NOT ai@7's `activeTools`, which leaves the withheld tool's `execute` closure in
the record and reachable via `invokeTool` — the `omitRecipientEdits` precedent generalized.
`runSpecialistTurn` is the ONLY exported specialist entry into the loop (`runAgentLoop` stays
module-private, which is what keeps "no agent spawns an agent" checkable by reading one file); it
loads its body through the §5 loaders fail-closed and returns `skillVersion` for the lineage audit
row. **ADR-007** records why the BODY is registry-owned and the TOOL-SET is code-owned. Deviations
(3, all auto-fixed): closing the route type broke `diagnose.test.ts`'s TYPECHECK (an un-annotated
fixture helper widened `""` to `string`) — invisible to the plan's own vitest verify command, fixed
with one `as const`; the plan's `proposePlan` withholding fixture could not discriminate (it refuses
an incomplete plan, so the control case failed too) — switched to `setSubject` + `addRecipients`;
and the source-scan walker bug above. Gates: `@pikar/core` 219/219, backend 504/505 (sole red the
documented `audit.test.ts` `auditCounts` row), `apps/web` typecheck exit 0 (Pitfall-4 tripwire held
— `runSpecialistTurn` has an explicit return type), backend `tsc` +0 new errors over the 52
pre-existing test-file ones, `check-playbooks` exit 0, and `git diff` proves Lane A touched none of
`deliverApprovedPlan.ts` / `cockpit.ts` / `actionType.ts` / `apps/`.

PRIOR (15-01): **Wave 0 is FROZEN.** Every shared seam Phase 15 needs landed in one plan, and
three of them would have failed SILENTLY if skipped. (1) Three literals — `dispatchOfferArchitect`
/ `dispatchMoneyModelDesigner` / `dispatchLeadEngine` — now sit on the CLOSED `agentSteps.tool`
union. N literals, deliberately NOT a `specialist: v.string()` field: §4 on the trace plane is
enforced by the ABSENCE of anywhere to put text, and a string field would re-open the hole the
closed union closed. Without them the dispatch step's insert throws inside an SDK tool callback,
which the SDK SWALLOWS — prod shows a blank activity card while every test stays green.
`dispatch.test.ts` inserts each literal against the REAL schema; that is the guard. (2) All four
matching `VERB` entries landed in `cards.tsx`, INCLUDING the pre-existing Phase-12
`evaluateBusiness` gap that had rendered the `["Working…","Done"]` FALLBACK since 12-04. This was
the ONLY `apps/web` edit in Phase 15 — attribution rides the plan BODY (15-04) and `PlanCard`
renders only at `status === "proposed"`, so a `collecting` plan needs no pending state; **`apps/web`
is now FROZEN for the phase.** (3) `internal.guardrails.remainingDailyCents` gives the daily-spend
rail a READER (`rateLimiter.getValue` — utilization without consuming tokens), clamped
`Math.max(0, …)` because `recordSpend`'s `reserve: true` drives the window negative on purpose,
with an explicit `Promise<number>` return type (an inferred one collapses the generated API to
`any` — how 13-01 shipped 90 `apps/web` errors). It reads the DEPLOYMENT's budget, not the
tenant's: `dailySpendCents` is a KEYLESS window; per-tenant keying is the upgrade path.
Two pure-TS stubs shipped tested: `packages/core/src/specialists.ts` (`resolveSpecialist` fails
closed to `unknown_route` with ZERO registrations and NO default, mirroring `parseRouting`;
`hasOwnProperty` lookup because `"__proto__"`/`"constructor"` resolve to TRUTHY `Object.prototype`
members through a bare index read) and `packages/core/src/actionType.ts` (`ACTION_TYPES =
["email","memo"]` + `actionTypeOf` — an absent `plans.kind` means the email plan every prior phase
built, so ACTN-01 needs no migration). `convex/dispatch.ts` is an empty lane-owned stub, registered
NOW so the Stop hook can protect it from day one. `dispatchGuard.test.ts` holds the SC#2
no-nested-loop scan. **Zero lineage schema change was needed** (RESEARCH Q5 held: `AuditPayload`
already permits `rootRequestId`/`parentAgentId`, `audit.by_correlation` exists, and `telemetry`
structurally cannot carry them). Gates: `@pikar/core` 208/208, backend 500/501 (sole red the
documented `audit.test.ts` `auditCounts` row), `dispatch`+`dispatchGuard` 5/5, `apps/web` typecheck
exit 0 (Pitfall-4 tripwire), backend `tsc` +0 new errors over the 52 pre-existing test-file ones,
`check-playbooks` exit 0, and `git diff` proves Wave 0 touched NONE of `llm.ts` / `cockpit.ts` /
`deliverApprovedPlan.ts`.

PRIOR (13-03): Wave 3 done. BEVL-03 is now visible end to end — the cron's rows have a surface. `/dashboard/workspace` always shows a PINNED, non-closable "Weekly review" tab: `REVIEW_TAB` is seeded straight into `useState<Tab[]>([REVIEW_TAB])`, which is also what makes the `?thread=proactive-review` notification deep-link dedupe for free (`openThread` already skips ids it is showing). The tab drops both its `×` and the `has-close` class, and `closeTab` refuses the id. Selecting it renders a one-line explainer INSTEAD of `ChatPane` — the review thread is synthetic (no `plans` row), so `sendCockpitMessage` would throw `cockpit: plan row missing for thread` (cockpit.ts:93); the composer is suppressed and that backend guard was deliberately NOT loosened (it protects every real thread). The review branch precedes the gmail-status branch on purpose, so a user who never connected Gmail still sees it (SC#2 at the surface). `EvaluationCard` gained four review-ONLY branches and is still one dumb read of one `byThread` row: a pre-first-run empty state gated on the query RESOLVING to `null` (`undefined` is loading — no flash), a dated `Weekly review · MMM D ·` header prefix (the date IS the freshness signal, so no unread dot/badge), a `deltaLine()` "what changed" line off the PERSISTED `evaluation.delta` with zero terms omitted (nothing renders on an all-zero delta or an on-demand row), and a `/dashboard/profile` CTA inside the thin-data box — the one action that unblocks the one dead-end state, at `--teal-900` because BRAND §6 forbids `--teal-600` as small text. `NotificationsBanner` gained `KIND_HREF`, an OPT-IN kind→href map (absent kind ⇒ today's plain text; hrefs are code-owned constants, never row data), routing `weekly_review` over the existing VOIC-04 `?thread=` deep-link — no new route, no new component, no component library. Gates: web typecheck + `check-playbooks` exit 0, backend 494/495 unchanged (this plan touched zero backend files). PRIOR (13-02): the spine. `crons.weekly("proactive-review", monday 06:00 UTC)` → `internal.proactiveReview.runWeekly` enumerates onboarded tenants over `vaultDocuments.by_kind` (deduped — one review per tenant per week) and fans out `scheduler.runAfter(0, reviewOne, { tenantId })` so one tenant's failure cannot touch another's. `reviewOne` runs the Phase-12 engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, carrying last week's `framework` forward, and notifies ONLY on change (first review ever, moved verdict, or a non-empty delta); the evaluation row is written every week regardless, so the card is always current and the bell stays quiet. A thrown review still tells the user (`weekly_review_failed`), with the REASON never reaching the notification plane (§4). `insertReviewNotification` writes `notifications` DIRECTLY — never `notifications.notify`, which schedules `notifyExternal.dispatch` → `freshAccessToken` unconditionally — so proactivity cannot break on the Google 7-day testing token (SC#2). Both kinds stay OUT of `NOTIFICATION_KINDS` as the second, independent barrier. No new audit eventType: the run rides the existing refs-only `evaluation.ran`. SC#2/SC#3 are enforced by comment-stripped static source guards (a cron has no `ctx.auth`, so `tenantQuery`/`tenantMutation` cannot enforce scoping — the guard replaces them, pinning the ONE `by_kind` cross-tenant read to exactly one occurrence). `proactiveReview.test.ts` 8/8, backend 494/495 (sole red the pre-existing `audit.test.ts` auditCounts row), `@pikar/core` 195/195, web typecheck + `check-playbooks` exit 0, backend `tsc --noEmit` +0 new errors over the 52 pre-existing test-file ones.
**Current focus:** Phase 14 — Flagship Voice-Doc Workflow (EXECUTING, 8/9 plans, Lane C)

## Historical Position — Phase 14 (SUPERSEDED, kept for context)

Phase: 14 of 25 (Flagship Voice-Doc Workflow) — **IN PROGRESS** (8/9 plans, 9 waves) on `lane-c/voice-doc`
Plan: 14-08 COMPLETE (the post-call outcome); next 14-09 (wave 9, SC4 static scans + the BLOCKING human-verify)

**TEST BASELINE CHANGED — there is no longer any acceptable red.** The whole monorepo is **892/892,
zero failures**: backend **526/526** (43/43 files), core 195, voice 57, vault 42, extraction 28, cost
22, contracts 14, pii 8. The two failures every prior phase summary described as expected baseline
("494/495", later "524/526") are FIXED, and neither was a product defect: (1) `audit.test.ts` was
missing `t.registerComponent("auditCounts", …)` — `audit.log` maintains that aggregate, and eight
sibling tests already had the line; (2) the recurring "flake" (`runCockpitAgent.test.ts > mock loop`,
`voice.test.ts > storeBrief`) was vitest's default **5_000ms** `testTimeout`, not a bad test — both
take ~3.4s isolated because every convex-test instance boots an in-memory backend, so under parallel
load they crossed 5s and then passed alone. Now `testTimeout: 20_000` in
`packages/backend/vitest.config.mts`. **A failing backend test is now a real regression.** Lesson
worth keeping: once a genuine bug is named as "the documented pre-existing red", five phases report
around it instead of at it.

**KNOWN DEBT, deliberately NOT fixed in this lane:** backend `tsc --noEmit` has **49** errors, ALL in
test files, **0 in shipped code** (bar: +0 new). ~15 are `Property 'glob' does not exist on type
'ImportMeta'`, fixable by adding `"vite/client"` to `packages/backend/tsconfig.json`'s `types` — but
that cascades, because every existing `// @ts-expect-error import.meta.glob` then becomes an unused-
directive error, across ~20 test files owned by Lanes A and B. That is a post-merge job on `main`,
not a mid-parallel-execution sweep.

Status: Wave 8 done — **the user now DECIDES, and the decision crosses the real gate.** `PostCall`
branches on `docId`: `reviewSession` fires ONCE (ref-guarded; the server is idempotent per session
too — belt and braces, because it is the page's only model call), the editor re-seeds from
`composeDocMemo` once the row lands (guarded, so a late subscription tick cannot clobber an edit in
progress), and the cited findings render **IN PLACE** via the EXPORTED `CardList` on the synthetic
thread — cited findings, the affirmative healthy banner, each gap's wired "Act on this" →
`actOnGap` → a `proposed` memo plan, and the `PlanCard` with the EXISTING single Approve. No new
card idiom, no second query (same `evaluations.byThread` subscription, Convex dedupes it), **no
route jump.** **ONE footer action** ("Save this memo"); acting on a gap already lives in the card, so
a second control would be two controls for one decision. **DELIBERATELY NO "Continue with your
agent" on this branch** — it pushes `/dashboard/workspace?thread=<id>`, and the synthetic
`voice-doc:<sessionId>` is NOT a Convex Agent thread, so a composer there would throw (Pitfall 7).
**A failed review never costs the user their conversation:** it falls back to the plain brief, says so
in the `aria-live` status, and the save path stays open. **The memo IS the brief, document-flavoured**,
stored through the SAME `endSessionClean`/`briefRef` spine — so "exactly ONE new thing in the vault"
is **INHERITED, not re-implemented**, including on the abnormal path (pinned by two new
`voice.test.ts` cases). `cards.tsx` took FOUR surgical edits: `isDocReview` keyed off the SHARED
`DOC_REVIEW_FRAMEWORK` (never a re-typed literal); a document branch for the healthy banner ("your
business is solid here" is the wrong claim about a REPORT); the `/dashboard/profile` CTA suppressed on
that branch (enriching a business profile does nothing for an unassessable report — a dead link
dressed as a fix); and `citationExcerpt` rendered as a `<blockquote>`, **framework-agnostic on
purpose** so Phase-12 rows are byte-identical and absent renders exactly as before. `CardList` gained
an **opt-in** `noPlanHint` defaulting to today's cockpit string, so no existing caller changes. Gates:
gapAction **9/9**, voice **14/14**, voiceDoc 23/23, monorepo **903/903 zero failures** (backend
**537/537**), web typecheck exit 0, web build compiles with both routes `ƒ (Dynamic)`, backend tsc 49
(+0 new). **FROZEN FILES: zero diff across the ENTIRE phase** (`plans.ts`, `deliverApprovedPlan.ts`,
`cockpit.ts`, `llm.ts`, `run-eval-golden.mjs`); `evaluations.ts` carries only the 12 authorized lines.

**TWO OF MY OWN ASSUMPTIONS WERE WRONG AND THE CODE WAS RIGHT (14-08)** — the corrections are the
useful part: (1) `source` is `vault | user-provided`, not "grounded", and "vault" is exactly what
`shapeDocReview` welds — a fixture must MIRROR the real writer, not paraphrase it. (2) "A second tap
refuses" is false and should be: a second tap on a still-`proposed` plan SUCCEEDS by recycling the
row, because changing your mind about which gap to act on must restage the memo. `plan_busy` is for
mid-flight/delivered only. The invariant that matters — never a SECOND `plans` row, since
`plans.byThread` is `.unique()` and a duplicate makes every later read THROW — is now what the test
asserts, plus a separate case driving a plan to `delivering` to confirm the real refusal.

**DEFECT FIXED in 14-01's seeder (14-08):** `smoke:seedVoiceDocSession` seeded `section: "findings"`,
which is NOT in `DOC_REVIEW_SECTIONS` (`insight | pattern | strength | risk`). `shapeDocReview` DROPS
findings outside that union, so the e2e fixture described a row production can never emit — the spec
would have passed against an IMPOSSIBLE shape. Now "pattern"/"insight". **A fixture that is not a
legal row is not a fixture.**

**CROSS-LANE STATUS (checked 2026-07-26):** `main` is 2 commits ahead, docs-only, cleanly
auto-mergeable. Lane A (`lane-a/dispatch-core`) has COMPLETED Phase 15 and touches `schema.ts`,
`evaluations.ts`, `cards.tsx`, `llmRedaction.test.ts`, `gapAction.test.ts`, `watch.json` — all shared
with this lane. **Every conflict is MECHANICAL, none semantic:** different unions in `schema.ts`,
different maps in `cards.tsx` (Lane A never touches `FRAMEWORK_LABEL`/`EvaluationCard`/`CardList`),
different regions in `evaluations.ts`, different entries in `watch.json`, documented keep-both for the
`.planning` singletons, and `graphify-out/*` is regenerated (≈3,100 of the 3,125 markers).
**THE IMPORTANT INTERLOCK:** Lane A's 15-04 split `actOnGap` into TWO terminals — a gap whose `route`
names a REGISTERED specialist now schedules a dispatch instead of staging a memo. Their `SPECIALISTS`
registry holds exactly `offer-architect`, `money-model-designer`, `lead-engine`; `DOC_GAP_ROUTE` is
`"document-analyst"`, **not registered anywhere in their branch** — so a voice-doc gap keeps the memo
branch, which is exactly what SC #3 requires. The lanes interlock correctly without having
coordinated. 14-08's SC3 assertions were written against the OUTCOME rather than `actOnGap`'s
internals precisely so they survive that merge.

PRIOR (14-07): Wave 7 done — **the flow has a FRONT DOOR and the call has CONTEXT.** A `ready` vault document
offers "Discuss by voice" (in the `DocGrid` card AND the `PreviewModal` footer) linking to
`/dashboard/voice?doc=<id>`. **The status gate is the phase's first honesty moment:**
`processing`/`extracting`/`pending_extraction` render a REAL `disabled` button ("Reading…"), never a
`Link` with `pointer-events:none` — a screen reader must not announce an actionable control that does
nothing; `failed` offers **no voice action at all**, and `PreviewModal`'s explainer now says why in the
user's terms plus what to do next. Rationale: never open a grounded conversation the agent cannot
ground, and never burn capped 15-minute time on a document still being read. **THE GATE IS
SUBSCRIPTION-DRIVEN — do not add a poll:** `listVaultDocs` is a live query returning whole rows, so the
control re-renders enabled the instant extraction flips the status. The control is a **SIBLING** of the
card `<button>` (nested interactive elements are invalid HTML and break keyboard order), reusing the
failed-card Retry's absolute positioning, and a shared `discussPillStyle()` keeps both variants in the
identical spot so nothing moves under the user. **NEW: `voiceDoc.docContext`** — a tenant-scoped
`{title, status, truncated}` projection, `null` cross-tenant (fail-closed by null, not throw: a throw
distinguishes "exists but not yours" from "no such document", an ownership oracle). Deliberately NOT a
`listVaultDocs` reuse — that `.collect()`s whole rows including `text`, and the voice page must not
pull a book-sized blob to render a title; a test pins the key set to exactly `[status,title,truncated]`
and asserts no `text` key so a "just return the row" simplification fails loudly. **`DocStrip`** names
the report during the call and badges a partial read; it renders nothing for BOTH `undefined` (loading)
and `null` (not yours) and distinguishes them nowhere. It links to `/dashboard/vault` rather than
hoisting `PreviewModal` — that modal owns download/delete/retry, and a destructive action one mis-tap
from a live call is the wrong trade. **No live insights panel** (explicitly deferred). BRAND §6
honoured: the badge is `--ink-soft` on a ruled chip, not small teal text, and carries the literal word
"partial" so meaning is never colour-only. Phase-6 layout otherwise untouched, text fallback included.
Gates: voiceDoc **23/23**, monorepo **896/896 zero failures** (backend **530/530**), web typecheck exit
0, web build compiles with both routes still `ƒ (Dynamic)`.

**OUT-OF-SCOPE FIX (14-07):** `packages/backend/.convex/` — which holds
`convex_local_backend.sqlite3` + `convex_local_storage/`, i.e. REAL tenant rows (vault documents, audit
entries, PII) — was untracked but **UNIGNORED** in both worktrees. Never committed, but one
`git add -A` would have committed the whole dev database. `**/.convex/` is now in `.gitignore` with the
reason inline. Surfaced by junctioning the local deployment into this worktree.

PRIOR (14-06): Wave 6 done — **SC #1's drill-in loop is CLOSED end to end.** `/dashboard/voice?doc=<id>`
mints doc-scoped (persona + digest + tool), threads `docRef` onto `startSession` so the SERVER owns
what the session is about, and relays the model's `search_document` calls to
`api.voiceDoc.searchDocument` over the existing `"oai-events"` channel. **OPEN QUESTION 4 SETTLED on
`response.done`** — already live-verified in this repo and documented to carry the complete
`function_call` item, so the relay pins **zero** new event names;
`response.function_call_arguments.done` sits in exactly the MEDIUM-confidence class `realtime.ts`
warns about. The relay sits AFTER `responseActiveRef.current = false` in the same case, and that
ordering is what makes the trailing `response.create` legal rather than a silent 400 ("conversation
already has an active response" — the failure that once swallowed the wrap-up nudge). **A
`function_call_output` is ALWAYS sent, even on failure** (Pitfall 5) — a missing output leaves the
model waiting and the user hearing silence for the rest of a capped 15 minutes. **Only the model's
free-text `query` crosses the wire**; the document id is never sent, because `searchDocument` reads
`docRef` off the server session row, so nothing the model says can widen scope or pick another
document. **No `docId &&` guard on the relay loop** — a Phase-6 session declares no tools so
`output[]` can never hold a `function_call` item, and a condition would silently disable a future
tool. **Open Question 3's contingency is live:** when the mint reports `toolsAtMint: false` the
browser declares the tool via `REALTIME_CLIENT_EVENTS.updateSession` on the channel's `open` event —
event-driven, NOT a timeout, because `createDataChannel` returns before the channel opens and `send`
silently drops a closed-channel write, so a naive immediate send would lose the declaration with no
error anywhere. `page.tsx` is the SINGLE `?doc=` reader and threads `docId` as a prop to
`useVoiceSession`, `<LiveSession>` (14-07's seam) and `<PostCall>` (14-08's seam) — **neither child
may add a second reader.** Gates: voice **57/57**, web typecheck exit 0, **`pnpm --filter @pikar/web
build` succeeds with `/dashboard/voice` still `ƒ (Dynamic)`**, monorepo 892/892, zero new npm deps,
zero hardcoded Realtime literals in `apps/web`.

**DEVIATION worth carrying (14-06):** the plan required `page.tsx` to contain `"Suspense"` AND to
copy `workspace/page.tsx`'s idiom — but that idiom **deliberately avoids** `useSearchParams` and says
so in its own comment ("avoids the useSearchParams Suspense boundary … the connect-gmail
precedent"). Followed the real precedent (`new URLSearchParams(window.location.search)` in a mount
effect), which **removes** the Pitfall-6 class instead of guarding it — a missing boundary either
errors at prerender or silently deopts the whole page to CSR, and `typecheck` sees neither. Verified
with the strict gate anyway (build passes, route stays Dynamic). The `contains: "Suspense"` artifact
is unmet **by design**; every behavioural truth is met. **This is the FOURTH plan whose asserted
interface was wrong** (14-03/14-04/14-05 on `internal.vault.getDoc`, now this) — the pattern is that
`14-RESEARCH.md` and the plans state what a referenced file does without opening it.

PRIOR (14-05): Wave 5 done
Status: Wave 5 done — **SC #2 is now true and testable without a microphone.** `voiceDoc.reviewSession({sessionId, transcript}) -> {threadId, findingCount, gapCount, verdict}` persists a cited `evaluations` row on the synthetic `voice-doc:<sessionId>` thread, through the **unmodified** `insertEvaluation` — the schema-derived validator widened by 14-01 carried the new `document-review` literal on its own, so `evaluations.ts` stayed frozen for this plan. The model emits **labels only**; `shapeDocReview` (14-02, pure) welds `citationDocId`/`citationTitle`/`route`/`playbook`/rank and applies the honesty verdict in code, so a citation cannot be hallucinated and a gap cannot be self-routed. **`excerpt` is the ONE model-authored exception** — declared STRICT-legally in `docReviewSchema`, then whitespace-normalized substring-verified against `doc.text`, and on failure the EXCERPT is dropped, never the finding (the absent-excerpt path is asserted: `findings[2]` has no `citationExcerpt` key at all, so 14-08's renderer must treat a missing key as normal). **The honesty assertions are anti-vacuous** — `verdict === "healthy"` AND `findings.length > 0` AND `gaps.length === 0` pinned together at BOTH the return value and the persisted row, because `gapCount === 0` alone also passes on the thin-data `insufficient` verdict (the Phase-12 `28-healthy-no-gaps` lesson); the no-fabricated-gap counterpart pins `insufficient` + zero gaps. `reviewSession` is **idempotent on the thread** — an existing row is returned as-is rather than patched, so a post-call remount (refresh, resumed dropped call) shows ONE consolidated list. Gates: voiceDoc **19/19** (was 9), backend **524/526** (baseline held), backend `tsc --noEmit` **49** / 0 non-test (+0 new), web typecheck exit 0, `check-playbooks` exit 0, `evaluations.ts`/`llm.ts`/`deliverApprovedPlan.ts`/`run-eval-golden.mjs` ZERO diff.

**SECURITY FIX carried in this plan (`5678f22`):** a background review flagged `test-seam-exposed-to-untrusted-input` and was right. `reviewSession` is a PUBLIC `tenantAction` whose `transcript` is client-supplied, and the producer branched on `transcript[0].text.startsWith("SMOKE::docreview::")` — so any authenticated tenant user could POST a crafted first turn and persist a **fabricated review** (canned gaps, real citations, no model call) straight into `actOnGap` → memo → the Approve gate. The seam was copied from `vaultLlm.ts` and matches it in SHAPE but **not in EXPOSURE**: `vaultLlm.extractGraph` is an `internalAction`, reachable only by server code. **Idioms carry invisible preconditions; that one did not travel.** Impact was bounded (tenant-scoped, no cross-tenant reach, no exfiltration, fixed fixture content) but it contradicted the very criterion the plan exists to satisfy — SC #2 promises honest gap reporting, and a production gap-forgery primitive would have made it untrue where it matters. Fix: `offlineSeamAvailable()` honours the sentinel ONLY when `OPENAI_API_KEY` is absent — inert in production, live in the keyless suite, **no test weakened** (all 12 SMOKE call sites still green) and **no new deployment config**, preserving the original per-request design goal. Mutation-verified at `voiceDoc.test.ts:613`. **Generalizable lesson: when reusing a seam, check whether what protected it travels with it.**

**DEVIATION worth carrying (14-05):** the plan again specified `internal.vault.getDoc` — the **third consecutive plan** to inherit that false premise from `14-RESEARCH.md` (14-03 at `startSession`, 14-04 at the mint, 14-05 here). It returns `{text, contentHash, title}`: no `extractionTruncated`, and it THROWS on cross-tenant instead of reading as missing, which turns a fail-closed check into an oracle. Reused 14-04's `voiceToken.docForMint` rather than adding a third copy or widening the Phase-10 shared query. **For Phase 15's planner: research errors replicate wherever the planner trusted them** — the `evaluations.ts` "zero edits" claim did exactly this in 14-01.

PRIOR (14-04): Wave 4 done — **the session now OPENS already knowing the report.** `voiceToken.mintClientSecret({docId?}) -> {clientSecret, expiresAt, toolsAtMint}`: with a `docId` the `instructions` field is the `document-analyst` REGISTRY body + a blank line + `buildDocDigest(...)` (fenced, capped, truncation-disclosing — NOT re-sliced or re-fenced at the mint, and no behavioural line added inline, §5); without one it is `voice-session`, byte-unchanged, with **NO `tools`/`tool_choice` keys at all** (absent, not empty — pinned by an exact-equality + `Object.hasOwn` pair so a doc feature can never reshape every ordinary voice call). Both personas fail closed via `getActiveSkill`'s `NO_ACTIVE_SKILL` and **no request leaves Convex when the registry cannot answer** (asserted `calls.length === 0`). **The MINT is the FIRST trust boundary in wall-clock order** — the browser mints BEFORE it has a session row (`useVoiceSession.ts:269` → handshake → `startSession`), so it re-validates the doc itself: `voicedoc: document not found` (missing/cross-tenant, fail-closed) / `voicedoc: document not ready`, the SAME two strings 14-03's `startSession` throws, refused before any request leaves Convex. **Exactly ONE tool, READ-ONLY** — `tools:[SEARCH_DOCUMENT_TOOL]` + `tool_choice:"auto"` via `SESSION_TOOL_KEYS`; the test asserts length 1, the name, a top-level `parameters` key and the ABSENCE of a `function` key (the FLAT Realtime shape; the Chat-Completions nesting 400s the mint). That tool SET is the containment: nothing writable is reachable from a voice session, so an instruction planted in the report has nothing to actuate — which matters more here than anywhere else in the repo because the digest sits in the SYSTEM `instructions` field, a materially stronger exposure than ADR-006's tool-RETURN case (the `ponytail:` block names the upgrade path: move the digest into a first `conversation.item.create` user-role message, at the cost of first-second fluency). **OPEN QUESTION 3 — both branches SHIPPED, the answer still BLANK:** mint-time tools first (server-owned, races nothing), and on a **400 only** an automatic re-POST of the identical body minus the tool keys returning `toolsAtMint:false`; a 500 still throws first time and does NOT re-POST (asserted). It is a SHAPE fallback, not a retry policy. `toolsAtMint` is the ONE deliberate extension to the Phase-6 `{clientSecret,expiresAt}` contract — TRANSPORT CONTROL, not a secret and not document content — and is trivially `true` on an unscoped mint so 14-06's branch stays a single `if (!toolsAtMint)`. The instruction BUDGET is now a test, not a comment (`instructions.length < personaBody.length + DIGEST_CHAR_CAP + 500`). `voiceToken.ts` writes **zero** log-plane rows (`grep -c "audit.log"` = 0, no `payload:` block) — the cleanest possible SC4 result. Gates: voiceToken **12/12** (was 5), backend **515/516** (baseline held, +7 new green; sole red the documented pre-existing `audit.test.ts` auditCounts row), backend `tsc --noEmit` **49** errors / 0 non-test — **BELOW** the 52 baseline, web typecheck exit 0, `check-playbooks` exit 0, `llm.ts`/`evaluations.ts`/`deliverApprovedPlan.ts`/`schema.ts`/`vault.ts`/`vaultGround.ts`/`realtime.ts`/`run-eval-golden.mjs` ZERO diff this plan.

**DEVIATIONS worth carrying (14-04):** (1) the plan's `internal.vault.getDoc` interface was wrong AGAIN — it returns `{text, contentHash, title}` with **no `status`** and **no `extractionTruncated`**, so it can answer neither the readiness refusal nor the truncation disclosure; `getDocForExtraction` has `status` but no `text`, and two round-trips still miss `truncated`. Added a **module-local `voiceToken.docForMint` internalQuery** (returns `null` for missing/cross-tenant so the MINT owns the thrown message) rather than widening the shared Phase-10 query, which would touch `vault.ts` — outside this plan's `files_modified`, outside Wave 4's ownership row, and watched by `vault.md`. (2) **`voiceToken.test.ts` referenced `internal.voiceToken.mintClientSecret` — always wrong**, since `mintClientSecret` is a PUBLIC `tenantAction` and therefore lives under `api`. That was 3 of the documented 52 pre-existing `tsc` errors and my 9 new call sites would have made it 17. Renamed to `api.*`; the file now contributes ZERO tsc errors and the backend baseline is **52 → 49**. This is NOT the stale-`api.d.ts` problem 14-03 documented — that one is real and separate.

PRIOR (14-03): Wave 3 done — the doc scope is REAL and is enforced by the SERVER, and SC1's "drill in" half exists. **`voice.startSession({callId, docRef?})` is the TRUST BOUNDARY**, not 14-07's picker: the doc must exist, be this tenant's, be `status:"ready"` and carry non-blank `text`, else it throws `voicedoc: document not found` (missing/cross-tenant, fail-closed) or `voicedoc: document not ready`. Validation runs FIRST — before the parallel-session guard and before the insert — so a rejected doc can never leave an `active` row holding a watchdog (asserted: no active session, nothing scheduled). The thrown message is a STATUS, never content. With no `docRef` the row and the audit payload are BYTE-IDENTICAL to the Phase-6 path (pinned by an exact `JSON.stringify` equality). **`voiceDoc.searchDocument({sessionId, query}) -> {passages, found}`** answers a mid-call question from THAT report alone: the document id is read off the SESSION ROW — the model supplies only free text and the browser only a session id, so **there is no document parameter to poison**. It reuses the frozen Phase-10 `vaultGroundHydrated` (whose `namespace = tenantId` is the BETA-05 linchpin) instead of reading the book-sized `vaultDocuments.text` or forking chunk selection, drops every hit that is not `docRef`, and caps at `RETRIEVAL_MAX_PASSAGES` (3) / `RETRIEVAL_CHAR_CAP` (1,200). **It NEVER throws** — a missing/foreign/ended/unscoped session and any unexpected error all return `{passages:[], found:false}`, because a missing `function_call_output` leaves the model waiting and the user hearing silence inside a capped 15 minutes (Pitfall 5). **SC4 starts clean:** exactly ONE `audit.log` call site in the module (`grep -c` = 1), `voicedoc.searched` with payload `{sessionId, queryHash, resultCount}` — keys asserted EXACTLY, `queryHash` asserted to be a 64-hex digest and not the query, serialized rows asserted free of the report's words and of the `SMOKE::` sentinel; no `agentSteps`/`telemetry`/`deadLetters`. **BETA-05 proven ANTI-VACUOUSLY:** tenant A searching tenant B's doc id gets nothing and names B nowhere in the log plane — AND the same seed IS retrievable from tenant B's own session, so the empty result is a tenant boundary, not a malformed fixture. **OPEN QUESTION 2 RESOLVED:** `@convex-dev/rag` 0.7.5 DOES support per-entry filters (`filterNames` + `filterValues` + `filters`, verified against the installed types), but they are unusable today — `vaultRag.ts` declares no `filterNames`, `embedDoc` passes `vaultDocId` as UNINDEXED `metadata`, and filters only match entries INSERTED with them, so adopting one is a shared-instance change plus a re-embed MIGRATION. Shipped post-hoc filtering with the honest ceiling and BOTH upgrade paths in a `ponytail:` comment; explicitly NOT a cache (ADR-005 time-cap-only). Gates: voiceDoc 9/9 (was 2), voice 12/12 (was 8), backend **508/509** (baseline held, +11 new green; sole red the documented pre-existing `audit.test.ts` auditCounts row), backend `tsc --noEmit` exactly 52 pre-existing test-file errors (+0 new, 0 non-test), web typecheck exit 0, `check-playbooks` exit 0, frozen files (`llm.ts`/`evaluations.ts`/`deliverApprovedPlan.ts`/`vaultGround.ts`/`schema.ts`/`run-eval-golden.mjs`) ZERO diff this plan.

**DEVIATION worth carrying (14-03):** the plan's `key_links` row `voice.ts -> internal.vault.getDoc` is UNMET and cannot be met. `vault.getDoc` THROWS on cross-tenant (it never returns null, as the plan claimed) and returns `{text, contentHash, title}` with **no `status`**, so it structurally cannot answer the readiness half; the only query carrying `status` (`getDocForExtraction`) carries no `text`. `startSession` is a `tenantMutation` with direct `ctx.db` access, so it reads the row once using this file's OWN existing idiom (`endSessionClean:183` / `abortSession:221` / `recordUsage:276` all do `if (!s || s.tenantId !== ctx.tenantId) throw`). Behavior guaranteed and tested; the link is not.

**ENV (14-03):** `convex/_generated/api.d.ts` in this worktree was copied at 14-01 and predates `voiceDoc.ts`, so `api.voiceDoc` did not typecheck. `npx convex codegen` still REFUSES here (no `CONVEX_DEPLOYMENT`, confirmed again incl. `--typecheck disable`). Hand-added the two lines codegen emits (`import type * as voiceDoc …` + `voiceDoc: typeof voiceDoc;`) — the file is gitignored so it never entered a commit. **Every new Convex module in this worktree needs that two-line manual registration until someone runs `npx convex dev` once.** The same staleness is the source of the pre-existing `voiceToken.test.ts mintClientSecret` errors inside the 52 — do not chase those.

PRIOR (14-02): Wave 2 done — `@pikar/voice` now owns the ENTIRE doc-discussion domain, so Success Criterion 2's honesty rule is provable in a 3-second pure test run instead of only through a live call. Landed: **`buildDocDigest`** — the one place document text enters an `instructions` field: `DIGEST_CHAR_CAP` is enforced on the DOCUMENT SLICE (title/truncation-disclosure/fence/safety chrome is NOT charged to it, so the budget means the same thing whatever the title is), the text is wrapped in `DIGEST_FENCE_OPEN`/`DIGEST_FENCE_CLOSE`, and a planted fence marker collapses to a strictly SHORTER non-empty literal — shorter so sanitizing can never push a cap-length slice back over the cap, non-empty so a split marker can never re-assemble. A truncated read discloses that BEFORE the fence opens; empty/whitespace-only text says so plainly and still fences. §5 boundary held: the digest emits document FACTS plus exactly ONE safety line (a fence with no stated rule is not a fence); every behavioural instruction stays in the `document-analyst` registry body. **`shapeDocReview`** — the honesty rule as code, not prompt: `findings.length === 0` FORCES `gaps = []` and `verdict = "insufficient"`; findings with zero gaps ⇒ `healthy`; else `gaps`. A finding whose `section`/`confidence` falls outside the closed `DOC_REVIEW_SECTIONS`/`DOC_REVIEW_CONFIDENCE` taxonomies is DROPPED, never coerced — which is what stops garbage from flipping `insufficient` into `healthy` by the back door. Citations (`citationDocId`/`citationTitle`/`source:"vault"`), `route`, `playbook` and a dense 1-based `leverageRank` are welded from the `doc` arg and module constants regardless of anything the model sent; `RawDocReview` has no such field to invent. `citationExcerpt` is the ONE model-authored citation input: trimmed, whitespace-collapsed, capped at `EXCERPT_CHAR_CAP`, and **the KEY IS OMITTED** when missing/null/empty/whitespace-only — never `""`. Provenance (is the quote really in the report?) is 14-05's job, where the text is in hand. **`composeDocMemo`** — one vault artifact, no second brief builder: built ON `composeBrief`, then the review fills the three headers the client brief leaves unused (SUMMARY = verdict, DISCUSSION = cited findings, OPEN QUESTIONS = notEnoughData), gaps beneath under a plain `GAPS` label that is DELIBERATELY not a `BRIEF_HEADERS` entry (that set is what `planSeedFromBrief` uses to find section boundaries in BOTH brief flavors — widening it silently changes how existing Phase-6 briefs parse). An absent excerpt renders NOTHING (no empty quote line). **`realtime.ts`** gained `REALTIME_FUNCTION_CALL` / `SESSION_TOOL_KEYS` / `TOOL_CHOICE_AUTO` with NO new event name — the relay triggers off the already-live-verified `responseDone` — plus a dated, blank-until-verify decision record for the mint-time-vs-`session.update` tool-declaration branch. Gates: voice **56/56** (was 36), backend **497/498** (baseline held; sole red the documented pre-existing `audit.test.ts` auditCounts row), backend `tsc --noEmit` exactly 52 pre-existing test-file errors (+0 new), web typecheck exit 0, `check-playbooks` exit 0. Zero deviations; `llm.ts` / `evaluations.ts` / `deliverApprovedPlan.ts` / `run-eval-golden.mjs` byte-unchanged this plan.

PRIOR (14-01): Wave 0/1 done — Phase 14's whole share of the freeze is on the lane branch and is mergeable to `main`. Landed: `evaluations.framework` widened with `"document-review"` (human-readable ON PURPOSE — `buildMemo` prints it verbatim as user-visible memo prose, and it is DELIBERATELY absent from `FRAMEWORK_SKILL` so `runEvaluation` can never treat a doc review as a business evaluation); `evaluations.findings[].citationExcerpt` optional (the persisted half of the LOCKED citation decision — absent is a VALID non-degraded state, never an empty string; capped at `EXCERPT_CHAR_CAP` 300 and substring-verified before write; §4-ILLEGAL in every audit/deadLetters/telemetry payload and in agentSteps); `voiceSessions.docRef` optional, no index. `cards.tsx`'s `FRAMEWORK_LABEL` entry landed in the SAME commit — that map is `Record<Evaluation["framework"], string>`, so splitting them is an instant web-typecheck red. **KEY DEVIATION (user-approved Option A):** the plan's research premise "widening the schema needs ZERO edits to `evaluations.ts`" was FALSE — `evalFields.framework` feeds TWO signatures, `insertEvaluation` (:139, which does widen for free) and `runEvaluation` (:161, which must not). `runEvaluation`'s framework arg is now explicitly PINNED to the four business frameworks, which refuses a doc-review row at the VALIDATOR BOUNDARY rather than only at the `FRAMEWORK_SKILL` lookup — strictly stronger than the planned guarantee. Do not "simplify" it back. `proactiveReview.ts:79` correspondingly never carries a doc-review framework into the weekly review. `insertEvaluation`, the local `Framework` type, `FRAMEWORK_SKILL`, `buildMemo`, `llm.ts`, `deliverApprovedPlan.ts`, `GATED_SKILLS` and `run-eval-golden.mjs` are all byte-unchanged (verified by diff). Recorded as an authorized exception in `PARALLELIZATION.md`. Also landed: `@pikar/voice/docSession.ts` (the whole pure contract surface — framework literal, `voiceDocThreadId` DERIVED not stored, the FLAT Realtime `SEARCH_DOCUMENT_TOOL`, the digest/retrieval/excerpt caps, code-owned gap routing) with 10 assertions; `voiceDoc.ts` as a zero-export lane-owned stub (V8 runtime, no `use node`); `voiceDoc.test.ts` proving the widened schema-derived validator actually accepts `document-review`; `smoke:seedVoiceDocSession` seeding TWO asymmetric findings (one quoted, one NOT) so the SC3 e2e exercises both render paths; `voice-doc.spec.ts` with the verbatim `voice.spec.ts` harness behind one `test.fixme`; `watch.json` registrations (note `voice.ts` does NOT prefix-match `voiceDoc.ts`); and the `document-analyst` persona as the 5-file mirror, seeded **UNGATED** (locked user decision — `run-eval-golden.mjs` hard-validates `--skill` against a closed list and cannot drive a Realtime voice persona, so gating would deadlock it at v1 on its first body edit). Gates: full monorepo suite green (core 195/195, voice 36/36, contracts 14/14, backend **497/498** — sole red the documented pre-existing `audit.test.ts` auditCounts row, up from the 494/495 baseline by 3 new green), backend `tsc --noEmit` 0 non-test errors / exactly 52 pre-existing test-file ones (+0 new), web typecheck exit 0, `check-playbooks` exit 0.

**ENV NOTE for the next Lane-C session:** this worktree had no `node_modules` (ran `pnpm install`) and has **no `CONVEX_DEPLOYMENT`**, so `npx convex codegen` REFUSES to run here. `convex/_generated/` was copied from the main worktree (gitignored, never committed) — sufficient because generated `dataModel.d.ts` derives from `../schema`, so schema edits flow through without a regen. Redo both steps, or run `npx convex dev` once to give this worktree its own deployment (which the lane contract wants before any live smoke anyway).

PRIOR (Phase 13, 3/4 plans — 13-04 still open): Wave 3 done. BEVL-03 is now visible end to end — the cron's rows have a surface. `/dashboard/workspace` always shows a PINNED, non-closable "Weekly review" tab: `REVIEW_TAB` is seeded straight into `useState<Tab[]>([REVIEW_TAB])`, which is also what makes the `?thread=proactive-review` notification deep-link dedupe for free (`openThread` already skips ids it is showing). The tab drops both its `×` and the `has-close` class, and `closeTab` refuses the id. Selecting it renders a one-line explainer INSTEAD of `ChatPane` — the review thread is synthetic (no `plans` row), so `sendCockpitMessage` would throw `cockpit: plan row missing for thread` (cockpit.ts:93); the composer is suppressed and that backend guard was deliberately NOT loosened (it protects every real thread). The review branch precedes the gmail-status branch on purpose, so a user who never connected Gmail still sees it (SC#2 at the surface). `EvaluationCard` gained four review-ONLY branches and is still one dumb read of one `byThread` row: a pre-first-run empty state gated on the query RESOLVING to `null` (`undefined` is loading — no flash), a dated `Weekly review · MMM D ·` header prefix (the date IS the freshness signal, so no unread dot/badge), a `deltaLine()` "what changed" line off the PERSISTED `evaluation.delta` with zero terms omitted (nothing renders on an all-zero delta or an on-demand row), and a `/dashboard/profile` CTA inside the thin-data box — the one action that unblocks the one dead-end state, at `--teal-900` because BRAND §6 forbids `--teal-600` as small text. `NotificationsBanner` gained `KIND_HREF`, an OPT-IN kind→href map (absent kind ⇒ today's plain text; hrefs are code-owned constants, never row data), routing `weekly_review` over the existing VOIC-04 `?thread=` deep-link — no new route, no new component, no component library. Gates: web typecheck + `check-playbooks` exit 0, backend 494/495 unchanged (this plan touched zero backend files). PRIOR (13-02): the spine. `crons.weekly("proactive-review", monday 06:00 UTC)` → `internal.proactiveReview.runWeekly` enumerates onboarded tenants over `vaultDocuments.by_kind` (deduped — one review per tenant per week) and fans out `scheduler.runAfter(0, reviewOne, { tenantId })` so one tenant's failure cannot touch another's. `reviewOne` runs the Phase-12 engine on the STABLE per-tenant `REVIEW_THREAD_ID` with `withDelta: true`, carrying last week's `framework` forward, and notifies ONLY on change (first review ever, moved verdict, or a non-empty delta); the evaluation row is written every week regardless, so the card is always current and the bell stays quiet. A thrown review still tells the user (`weekly_review_failed`), with the REASON never reaching the notification plane (§4). `insertReviewNotification` writes `notifications` DIRECTLY — never `notifications.notify`, which schedules `notifyExternal.dispatch` → `freshAccessToken` unconditionally — so proactivity cannot break on the Google 7-day testing token (SC#2). Both kinds stay OUT of `NOTIFICATION_KINDS` as the second, independent barrier. No new audit eventType: the run rides the existing refs-only `evaluation.ran`. SC#2/SC#3 are enforced by comment-stripped static source guards (a cron has no `ctx.auth`, so `tenantQuery`/`tenantMutation` cannot enforce scoping — the guard replaces them, pinning the ONE `by_kind` cross-tenant read to exactly one occurrence). `proactiveReview.test.ts` 8/8, backend 494/495 (sole red the pre-existing `audit.test.ts` auditCounts row), `@pikar/core` 195/195, web typecheck + `check-playbooks` exit 0, backend `tsc --noEmit` +0 new errors over the 52 pre-existing test-file ones.

**CARRY-FORWARD RESOLVED (13-02):** the repeat-run provenance collapse is **CLOSED** — option (b), not a fresh weekly thread. A date-derived thread id was rejected because `lastForThread` is indexed on `(tenantId, threadId)`: rotating it resets the Scorecard weekly, re-asks answered figures (breaking Phase-12's LOCKED store half), makes `delta` permanently `undefined`, and leaves 13-03 with no stable "the review thread" to render. Root cause instead: `provenance` is rebuilt from the corpus every run and never persisted, but `fillVault` returned EARLY when the slot was already carried — skipping the CITATION, not just the write. Now the VALUE is first-write-wins and the CITATION is re-recorded on every restatement (`!provenance.has(path)` keeps a `user-provided` cite from being downgraded); the two upstream short-circuits (`currentOffers.length === 0`, the `FINANCIAL_PATTERNS` `continue`) are gone. Regression-guarded by `proactiveReview.test.ts > notifies only on change` (run 2 must have the SAME finding count and an empty delta) — confirmed RED before the fix.

PRIOR (13-01): Wave 1. `evaluations.delta` (`{ newFindings, gapsClosed, gapsOpened }`, gap identity = `route/playbook`) is computed IN-ENGINE inside `runEvaluation({ withDelta: true })` and written through `insertEvaluation` — the append-only table gained no patch surface. `vaultDocuments.by_kind` is the ONE deliberately cross-tenant index (0 callers until 13-02's fan-out; yields tenant ids only, never content). `REVIEW_THREAD_ID`/`REVIEW_READY_MESSAGE`/`REVIEW_FAILED_MESSAGE` export from `@pikar/core` and are DELIBERATELY absent from `NOTIFICATION_KINDS` — that absence is the security property (`notifyExternal.dispatch` returns before `freshAccessToken`, so the review can never reach a Gmail token). Deviation: (Rule 1) returning the delta collapsed the whole generated Convex API to `any`/`{}` (Pitfall 9, 90 errors in `apps/web`) — fixed with a named `EvaluationDelta` type + explicit handler return annotation. Backend 485/486 (sole red is the documented pre-existing `audit.test.ts` auditCounts row).

**FOR 13-04:** the review surface is reachable three ways — the always-present pinned tab, `/dashboard/workspace?thread=proactive-review`, and the `weekly_review` notification (now a link). `EvaluationCard` must stay ONE dumb read of ONE `byThread` row: a new review affordance is another branch inside it, not a second query and not a second card ("no new card idiom" held and is worth holding). `KIND_HREF` in `NotificationsBanner` is the extension point for any future notification click-through (one line per kind; a kind with no entry keeps plain text). The composer is suppressed on the review thread ONLY — if 13-04 wants the user to ACT from the review, route them to a new chat (what the explainer already says) or extend the existing `Act on this` gap control; do NOT make the review thread sendable. `apps/web` has NO unit-test runner (only Playwright), so a real assertion on the card needs a spec plus a running `convex dev` and a seeded review row. Also: `/dashboard/profile` is rewritten by the tier/conversational-onboarding design doc scheduled AFTER Phase 13 — the thin-data CTA only needs that route to keep existing, so do not pre-emptively change the page.

**CONSUMED (was FOR 13-03):** read `api.evaluations.byThread({ threadId: REVIEW_THREAD_ID })` — one stable thread per tenant, latest row first. `delta` is populated from the SECOND review onward and `undefined` on the first (and on every on-demand cockpit evaluation), so render "what changed" conditionally; `newFindings` is meaningful only when `> 0`. The finding count no longer shrinks week over week — do not build UI that compensates for it. `NotificationsBanner` already renders `weekly_review` / `weekly_review_failed` (it shows every unread row except `gmail_reconnect`); a dedicated review surface must exclude them the way `ReconnectBanner` does or they double-surface. Do NOT add the review kinds to `NOTIFICATION_KINDS` and do NOT route the review through `notifications.notify` — both are asserted, both arm the mailbox.

Last activity (Phase 12): 2026-07-25 — Phase 12 plan 06 COMPLETE; PHASE 12 CLOSED. `pnpm eval:golden --skill cockpit-agent@15` → **27/27 PASSED, $0.1686, run `ed251c29`**; both new fixtures (27-grounded-assessment, 28-healthy-no-gaps) passed first try, one retry on the pre-existing flaky 18-briefing-then-action. **cockpit-agent@15 is ACTIVE** on that recorded evidence (verified live via `getActiveSkill`), teaching WHEN to call `evaluateBusiness` + the `recordScorecardAnswer` store half. The 7 Phase-12 rubrics needed no `activateSkill` — they had never been seeded, so their FIRST seed took the `rows.length === 0` bootstrap path and each landed **v1 ACTIVE** (SC #4 intact; only cockpit-agent rode the gate). Deviations: (Rule 2) `findingsPresent` added as a third expect key — `gapCount: 0` alone passes VACUOUSLY on the not-enough-data verdict because the engine force-clears gaps at zero findings; (Rule 3) the fixture-floor bump 18→27 moved from Task 1's commit to Task 2's. Five defects found and fixed during live verification (see PRIOR-FIXES below).

PRIOR-FIXES (2026-07-25, outside the plan's tasks, all committed): `d5814ae` shared `resolveMimeType` (Windows reports `File.type` `""` for `.md`); `f971613` literal extensions in `accept` (Chrome resolves accept MIME via the OS registry, which has no `text/markdown`); `b5e0f7f`+`7efa4f9` cockpit attachments now persist to the Knowledge Vault; `f5c279e` TWO grounding defects in the 12-03 engine — a large reference PDF monopolised the corpus (`rag.search` top-K is per CHUNK → grounding returned one 300-page book → "not enough data"), fixed by prepending the tenant's own profile-shaped docs via `internal.vault.profileSeedDocs`; and `fillVault` could never fill `identity.currentOffers` (empty-array default is not null), so `diagnose()` returned Gate 1 on EVERY vault-grounded run. Verified live after: growth-os, 8 cited findings, gap "Customer doesn't pay for themselves in 30 days" → `money-model-designer`.

PRIOR — Phase 12 plan 05 COMPLETE: the ACTING side of BEVL-02. `actOnGap` stages a gap as a proposed memo-plan through the pinned spine; `executePlan` branches on `plans.kind === "memo"` (before the mailbox pre-check) into a PERSIST terminal — a `next_step_memo` vault doc via `startIngest`, zero `requests` rows, `deliverApprovedPlan.ts` byte-unchanged. `buildMemo` is a deterministic grounded template naming the specialist (`gap.route`) + citing its playbook, never running it. "Act on this" is live and carries the ORIGINAL gap index through the `leverageRank` sort; `PlanCard` renders a NEXT-STEP MEMO variant on the SAME single Approve gate. Rule-3 deviation: `actOnGap` recycles the thread's one `plans` row (`byThread` is `.unique()`) and refuses `plan_busy` on an in-flight/delivered plan. gapAction 4/4, backend 474/475 (sole failure pre-existing), web typecheck + check-playbooks exit 0.

PRIOR — Phase 12 plan 04 CLOSED. evaluateBusiness read-tool + quiet recordScorecardAnswer write-tool in buildCockpitTools; EVALUATION card (findings + H/M/L chips + citations, ≤5 ranked gaps + more, healthy banner, distinct not-enough-data). Rule-3 deviation: recordScorecardAnswerInternal explicit-tenantId twin over a shared applyScorecardAnswer helper (the tool loop carries no live identity). Backend 470/471 (sole failure pre-existing), cockpitTools 57/57, web typecheck + check-playbooks exit 0. Task 3 visual check DEFERRED — the agent is never taught the tool (cockpit-agent.md: 0 mentions → 12-06 Task 2) and all 7 rubrics are gated-but-unactivated (EVAL_GATE → 12-06 Task 3), so the flow is not yet verifiable end-to-end. *(CORRECTED at 12-06: the rubrics were never SEEDED at all, not seeded-but-gated — `convex dev` alone does not seed. Task 3's debt is now PAID.)*

PRIOR — plan 03 COMPLETE: Business Evaluation Engine shipped. Dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward → ground via vaultGroundHydrated → pure diagnose()/leverageRank() → persist ONE cited row → refs-only evaluation.ran audit → evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (a user figure persists forward, cited user-provided, never re-asked); byThread feeds the card (plan 04). v1 findings deterministic (profile-parse + labeled-number scan); rich LLM narrative deferred to the plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over the SMOKE:: seam; check-playbooks exit 0.

Progress (v2.0): [███░░░░░░░] 25%  (4/16 phases complete; Phases 10 + 11 shipped 4/4 each, Phase 12 shipped 6/6, Phase 13 shipped 4/4, Phase 15 shipped 6/6 — 01, 02, 03, 04, 05, 06)

*v1.0 milestone (Phases 1-9, less the superseded Phase 9) shipped: governed email cockpit + guardrails + vault/GraphRAG + live voice + resilience/ops + self-improvement. That is the spine v2.0 builds on.*

## Milestone v2.0 Phase Map

| Stage | Phases |
|-------|--------|
| S1 Foundation & Intelligence | 10 Vault grounding · 11 Onboarding+profile · 12 Evaluation engine · 13 Proactive review · 14 Flagship voice-doc |
| S2 Breadth of Action | 15 Dispatch+executor · 16 Research+web · 17 Calendar · 18 Doc/content · 19 Contacts/CRM |
| S3 Creation & Self-Extension | 20 Media canvas · 21 User skills · 22 requireOwner · 23 Agent skills |
| S4 Governance & Open the Beta | 24 ISO 9001 map · 25 Private Beta Productionization (LAST) |

## Performance Metrics

**Velocity:** (v2.0)
- Total plans completed: 2
- Average duration: ~12 min
- Total execution time: ~25 min

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 15.4 | 01 | 35 min | 2 | 3 |
| 10 | 01 | 5 min | 2 | 3 |
| 10 | 02 | 20 min | 3 | 7 |
| 10 | 03 | 12 min | 2 | 2 |
| 15.1 | 01 | 31 min | 3 | 7 |
| 17.1 | 01 | 22 min | 2 | 5 |
| 17 | 02 | 35 min | 3 | 8 |
| 18 | 01 | 23 min | 2 | 2 |
| 15.3 | 03 | 105 min | 7 | 15 |
| 15.3 | 04 | 105 min | 6 | 17 |

**Recent Trend:** 10-03 landed clean (web typecheck + playbook check green; SourceCard reused the existing briefingSheet style — no new card idiom).

*Updated after each plan completion.*
| Phase 10 P04 | 15 | 3 tasks | 8 files |
| Phase 11 P01 | 10 min | 3 tasks | 11 files |
| Phase 11 P02 | 11min | 3 tasks | 4 files |
| Phase 11 P03 | 76 min | 3 tasks | 6 files |
| Phase 11 P04 | 40 min | 2 tasks | 5 files |
| Phase 12 P01 | 8 min | 3 tasks | 8 files |
| Phase 12 P02 | 17 min | 3 tasks | 19 files |
| Phase 12 P03 | 17 min | 3 tasks | 5 files |
| Phase 12 P04 | ~35 min | 2 of 3 tasks (Task 3 deferred) | 6 files |
| Phase 12 P05 | ~25 min | 3 tasks | 8 files |
| Phase 12 P06 | ~120 min (incl. human eval gate) | 3 tasks | 8 files |
| Phase 13 P02 | ~40 min | 3 tasks | 6 files |
| Phase 13 P03 | ~25 min | 3 tasks | 5 files |
| Phase 15 P01 | 35 min | 3 tasks | 15 files |
| Phase 15 P02 | 25 min | 3 tasks | 9 files |
| Phase 15 P05 | 13 min | 3 tasks | 6 files |
| Phase 15 P03 | 35 min | 3 tasks | 5 files |
| Phase 15 P04 | 35 min | 3 tasks | 8 files |
| Phase 15 P06 | 45 min | 3 tasks | 14 files |
| Phase 15.1 P01 | 31 min | 3 tasks | 7 files |
| Phase 15.1 P02 | 25min | 3 tasks | 3 files |
| Phase 15.1 P03 | 47min | 3 tasks | 11 files |
| Phase 15.1 P04 | 55min | 2 tasks | 4 files |
| Phase 15.1 P05 | 16min | 3 tasks | 17 files |
| Phase 15.1 P06 | 19min | 3 tasks | 9 files |
| Phase 15.1 P07 | 22min | 3 tasks | 5 files |
| Phase 14 P01 | ~140 min | 3 tasks | 21 files |
| Phase 14 P02 | ~20 min | 3 tasks | 5 files |
| Phase 14 P03 | ~25 min | 3 tasks | 5 files |
| Phase 14 P04 | ~18 min | 2 tasks | 3 files |
| Phase 15.2 P01 | 35m | 4 tasks | 7 files |
| Phase 15.2 P02 | 25m | 3 tasks | 6 files |
| Phase 17.1 P05 | 27min | 2 tasks | 3 files |
| Phase 17.1 P06 | 29min | 2 tasks | 4 files |
| Phase 17.1 P07 | 39 min | 3 tasks | 11 files |
| Phase 17 P03 | 37 min | 2 tasks | 3 files |
| Phase 17.1 P08 | 11h 49m | 2 tasks | 4 files |
| Phase 17 P04 | 12h 1m | 3 tasks | 5 files |
| Phase 17.1 P09 | 25 min | 2 tasks | 5 files |
| Phase 15.4 P02 | 40min | 4 tasks | 11 files |
| Phase 15.4 P03 | 23 min | 3 tasks | 9 files |
| Phase 19 P01 | 35m | 3 tasks | 6 files |

## Accumulated Context

### Roadmap Evolution

- Phase 27 added: Curated Knowledge-Work Pack Pilot
- Phase 28 added: Connector-Backed Revenue Pack
- Phase 29 added: Unified Knowledge and Routines
- Phase 30 added: Optional Vertical Workflow Packs
- Phase 15.4 inserted after Phase 15: Vault redesign and scoped browse correctness (URGENT)
- Phase 26 added: Pending product pages and Vault redesign integration
- Phase 15.3 inserted after Phase 15.2: Vault Folders — Folder Ingest, Synthesis & Drill-In
  (2026-08-02). **Not new scope — a slot for scope that already existed and was homeless.** Phase
  15.2 carved this out as "Phase 2 of this line of work" at `15.2-CONTEXT.md:170-184` and sequenced
  it AFTER itself because the per-file cap raise to 200 MB was unsafe until the extraction fan-out
  bounded per-action memory. 15.2 shipped that fan-out on 2026-07-27, clearing the blocker, and the
  work then sat in no phase for six days. Surfaced 2026-08-02 by the owner asking where the folder
  and file UI changes had gone: the FILE half had shipped (`DocGrid`, `PreviewModal`, `CategoryTabs`,
  `Dropzone`, `VaultStats` all live under `apps/web/app/(app)/dashboard/vault/`), while the FOLDER
  half had zero code — `folderId` and `vaultFolders` return zero hits across `schema.ts` and the
  whole vault UI. That asymmetry is why the deferral was cheap: the drill-in was always specified as
  "reusing `PreviewModal`", and `PreviewModal` already exists.
  Scope is the five carve-out items verbatim: `vaultFolders` + optional `folderId` (zero-migration
  optional widening), 1–1.5 GB folder upload + the 200 MB cap raise, folder-level synthesis where
  **the digest IS ITSELF a vault document** so it embeds and grounds through the existing rails,
  the folder-scoped drill-in, and a per-folder budget estimate + reservation.
  **The reservation is the load-bearing item, not polish.** Every ingest opens with
  `guardrails.preCall`; a large folder can trip the daily budget mid-run and leave half its
  documents `failed`, and a half-ingested folder is WORSE than a refused one because the agent
  grounds on it confidently without knowing what is absent. Estimate and reserve the whole folder
  before the first document, or refuse it intact.
  **Unblocks Phase 17.1**, whose Stage-2 blueprint drift is specified to fire on bulk/folder-ingest
  completion and degrades to the Stage-1 one-click rebuild banner until this exists
  (`17.1-RESEARCH.md:114-115`, `17.1-CONTEXT.md:201-207`). Placed at 15.3 rather than later so it
  precedes 17.1 in roadmap order.
  ⚠ `gsd-tools phase insert` wrote the Phase Details section but NOT the top-level checklist line —
  the known silent-no-op gotcha. The checklist entry and the Goal block were hand-written.

- Phase 22.1 inserted after Phase 22: Beta Admission Readiness — legal/deployment readiness,
  reliable CI/typechecking, and identity-boundary hardening (URGENT, 2026-07-29). This is the
  explicit admission gate the owner requested before a second beta user. It stays separate from
  GOVN-01's narrow `requireOwner` primitive and from Phase 25's broader invite/onboarding/Outlook
  scope; planning must distinguish code-verifiable readiness from external legal-entity or provider
  approval dependencies and must never invent legal facts.

- Phase 15.2 inserted after Phase 15: Vault Universal Format Recognition & Extraction Fan-Out (URGENT, 2026-07-27). Origin: owner-reported "the vault has been reading this document for 10+ minutes". Diagnosed live off the deployment — a `.xlsm` sat at `pending_extraction` ~20h with 0 chars and NO `failureReason`, because `extractionKindFor` returns `null` for any MIME outside a three-entry allow-list and `null` schedules no extraction action. Two further defects confirmed off the same table: scanned PDFs extract a SUMMARY (2161 chars for a 12-slide deck — all pages ride one call), and a `ready` row still carries a stale `failureReason` from before its successful retry. Ruled out with measurements so it is not re-investigated: `@pikar/pii` `scanText` is NOT a bottleneck (400k chars of prose 8 ms; 112k of tab-joined spreadsheet rows 4 ms). Spec: `docs/superpowers/specs/2026-07-27-vault-format-coverage-and-extraction-fanout-design.md` (owner-approved, incl. the SheetJS-from-CDN dependency call). Runs as a THIRD concurrent lane alongside the live Phases 16 and 17 — needs a file-ownership contract in `.planning/PARALLELIZATION.md` before implementation starts, since Lane R (16) stores web research in the vault and `vault.ts` is a plausible overlap. Folders / 1.5 GB uploads / the 200 MB cap raise are deliberately Phase 2 of this line — the cap raise is unsafe until the fan-out bounds per-action memory.

- Phase 17.1 inserted after Phase 17: Business Blueprint — Corpus Synthesis & Agent Spine (2026-07-27). Origin: owner idea — "the system reads a company folder, maps the business into a blueprint, and that blueprint becomes how the agents navigate that business". Analysis found the gap is real but is NOT extraction: every agent surface (cockpit `llm.ts`, `onboarding.ts`, `evaluations.ts`, `voiceDoc.ts`, `tenantProfile.ts`) reaches the business through ONE function, `vaultGroundHydrated` — a per-query RAG search capped at 8000 chars. It answers "which passages mention X", never "what IS this business". Three partial blueprints already exist and none is corpus-wide or agent-facing: the typed profile (`businessProfile.ts`, 8 hand-typed fields), the entity graph (`graphNodes`/`graphEdges` — extracted per document, used ONLY to hop-expand retrieval seeds, never rendered or reasoned over), and the eval scorecard (`evaluations.ts:250-320` — already reads docs into a structured model with per-field citations, but query-scoped and not agent-facing). Locked owner decisions (spec §2.1): D1 standing spine + retrieval, not spine instead of retrieval; D2 draft → user confirms → live (consistent with `decideConfirm`/SC#1); D3 auto-detect drift and propose a diff, no cron by default; D4 content = profile fields + graph entities; **D5 typing is never removed and never overwritten — both entry routes (type it / upload it) are permanent, and a one-line edit costs no model call and no confirm step.** Owner explicitly rejected an earlier framing that read as replacing typed input with document derivation. Precedence is a PURE `mergeBlueprint()` in `packages/core/`, never a prompt — the model returns derived candidates only and is never shown the live blueprint. Spec: `docs/superpowers/specs/2026-07-27-business-blueprint-design.md`. **NOT a fourth concurrent lane** — sequenced after 15.2/16/17 merge because it edits `vaultGround.ts`, which Lane R (16) also touches. Folder ingest (15.2's "Phase 2") and visual rendering/diagrams are deliberately out of scope.

### Decisions

Full log in PROJECT.md Key Decisions. Recent decisions affecting v2.0:

- [Phase 15.4 / 15.4-01]: Vault search uses a dedicated search-only metadata resolver so grounding's order-sensitive `ownedDocsMeta` remains byte-identical.
- [Phase 15.4 / 15.4-01]: Foreign and missing folder scopes return the same empty result; optional `folderId` is not an ownership oracle.
- [Phase 15.4 / 15.4-01]: VALT-16 stays Pending after plan 1/4 because its requirement text includes the full redesign and retained-control UAT.
- [Phase 17 / 17-03]: **Calendar tools stop at the staging boundary.** `checkAvailability` returns content-free busy ranges from the trusted client clock; `proposeCalendarEvent` atomically patches all four event fields at `status: "proposed"` and cannot create an event. ACTN-02 stays pending for 17-04 and the recorded deferred-manage scope.
- [Phase 17 / 17-02]: **Calendar uses one widened Google grant and a two-module terminal split.** `calendar.ts` is a Node actions-only adapter; `calendarComplete.ts` is non-Node and the sole writer of Calendar plan status, audit, reconnect notifications, and dead letters. Stored scope is checked before refresh, and deterministic event IDs make Google 409 duplicate an idempotent success. ACTN-02 stays pending until the later Phase-17 plans wire the complete action surface.
- [Phase 17.1 / 17.1-01]: **The blueprint field set is closed and bound by ONE `as const satisfies Record<BlueprintField, FieldSpec>` table** carrying `label`/`list`/`cap`/`derivable`/`probe`. Deliberately NOT a switch — a `default` branch makes a new field silently inherit another's behaviour and makes the coverage test vacuous forever. Mutation-verified: a 12th field with no spec entry ⇒ `TS2741`. Every later 17.1 plan (diff, serializer, spine caps, candidate gate) indexes this one table rather than re-enumerating the fields.
- [Phase 17.1 / 17.1-01]: **The stored blueprint markdown uses the plain `- <Label>: ` scalar shape and must NEVER emit `- **Persona:**`** — that exact string is the business-profile DETECTOR in `evaluations.ts` and `vault.profileSeedDocs`, so a blueprint wearing it is misread as a profile doc by both. Mutation-verified (bold marker ⇒ 4 RED). It is also byte-deterministic with no date and no document count: both are computed at READ time in the spine, and baking either in would make every rebuild "differ", breaking the drift diff and the `contentHash` dedup.
- [Phase 17.1 / 17.1-01]: **`BLPR-01` stays PENDING until the phase actually delivers it.** Six of the phase's ten plans claim it and its text covers the confirm gate (17.1-08's), so `gsd-tools requirements mark-complete` flipping it after plan 1 of 10 was reverted. A requirement checkbox is a claim, not a progress bar.
- [Phase 17.1 / 17.1-01]: **A playbook's `Last verified` is only bumped by the plan that OWNS it.** `check-playbooks` blocked on `skill-registry.md` and `vault.md` for other lanes' uncommitted work; satisfying it would have written a verification claim about a diff this plan never read. Report, don't discharge someone else's §9 obligation.
- [v2.0 open]: Build platform breadth BEFORE opening the beta — former Phase 9 productionization moves to the milestone's END (now Phase 25).
- [Roadmap]: `requireOwner` (GOVN-01) pulled EARLY to Phase 22 — it must exist before agent-authored skills (Phase 23) activate and before multi-user (Phase 25).
- [Roadmap]: BEVL market-fact grounding depends on web research (Phase 16); Phase 12 evaluation scopes to vault-grounded findings until then.
- [Architecture]: Every v2.0 capability is one of two shapes — a read-only tool returning content in-loop, or a write staged into the plan for the human Approve mutation. No third mechanism.
- [Phase 10]: ADR-006: vault chunks are trusted-as-own — enter the agent loop directly (SC2-fenced), not through the toolless-ingestion firewall; fence + human Approve gate are the backstops
- [Phase 10]: 10-04: vault-grounding teaching is candidate cockpit-agent@13 (versioned skill, §5), gate-activated only; the 'not on compose turns' clause guards the 23 existing golden fixtures
- [Phase 10]: 10-03: the SourceCard reuses the existing briefingSheet opaque --card style (no new card idiom); titles link to /dashboard/vault (doc-level, no new query) — inline PreviewModal click-through deferred behind a getVaultDoc(byId) query
- [Phase 11]: 11-01: business-profile skill is UNGATED (mirrors voice-brief) — output is a human-confirmed vault doc, not tool-state; not in GATED_SKILLS
- [Phase 11]: 11-01: SC#1 encoded as pure decideConfirm returning literal { needsConfirm: true } — persona auto-commit impossible at the type level; enterprise not an emittable Persona
- [Phase 11]: 11-02: onboarding is a thin adapter — the profile is 'just another vault doc', so embed/tenant-scope/retrieval come free from startIngest/vaultGroundHydrated; new work is only the extraction call + §4-safe audit
- [Phase 11]: 11-02: extractProfile writes nothing (no doc, no audit) — SC#1 confirm-not-assume is structural; the sole write path is the separate human-confirmed commitProfile
- [Phase 11]: 11-03: first-run gate lives in the client <Authenticated> AppShell (useQuery(api.onboarding.status) redirect), NOT middleware.ts — middleware has no DB access (RESEARCH Pitfall 4, eternal-spinner class)
- [Phase 11]: 11-03: onboarding reuses the conversational chat SURFACE but routes extraction through the UNGATED business-profile skill, not the gated cockpit-agent — keeps onboarding tweaks out of the EVAL_GATE cycle / off the ~25 golden fixtures (RESEARCH Pitfall 1)
- [Phase 11]: 11-03: sparse-start — REQUIRED_STRINGS relaxed to [oneLineDescription] + confirmed persona; name/stage/offering/targetCustomer optional so idea-stage users (ONBD-02 'business/idea') can commit and are enriched later (46a86c3)
- [Phase 11]: 11-04: profile page is the post-onboarding editability/enrichment surface — save re-embeds via updateProfile so grounding stays current; the committed vault-doc markdown is the single record, getProfile parses it back with deserializeProfile (round-trip test binds the two)
- [Phase 12]: 12-01: Growth diagnostic math ported to pure-TS packages/core/src/growth (ltgpCac/cfa/diagnose); Convex-free (CLAUDE.md §1)
- [Phase 12]: 12-01: unknown financial input → diagnose emits ask (empty route/proofMetric) at the money-model gate — an all-null Scorecard never falsely reaches 'scale' (BEVL-01 no-fabricated-metrics guarantee in the type system)
- [Phase 12]: 12-02: 7 evaluation/specialist skills registered as GATED (4 framework rubrics + 3 specialist targets); bootstrap seeds v1 active, edits publish eval-gated candidates activated only via plan-06 (SC #4). growth-os-diagnostic folds diagnose() gate order + financial spine + 7-level positioning into ONE body; the 3 persona-fallback bodies (swot=SME, lean-canvas=solopreneur, bmc=startup) carry the shared grounding rubric (per-finding vault cite, H/M/L confidence, explicit not-enough-data state, no numeric %, affirmative healthy state). Original wording, NO Hormozi book text; contracts-side skillBodies.test.ts enforces md↔ts byte-identity.
- [Phase 12]: 12-03: evaluation engine SHIPPED — dedicated append-only evaluations table (by_tenant SC#5 / by_tenant_thread) + runEvaluation (carry-forward→ground via vaultGroundHydrated→pure diagnose()→persist cited row→refs-only evaluation.ran audit→evaluateBusiness step). recordScorecardAnswer = the LOCKED store half (user figure persists forward, cited user-provided). v1 findings deterministic (profile-parse + labeled-number scan); LLM narrative deferred to plan-06 eval gate. Zero grounded findings → insufficient + suppressed gaps (no fabricated diagnosis, SC#1). 6/6 convex-test over SMOKE:: seam.

- [Phase 12]: 12-04: cockpit surface shipped — evaluateBusiness (read, CLOSED framework enum so the model can't inject prose, readPlan cross-tenant guard, fail-open SC1, CAPPED synopsis into the loop, SMOKE_OP_TOOL entry) + recordScorecardAnswer (write, {field,value}, cited user-provided, NOT plan-gated — a self-reported fact isn't an outbound action — refs-only audit, QUIET so no agentStep/tool-union entry). EVALUATION card is a dumb renderer over byThread: H/M/L ConfChip on globals.css color-mix tokens, ≤5 leverage-ranked gaps + a "more" disclosure, DISABLED "Act on this" (handler = plan 05), affirmative healthy banner on --released, and an insufficientBox never styled as a gap. No numeric % anywhere.
- [Phase 12]: 12-04: recordScorecardAnswerInternal (explicit-tenantId internalMutation twin) added because the cockpit tool loop carries NO live identity — a tenantMutation is uncallable from a tool. Both it and the public mutation delegate to ONE applyScorecardAnswer helper so the tenant-scoping/carry-forward write path can't drift.
- [Phase 12]: 12-05: MEMO TERMINAL — a plan now carries an optional closed `kind: "memo"` discriminator and `executePlan` branches on it AFTER the CAS read and BEFORE the mailbox pre-check: the body persists as a `next_step_memo` vault doc (startIngest, the persistBrief precedent) and the plan goes done with ZERO requests rows seeded. deliverApprovedPlan.ts is byte-unchanged (verified by diff) — the gmail fan-out is structurally unreachable from a memo, not merely unused. One Approve gate, two promises; the generalized executor (ACTN-01) generalizes THIS branch in Phase 15, it does not widen the gmail one.
- [Phase 12]: 12-05: actOnGap RECYCLES the thread's single plans row (resetPlan→patchPlan) rather than inserting a second — `plans.byThread` is a `.unique()` read, so a second row per thread throws for every workspace reader. resetPlan (not patchPlan) because patchPlan drops undefined and could never clear a half-composed email's slots onto the memo; resetPlan now also clears `kind` (a reset must drop the memo SHAPE or the next fresh compose silently saves instead of sends). A mid-flight/delivered plan refuses with `plan_busy`.
- [Phase 12]: 12-05: the memo NAMES the specialist (gap.route) and cites its playbook — it does not run it (Phase 15+). buildMemo is a deterministic template over the persisted row (gaps[] gained optional reason/proofMetric at diagnose time so the memo is a pure READ, never a second drift-prone derivation); it is a document the user reads, NOT an agent prompt, so §5 does not apply — but it may assert no figure the evaluation did not ground.
- [Phase 12]: 12-05: PlanCard branches on kind === "memo" — the email chrome (recipients, mode, send-time picker, "Send to N recipients") would every word be a lie on a memo, at the exact surface where the human gives irreversible consent. Same approve() handler reused, so there is still exactly ONE Approve gate.
- [Phase 12]: 12-06: `findingsPresent` is a THIRD expect key beyond the plan's two — the engine force-clears gaps at zero grounded findings (SC #1), so `gapCount: 0` alone passes VACUOUSLY on the honest not-enough-data verdict. Pairing the two is what makes 28-healthy-no-gaps assert HEALTH rather than emptiness.
- [Phase 12]: 12-06: a GATED skill's FIRST seed lands v1 ACTIVE (the `rows.length === 0` bootstrap path) — gating costs nothing until a skill's first body EDIT. The 7 Phase-12 rubrics were never seeded on this deployment (`convex dev` alone does not seed; only `pnpm dev` / `npm run seed` runs `skills:seedSkills`), so they self-activated at v1 and only `cockpit-agent` rode the gate (→ **@15**, on 27/27 passing evidence, $0.1686, run `ed251c29`). This CORRECTS 12-04's "seeded but gated-not-activated" inference.
- [Phase 12]: 12-06 (verification-driven, `f5c279e`): grounding must PREPEND the tenant's own profile-shaped docs (`internal.vault.profileSeedDocs`) — `rag.search` top-K is per CHUNK, so one large reference PDF monopolises the corpus and the engine honestly reports "not enough data" while the user's own profile sits unread. Paired defect: `fillVault` could never fill `identity.currentOffers` (an empty-array default is not `null`), pinning `diagnose()` to Gate 1 on every vault-grounded run.
- [Phase 12]: 12-04: Task 3 human-verify DEFERRED to 12-06 (owner decision) — **PAID at 12-06; owner ran all three accumulated visual checks and approved 2026-07-25** — the plan's checkpoint asked for end-to-end verification of a flow whose two enabling halves land in 12-06 (agent teaching = Task 2, EVAL_GATE rubric activation = Task 3). Verified-not-litigated: cockpit-agent.md has 0 evaluate/scorecard/swot/diagnose mentions; all 7 Phase-12 rubrics are in GATED_SKILLS. Workarounds refused: no gated skill activated, no teaching hardcoded (§5), no throwaway seeding.
- [Phase 13]: 13-02: PINNED THREAD + close the provenance gap (option b), NOT a fresh weekly thread id. `lastForThread` is indexed on (tenantId, threadId), so rotating the id resets the Scorecard weekly, re-asks answered figures (breaks Phase-12's LOCKED store half), makes `delta` permanently undefined, and leaves 13-03 with no stable review thread. Fixed the engine instead: `fillVault` records a CITATION on every restatement while the VALUE stays first-write-wins.
- [Phase 13]: 13-03: the pinned review tab is a REAL Tab seeded into useState<Tab[]>([REVIEW_TAB]), not an element rendered beside the strip — that is what makes the ?thread=proactive-review notification deep-link dedupe for free (openThread already skips ids it is showing). No persistence needed: the thread id is deterministic, so 'tabs are session-only view state' still holds.
- [Phase 13]: 13-03: the COMPOSER is suppressed on the review thread; the cockpit.ts:93 'plan row missing for thread' guard was NOT loosened. Reading the synthetic thread already degrades gracefully (empty message page, null plan/briefing, absent from listThreads), so the send path is the only broken one — and that guard protects every real cockpit thread from a plan-less send. Recorded in cockpit.md as an explicit anti-fix.
- [Phase 13]: 13-03: the review branch is checked BEFORE the gmail-status branch — the review has nothing to do with a mailbox, so a never-connected user must still see it (SC#2 at the surface). And the empty state branches on evaluation === null specifically, not falsiness: undefined is still loading, so a falsiness gate would flash 'first review runs Monday' on every load of a thread that HAS a review.
- [Phase 13]: 13-03: deltaLine stayed INLINE in cards.tsx rather than moving to @pikar/core for a unit test — apps/web has no unit runner (only Playwright) and CLAUDE.md §8 forbids standing up frameworks for a check; the failure mode is a cosmetic plural, and the cross-package move (new file + test + watch.json + playbook) is a bigger diff than the 8 lines it would guard. Also: the profile CTA uses --teal-900 not --teal-600 (BRAND §6 — teal-600 is ~2.9:1, a button FILL color, not small text).
- [Phase 13]: 13-03: KIND_HREF is an OPT-IN kind->href map, so absence is the default and no existing notification kind changed behaviour. The hrefs are code-owned constants built from @pikar/core, never derived from row data (no row can steer a user), and message is a static §4 label so using it as link TEXT carries no PII. Routed over the existing VOIC-04 ?thread= deep-link — no new route.
- [Phase 15]: 15-01: the no-nested-loop scan counts TOOL-BEARING generateText call sites, not total ones — llm.ts legitimately holds 3, two being the TOOLLESS ingestion firewall (digestInbox/draftReply) already pinned by llmRedaction.test.ts. Counting raw sites would break whenever that firewall grew a legitimate member while still missing a second loop hidden inside a tool. Also: runAgentLoop passes tools by SHORTHAND (tools,), so the scan matches tools\s*[,:] — a colon-only regex silently counted 0.
- [Phase 15]: 15-01: ZERO lineage schema change was needed for SC#3 (RESEARCH Q5 held) — AuditPayload already permits rootRequestId/parentAgentId, audit.by_correlation already exists, and telemetry structurally cannot carry them (requestId: v.id("requests"), and a specialist run seeds zero requests rows by design). PARALLELIZATION Stage-1 item (1)'s 'lineage fields' was a no-op; what Wave 0 actually needed were the three agentSteps.tool literals.
- [Phase 15]: 15-01: dispatch literals are N LITERALS on the closed agentSteps.tool union, never a specialist: v.string() field — §4 on the trace plane is enforced by the ABSENCE of anywhere to put text, and a string field would re-open the hole the closed union closed. Guarded by dispatch.test.ts inserting each literal against the REAL schema (a missing literal throws inside an SDK callback, which the SDK SWALLOWS).
- [Phase 15]: 15-01: resolveSpecialist uses Object.prototype.hasOwnProperty.call, not a bare SPECIALISTS[route] index read — "__proto__"/"constructor"/"toString" resolve to TRUTHY Object.prototype members, so a truthiness guard would happily route on them. Mirrors parseRouting: discriminated result, never a throw, NO default specialist. The runtime branch stays load-bearing after 15-02 narrows the type, because gap.route persists as v.string() including diagnose.ts's deliberate "".
- [Phase 15]: 15-01 (owner): Phase 15 executes SERIALLY on lane-a/dispatch-core, not in 2 parallel lanes. The Wave-0 freeze still ran in FULL (the seams are real architecture), only its 'land on main to unblock lanes' framing is moot. PARALLELIZATION.md's Phase-15 table was finalized anyway and is retained as the FILE-OWNERSHIP CONTRACT. apps/web is FROZEN after Wave 0 (the VERB map was Phase 15's only web edit); watch.json is a Wave-0 singleton; cockpit.md is append-only per-plan subsections.
- [Phase 15]: 15-02: the sub-agent BODY is registry-owned (§5) but the TOOL-SET is CODE-owned (ADR-007) — a tool-set is a CAPABILITY GRANT, not a prompt, and §5's eval gate stands in front of words, not capabilities. A DB-writable tool list would let a row edit widen what a sub-agent can do with nothing in front of it. SPECIALISTS stays a pure readonly data record in @pikar/core, which is also the seam 15.1 plugs its tier filter into.
- [Phase 15]: 15-02: withholding a tool from a specialist is STRUCTURAL ABSENCE from the tool record, never ai@7's activeTools and never skill wording — activeTools leaves the withheld tool's execute closure in the record and reachable via invokeTool (llm.ts:1602). The omitRecipientEdits precedent generalized. runAgentLoop's toolNames tests === undefined, not truthiness: [] must yield an EMPTY record, and a truthiness test would hand a zero-tool specialist all 20 keys.
- [Phase 15]: 15-02: evaluateBusiness is deliberately NOT in any specialist's grant despite its read-shaped name — it calls internal.evaluations.runEvaluation, which persists an evaluations row + an audit row per call and re-enters the engine mid-dispatch. The evaluation snapshot reaches the specialist through its PROMPT (internal.evaluations.lastForThread) instead. Reasoning pinned as a comment on the registry so a later phase does not 'fix' it.
- [Phase 15]: 15-05: armFor is a `satisfies Record<ActionType, Arm>` TABLE in @pikar/core, never the ternary the plan specified — a ternary is TOTAL by construction, so widening ACTION_TYPES would compile fine and silently classify a new type as `inline`, voiding the plan's own "adding an action type without an arm is a COMPILE error" guarantee and making its `armFor(t) !== undefined` totality test vacuous forever. Verified by mutation: adding "calendar" fires TS2741 in actionType.ts, actionType.test.ts and cockpit.ts.
- [Phase 15]: 15-05: cockpit.ts keeps its OWN `_ARM_TABLE` bind on top of core's table because the `workflow` case in executePlan's switch falls through to the GMAIL FAN-OUT — a new ActionType that merely classified as `workflow` would inherit the email terminal without anyone deciding to, undoing what 12-05 bought by leaving deliverApprovedPlan.ts untouched. assertNever covers a new ARM; _ARM_TABLE covers a new TYPE. So "zero spine edits" means the spine's STRUCTURE never changes — a new type still adds one compiler-demanded line.
- [Phase 15]: 15-05: two-level dispatch — executePlan picks the arm, deliverApprovedPlan.ts is the workflow-backed EMAIL arm's entry point and NOT the universal dispatcher (byte-unchanged, enforced by `git diff --exit-code` in the plan gate). A future inline arm executes inline; a future durable arm starts its OWN workflow. Arm selection stays exactly where 12-05's memo `if` sat — after the CAS read + escalated guard, before the mailbox pre-check — and gapAction.test.ts now asserts BOTH sides of that position.
- [Phase 15]: 15-02: the 'incomplete — cost ceiling reached' marker lives in the memo BODY, never on the plan row — a new plans.status literal would touch the PINNED status enum (schema.ts:155-164) with apps/web blast radius, and the body is visible at the Approve gate where the human actually decides. runAgentLoop stays module-private; runSpecialistTurn is the ONLY exported specialist entry, which is what keeps 'no agent spawns an agent' checkable by reading one file.
- [Phase 15]: 15-03: the guard ORDER is load-bearing — resolve -> depth -> cycle -> envelope -> run. resolveSpecialist is FIRST because gaps[].route persists as v.string() (schema.ts:350) including diagnose()'s deliberate "", so rows written before 15-02 closed the union reach it un-narrowed; the envelope check is LAST so a refusal that costs nothing is never charged against the tree. All four refusals RETURN a conversational reply with ZERO deadLetters, ZERO model spend and ZERO agentSteps rows — a refused dispatch never started.
- [Phase 15]: 15-03: the cost envelope is a TREE-LOCAL SECOND ceiling over the deployment-wide dailySpendCents rail, never a replacement — floor(remaining x 0.25) derived at the ROOT only, with a non-zero incoming value carried through UNCHANGED (that is what makes it ONE tree ceiling instead of a fresh allowance per hop). NOT guardrails.preCall, which checks {count:1} = 'is there ANY budget left', not 'enough for this call'. An overrunning hop KEEPS its output and is labelled incomplete: true — stop AFTER the call that overran.
- [Phase 15]: 15-03: SC#3 lineage is audit-ONLY with correlationId := rootRequestId — by_correlation already existed, so the call tree reconstructs and its cost sums to the root with NO new table, NO new index and NO schema change. Three deliberate NON-decisions pinned as source comments: no subAgentRuns table, no telemetry mirror (telemetry.requestId is v.id("requests") and a specialist run seeds zero requests rows by design), nothing on agentSteps (a shadow log there would be a section-4 regression).
- [Phase 15]: 15-03: ADR-008 — depth/ancestry/envelope/spend travel as validator-checked internalAction args, never DB state. A Convex action has no ambient ctx and a ctx cannot be extended across runAction, so the only alternative was a row: a lost-update race on the one field whose job is to be a ceiling, for zero benefit at depth 1. rootRequestId is minted fresh and is NEITHER planId (recycled per thread, 12-05) NOR plans.correlationId (only set at executePlan, i.e. after Approve).
- [Phase 15]: 15-03: a cross-tenant isolation test must assert NON-EMPTY partitions on BOTH sides — a zero-size partition passes a naive no-leakage check vacuously. And it must read the audit table DIRECTLY: audit has no public tenant-scoped reader, so the plans.byThread form alone would prove isolation of the PLAN, not of the lineage rows SC#5 names. Driven under a deliberate rootRequestId + threadId collision, not two unrelated runs.
- [Phase 15]: 15-04: actOnGap STAYS a tenantMutation and SCHEDULES the specialist — a Convex mutation cannot call an action, and a tenantAction would make the resetPlan+patchPlan recycle interruptible while still leaving the card blank for the same 30s. It stages status: "collecting" with an EMPTY body, and THAT is the Approve-race mitigation: executePlan already refuses any non-proposed row (cockpit.ts:530), so the race closes BY CONSTRUCTION — no new guard, no new status literal, and zero apps/web edits (PlanCard renders only at proposed, cards.tsx:1624). Do not "simplify" it back to proposed: the failure it prevents is a user approving a TEMPLATE under a specialist attribution header, at the exact surface where consent is irreversible.
- [Phase 15]: 15-04: the terminal is chosen by a RUNTIME resolveSpecialist(gap.route) at the ENTRY point, not only inside the dispatcher — a gap with no registered specialist ("" from diagnose()'s ask branch, "scale" from its healthy branch) keeps the 12-05 memo at proposed with NOTHING scheduled. landSpecialistResult is the ONLY writer of a dispatched body and no-ops unless the row is still collecting, still kind: "memo", and under the SAME tenantId (an explicit-tenantId internal twin carries no live identity, so that check is manual — mutation-checked: removing it lets a finished run clobber a canceled plan's own draft).
- [Phase 15]: 15-04: dispatchAndLand lands in a `finally`, so "the plan always leaves collecting" is as unconditional as "a started step always ends" — success, overrun, all four refusals, and a throw. A THROWN turn is NOT a fifth refusal: it audits subagent.refused with the CODE only (never err.message, §4), DLQs nothing, lands the fallback, and RETHROWS — DispatchResult's union is the GOVERNED-stop contract, and swallowing an exception would hide a real bug (the §5 loader fails closed by throwing) from the scheduled function's own failure state.
- [Phase 15]: 15-04: buildMemo is now the FALLBACK and its wording BRANCHES — 12-05's "That specialist does not execute yet" became FALSE the moment dispatch shipped, and an approved memo may not tell the user something untrue. The reason is a CODE mapped through a code-owned FALLBACK_SENTENCE map and never surfaces. The attribution line and the cost-ceiling marker ride the plan BODY (specialistMemoBody), never a plans.status literal — the enum is PINNED with apps/web blast radius.
- [Phase 15]: 15-04 (test infrastructure, generalizes): convex-test FLUSHES due scheduled work in the background, so any test that schedules a PRODUCTION action and does not cancel it has a hidden dependency on whether OPENAI_API_KEY is set — the e2e test lost that race to a real gateway call. Assert the queued job through ctx.db.system (_scheduled_functions: name + args), CANCEL it, then replay its EXACT args through the offline twin.
- [Phase 15]: 15-06: citesVaultDoc probes the seeded corpus NEEDLE (evalgrd), not a vault title root — a title root is echoed straight out of the fixture's own turns, so the assertion would pass without searchVault ever running; validateFixture forbids any turn from containing the needle
- [Phase 15]: 15-06: SKILL_NAMES is DERIVED from GATED_SKILLS (read off skill.ts) and --skill is MULTI-pin with one evidence row per pin — a newly gated skill is pinnable the day it is gated, and one run certifies a whole family
- [Phase 15]: 15-06: the specialist-body EVAL GATE is UNPAID (no CONVEX_DEPLOYMENT in this worktree) — SHIP DARK per CONTEXT: candidates park, active v1 bodies stay live, nothing faked or hand-activated
- [Phase 15.1]: Tier thresholds LOCKED (paidStaff===0 && headcount<=2 => solopreneur; else not(steady-revenue AND bootstrapped) => startup; else sme) — retuned via the test boundary table, NEVER a config row (D2)
- [Phase 15.1]: D6 is expressed as a TYPE: deriveTier returns DerivedTier (3 members), enterprise lives only on the table — mutation-checked @ts-expect-error bind
- [Phase 15.1]: tenantProfiles facts are ALL optional and never narrowed (the design §10 legacy backfill row must stay representable); tier/tierSource/derivedAt REQUIRED
- [Phase 15.1]: ADR-009: tier shapes the specialist PROMPT, not the offer set — diagnose() emits ONE prescription, so SC#5 must not be read as offer-set filtering or a rubric change
- [Phase 15.1]: saveFacts has NO tier argument and never will: the tier is a derived OUTPUT of the facts write. Its return is {tier, tierSource, changed} — enums plus a flag, safe to return and to log.
- [Phase 15.1]: tierSource 'admin' stickiness lives in saveFacts, not grantEnterprise — saveFacts is the only function that could undo an operator grant, so the guard sits at that one site.
- [Phase 15.1]: tenant.tier_changed payload is exactly {from,to,tierSource,factsChanged} on the existing insert-only internal.audit.log — no tierHistory table, and factsChanged is a COUNT (0..5), never a fact value.
- [Phase 15.1]: derivedAt is refreshed on an unchanged re-derivation (it records when the RULE last ran); the audit EVENT records when the answer moved. Two questions, two mechanisms.
- [Phase 15.1]: commitProfile is the design 6 completion gate (INCOMPLETE_ONBOARDING + missing[]); updateProfile deliberately has NO slot gate (design 10, no forced re-onboarding) but fails closed on a MISSING tier row with INCOMPLETE_FACTS
- [Phase 15.1]: personaConfirmed is DELETED from both audit payloads, not corrected — the audit is insert-only so a false historical row cannot be repaired; payload key sets are now exactly {fieldCount,tierSource,vaultDocId} and {fieldCount,reembed,tierSource,vaultDocId}
- [Phase 15.1]: BusinessProfile.persona widened Persona->Tier for the PROJECTION only (the markdown LABEL stays '- **Persona:**' because evaluations.ts detects the doc by it); ProfileInput = Omit<BusinessProfile,'persona'> is the persona-free WRITE shape
- [Phase 15.1]: 15.1-04: the framework auto-pick reads tenantProfiles.tier via internal.tenantProfile.forTenant; personaHint deleted — the last authoritative reader of the markdown persona is gone, closing defect 1d on the read side
- [Phase 15.1]: 15.1-04: TIER_FRAMEWORK is bound 'as const satisfies Record<Tier, Framework>' with NO trailing ?? fallback — a new tier is a compile error at both the map (TS2741) and the index site (TS7053); enterprise maps to swot
- [Phase 15.1]: 15.1-04: Q3 LOCKED — financialsPresent still overrides the tier with growth-os; the tier's perceivable effect is the specialist prompt (ADR-009), never the rubric. SC#5 must not be read as 'the rubric must change'
- [Phase 15.1]: 15.1-04: deserializeProfile's 'solopreneur' fallback and the '- **Persona:**' parse block are BOTH deliberately retained — the block is the profile-doc detector and its four fillVault calls are content; only the authority was removed
- [Phase 15.1]: SC#5b's distinctness assertion MASKS the tier literal before comparing — the plan's literal form was VACUOUS (mutation-checked: 34/34 green with two tiers sharing a clause word-for-word)
- [Phase 15.1]: The three behaviour-preset style overlays are UNGATED (Q6), matching business-profile; the rationale lives as a comment on GATED_SKILLS, the place someone would 'fix' the omission
- [Phase 15.1]: The style-directive read FAILS OPEN while the specialist BODY loader stays fail-CLOSED — an overlay is an additive user-turn layer, so losing it degrades voice, not governance
- [Phase 15.1]: tierBriefing sanitizes agentName INTERNALLY, so there is exactly ONE place a user-authored string can reach a model prompt
- [Phase 15.1]: 15.1-06: converse owns the state machine — nextSlot = missingSlots(slots)[0] in REQUIRED_SLOTS order and done = canComplete(slots); the model owns only the wording. Mutation-checked three ways.
- [Phase 15.1]: 15.1-06: the merge's admission test IS missingSlots over a one-slot object — 'was it merged' and 'does it still count as missing' cannot disagree; 0 is an answer, off-union enums are dropped.
- [Phase 15.1]: 15.1-06: Q1 honoured literally — converse does not ride runAgentLoop (mandatory planId, toolNames filters not adds, the swallowed agentSteps.tool insert). Ceiling: no activity trace, no shared cost rail. llm.ts and schema.ts byte-unchanged.
- [Phase 15.1]: 15.1-06: onboarding-agent is UNGATED (Q6) — the property worth asserting is in the code, not the body, so an eval corpus would assert nothing new.
- [Phase 15.1]: 15.1-07: the closing beat costs a SECOND converse call — nextSlot is derived from the PRE-merge slots, so the turn that completes the set is still under 'obtain <last fact>' and its reply is an acknowledgement, not a beat
- [Phase 15.1]: 15.1-07: commit order is saveFacts THEN commitProfile and it is load-bearing — commitProfile reads the tier row to splice the projection and refuses without it
- [Phase 15.1]: 15.1-07: the SC#1c scan gained a POSITIVE row (the BEHAVIOR_PRESETS group must still be present) so 'no tier control' cannot be satisfied by a page with no controls at all
- [Phase 14]: 14-01: runEvaluation's framework arg is PINNED, not schema-derived — the research premise 'widening the schema needs zero edits to evaluations.ts' was FALSE. evalFields.framework feeds TWO signatures: insertEvaluation (widens for free, correct) and runEvaluation (must not). The pin refuses a doc-review row at the VALIDATOR BOUNDARY, not merely at the FRAMEWORK_SKILL lookup — stronger than planned. Authorized exception recorded in PARALLELIZATION.md; do not simplify back to evalFields.framework.
- [Phase 14]: 14-01: document-analyst persona seeded UNGATED (locked user decision, overrides 14-CONTEXT.md) — run-eval-golden.mjs drives runCockpitAgent over TEXT fixtures and hard-validates --skill against a closed name list, so it structurally cannot exercise a Realtime voice persona; gating would deadlock the skill at v1 on its first body edit. Follows voice-session/voice-brief precedent. GATED_SKILLS and run-eval-golden.mjs byte-unchanged.
- [Phase 14]: 14-01: the voice-doc evaluations thread is the DERIVED synthetic id voiceDocThreadId(sessionId) = 'voice-doc:<sessionId>', never a stored second column — PostCall, actOnGap and byThread all recompute it, so a stored copy cannot drift. citationExcerpt is optional-by-design: an absent excerpt is a valid non-degraded state and the render path branches on presence.
- [Phase 14]: 14-02: composeDocMemo fills the three BRIEF_HEADERS composeBrief leaves unused (SUMMARY=verdict, DISCUSSION=cited findings, OPEN QUESTIONS=notEnoughData) instead of inventing headers; GAPS is a plain label and is DELIBERATELY not added to BRIEF_HEADERS, because that set is what planSeedFromBrief uses to find section boundaries in BOTH Phase-6 brief flavors — widening it silently changes how existing briefs parse. No second brief builder was written.
- [Phase 14]: 14-02: buildDocDigest neutralizes a planted fence marker with a strictly SHORTER, NON-EMPTY literal — shorter so sanitizing can never push a cap-length slice back over DIGEST_CHAR_CAP, non-empty so a split/nested marker can never re-assemble into a real one. The cap is measured on the DOCUMENT SLICE only; title/disclosure/fence/safety chrome is not charged to it, so the budget means the same thing whatever the title is.
- [Phase 14]: 14-02: the doc-review verdict is a CODE rule in shapeDocReview, never asked of the model — zero findings FORCES gaps=[] + insufficient, findings-with-no-gaps is healthy, else gaps. A finding outside DOC_REVIEW_SECTIONS/DOC_REVIEW_CONFIDENCE is DROPPED not coerced, which is what stops garbage from flipping insufficient into healthy. Tests pair findings>0 with gaps===0 and the verdict, because gaps===0 alone also passes vacuously on insufficient (the Phase-12 anti-vacuous lesson).
- [Phase 14]: 14-02: no new Realtime event name for tool calling — the relay triggers off the already-live-verified responseDone 'response.done', which now also carries response.output[] function calls, so a rename breaks in ONE place. The tool-DECLARATION branch (mint-time tools vs a session.update fallback) is genuinely undecided and is recorded in realtime.ts as a dated, BLANK-until-live-verify decision line; 14-04 implements mint-time first and whoever runs the live verify fills the line in.
- [Phase 14]: 14-03: startSession is the TRUST BOUNDARY for the doc scope — it validates docRef (exists / this tenant's / status ready / non-blank text) BEFORE any write, so a rejected doc never leaves an active row holding a watchdog. Uses a direct ctx.db.get + tenantId compare (voice.ts's own endSessionClean/abortSession idiom), NOT internal.vault.getDoc: that query THROWS on cross-tenant (never returns null) and carries no status field, so it structurally cannot answer the readiness half. Thrown messages are a STATUS, never content.
- [Phase 14]: 14-03: searchDocument takes NO document parameter — the scope is read off the SESSION ROW, so a prompt-injected 'search document X' has nothing to steer. The model supplies only free text; the browser only a session id; identity rides the authenticated Convex client via tenantAction.
- [Phase 14]: 14-03: searchDocument NEVER throws — a missing/foreign/ended/unscoped session and any unexpected error all return {passages:[],found:false}. A thrown relay produces no function_call_output, which leaves the model waiting and the user hearing silence for the rest of a turn inside a capped 15 minutes (Pitfall 5). The collector returns [] rather than throwing, which is also what lets exactly ONE audit call site cover both the hit and the miss path.
- [Phase 14]: 14-03 (Open Question 2 RESOLVED): @convex-dev/rag 0.7.5 DOES support per-entry filters (filterNames + filterValues + filters, verified against installed types) but they are unusable today — vaultRag.ts declares no filterNames, embedDoc passes vaultDocId as UNINDEXED metadata, and filters only match entries INSERTED with them. Adopting one = shared-instance change + re-embed migration. Shipped post-hoc doc filtering with the honest ceiling (a top-K search across the whole vault can miss this doc's best passage — the f5c279e defect shape) and both upgrade paths named in a ponytail: comment. Explicitly NOT a cache: voice cost control is time-cap-only (ADR-005).
- [Phase 14]: 14-04: the MINT is the FIRST trust boundary in wall-clock order — the browser mints BEFORE it has a session row (useVoiceSession.ts:269 -> handshake -> startSession), so mintClientSecret re-validates docId itself and throws the SAME two strings startSession does (voicedoc: document not found / not ready), before any request leaves Convex. Not a redundant second check.
- [Phase 14]: 14-04: the document read is a module-local voiceToken.docForMint internalQuery, NOT internal.vault.getDoc — that query returns {text,contentHash,title} with no status and no extractionTruncated, so it can answer neither the readiness refusal nor the truncation disclosure (the same wrong plan premise 14-03 hit). Widening the shared Phase-10 query would touch vault.ts, outside this plan's files_modified/ownership row and watched by vault.md. docForMint returns null on missing/cross-tenant so the MINT owns the message.
- [Phase 14]: 14-04 (Open Question 3): BOTH branches shipped, the answer still blank. Mint-time tools first (server-owned, races nothing); on a 400 ONLY, an automatic re-POST of the identical body minus tools/tool_choice returning toolsAtMint:false. A 500 still throws first time and does NOT re-POST — a SHAPE fallback, not a retry policy. toolsAtMint is transport control (not a secret, not document content) and is trivially true on an unscoped mint so 14-06's branch stays one line. The dated LIVE-VERIFIED ____-__-__ line in realtime.ts stays BLANK until 14-09's live call.
- [Phase 14]: 14-04: exactly ONE tool, READ-ONLY, is the tool-SET containment — asserted by length 1 plus the absence of a 'function' key (FLAT Realtime shape). The digest sits in the SYSTEM instructions field, a materially stronger prompt-injection exposure than ADR-006's tool-RETURN case, so the three containments are the fence + its one safety line, this tool set, and the human Approve gate. Upgrade path named in a ponytail: block — move the digest to a first conversation.item.create user-role message, at the cost of first-second fluency.
- [Phase 15.2]: sniff.ts is dep-free so it IS on the @pikar/vault barrel; officeText.ts stays subpath-only for V8-bundle hygiene
- [Phase 15.2]: extractionKindFor is byte-unchanged and kept as the MIME FALLBACK behind resolveRail — its null just stops being a scheduling decision
- [Phase 15.2]: video/audio resolve to 'unsupported' at resolveRail deliberately: media is routed by MIME at the scheduling gate before any action runs
- [Phase 15.2]: extractOfficeText dispatches on the ZIP marker ENTRY and takes ONE argument — adding mimeType back is a regression (15.2-02)
- [Phase 15.2]: The @pikar/vault barrel rule is about DEPENDENCIES: dep-free modules (sniff.ts, rawText.ts) are barrel-safe; fflate/node:* importers (officeText.ts) stay subpath-only (15.2-02)
- [Phase 15.2]: oleText/rtfText THROW rather than returning '' — an empty extraction that succeeds becomes a ready doc with 0 chars (15.2-02)
- [Phase 17.1]: Reuse live derived blueprint slots only when Stage-1 drift is zero; any unincorporated document re-enables blank-field synthesis.
- [Phase 17.1]: Zero-probe drafts carry the live source IDs so confirmation cannot erase provenance.
- [Phase 17.1]: BLPR-01 remains pending until plan 17.1-08 implements the explicit confirmation gate.
- [Phase 17.1]: Cockpit blueprint context rides the turn prompt; system: skill.body remains the versioned registry body.
- [Phase 17.1]: The cockpit spine read occurs after the no-model SMOKE path and fails open so blueprint faults never cost the turn.
- [Phase 17.1]: BLPR-02 remains phase-level pending until SEAM 2 and the drift clause are complete.
- [Phase 17.1]: Blueprint standing context stays in a separate spine field outside retrieval arrays and TOTAL_CHAR_CAP; searchVault and llm.ts require no accommodation.
- [Phase 17.1]: Evaluation grounding order is profile seeds, then the real Blueprint document, then ordinary retrieval; voice counts document passages separately from the spine.
- [Phase 17.1]: Accepted contradiction rows explicitly select the cited derived entry; unaccepted rows restore the stated entry.
- [Phase 17.1]: The confirmed business_blueprint is written directly at ready and never enters ingest, embedding, or graph extraction.
- [Phase 17.1]: blueprintState derives all four profile states from the same live and Stage-1 drift helpers used by agent seams.
- [Phase 17]: Calendar Approve starts one action-retrier run through the externalAction arm; deliverApprovedPlan remains email-only. — The human tenantMutation owns consent, inline cannot fetch, and workflow is the Gmail fan-out.
- [Phase 17]: Phase 17 is Google-only and create-only; Outlook plus update/cancel remain deferred. — Provider parity and safe event management are additive work, and ACTN-02 traceability stays pending until verify-work.
- [Phase 17.1]: BlueprintPanel owns its Blueprint query and build action, leaving both existing profile writers untouched.
- [Phase 17.1]: Turning the all-additions group off blocks confirmation; discard is the backend-supported all-or-nothing rejection path.
- [Phase 17.1]: Contradiction selections update only the confirmed Blueprint and never rewrite the narrative profile.
- [Phase 15.4]: Folder browse sends folderId without root category context so search matches the complete member list.
- [Phase 15.4]: Browse content, partial ingest, and stale digest remain independent view-state axes.
- [Phase 15.4]: Nord Edge styling stays beneath the Vault root and does not change shared pane or clay semantics.
- [Phase 15.4]: Preview content state and action capability are derived independently so unavailable data cannot arm a governed control.
- [Phase 15.4]: The destructive Vault delete adapter exists only after explicit confirmation is visible.
- [Phase 15.4]: Preview and import styling reuses Vault-scoped Plan-02 tokens without widening global CSS, Drive scope, budget, reservation, or backend contracts.
- [Phase 19]: normalizeAddress is trim+lowercase ONLY - plus-addressing and dot-folding stay deferred so the suppressions key is byte-stable
- [Phase 19]: THREE tables (contacts, followUps, suppressions) - suppressions is address-keyed and separate so suppression outlives the contact; the send guard never reads contacts
- [Phase 19]: Backend typecheck baseline RE-MEASURED at 0 errors exit 0 - the 13 in 19-VALIDATION and the 150 in STATE are both stale

### Pending Todos

- **UNPAID EVAL GATE (15-06) — the three rewritten specialist bodies are PARKED.** `offer-architect`,
  `money-model-designer` and `lead-engine` now name `searchVault`, state the read-only posture and give an
  honest not-enough-data answer — but all three are in `GATED_SKILLS`, and `pnpm eval:golden` was NEVER RUN
  because `.worktrees/lane-a-dispatch` has no `CONVEX_DEPLOYMENT`. Nothing was faked, no fixture weakened,
  nothing hand-activated. **On the deployment the ACTIVE rows are still the v1 bodies with the "runs later"
  framing, so a dispatched specialist today runs the OLD body.** To close it, on a checkout with a live
  deployment: `pnpm dev` (seeds — `npx convex dev` ALONE does not) -> READ BACK the live version carrying
  each body (`seedSkills` writes `maxVersion + 1` and optimizer dry-runs occupy versions; a fresh deployment
  also LIES via the `rows.length === 0` bootstrap path) -> ONE run:
  `pnpm eval:golden --skill offer-architect@N --skill money-model-designer@N --skill lead-engine@N`
  (multi-pin ships in 15-06; one evidence row per pin; budget ~$0.19 + three dispatched specialist turns)
  -> GREEN: `activateSkill` each and VERIFY LIVE with `getActiveSkill`; RED/flaky/over-cap: leave them
  parked, do NOT weaken a fixture and do NOT hand-activate. Full recipe + first-run risks in
  `.planning/phases/15-sub-agent-dispatch-action-executor/deferred-items.md` and
  `docs/playbooks/skill-registry.md`'s GATE OUTCOME paragraph. The three new fixtures
  (29/30/31-gap-dispatch-*) have also never run live.
- ~~**12-04 AND 12-05 visual verification is UNPAID debt**~~ — **PAID 2026-07-25.** The owner ran all three checks (12-04 card states, 12-05 tap → NEXT-STEP MEMO → "Approve & save" → memo at `/dashboard/vault` with no email sent, 12-06 teaching) and reported "Everything worked. I approve."
- ~~**Repeat-evaluation provenance gap (logged, not fixed)**~~ — **CLOSED 2026-07-25 at 13-02.** Re-running an evaluation in the SAME thread used to collapse `findingCount` (8 → 1): carry-forward preserved the scorecard VALUES but not their PROVENANCE, so only freshly-filled paths were re-cited. `fillVault` now separates the two rules — the VALUE is first-write-wins, the CITATION is re-recorded whenever a grounded document restates the field — and the two upstream short-circuits are gone. No fresh-thread workaround is needed any more. Regression guard: `proactiveReview.test.ts > notifies only on change`. The historical detail stays in `.planning/phases/12-business-evaluation-engine/deferred-items.md`.

### Blockers/Concerns

- **Phase-8 owner-auth blocker (open):** three functions (`setOptimizerEnabled`, `activateCandidate`, `candidatesForReview`) are tenant-callable with no owner primitive — closed by Phase 22 (`requireOwner`); MUST land before Phase 23 and Phase 25.
- **Names-in-prose PII ceiling:** `packages/pii` scrubs structured PII only; a shared S1/S4 open design question — grounded business-profile prose must stay out of exportable/WORM tables until resolved (short spike before S1 redaction-boundary work is called done).
- **Media MCP unknowns (Phase 20):** Pikar-Ai MCP backend OAuth/token-exchange + pricing units unverified — the phase's first task is a spike.
- **MS Graph subject format (Phase 25):** invite->subject reconciliation needs the delegated-flow response shape verified before binding logic.

## Session Continuity

Last session: 2026-08-09T10:24:40.749Z
Stopped at: Completed 19-01-PLAN.md
Last session: 2026-08-03T06:20:00.000Z
Stopped at: Completed 15.3-04-PLAN.md
Last session: 2026-08-03T01:10:00.000Z
Stopped at: Completed 15.3-03-PLAN.md
Last session: 2026-08-02T16:52:41.616Z
Stopped at: Phase 15.3 context gathered
Last session: 2026-07-27T01:04:16.127Z
Stopped at: Completed 15.2-02-PLAN.md
Last session: 2026-07-25T22:23:43.857Z
Stopped at: Completed 14-04-PLAN.md (the doc-grounded mint, Lane C)
Resume file: None
