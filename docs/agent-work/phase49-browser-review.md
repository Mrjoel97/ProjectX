# Phase 49 browser qualification repair — worker review handoff

Status: **ready_for_review with an unresolved empty-directory cleanup gate**, not accepted. Date: 2026-09-23. Root owns Plan 49-06 closure and final acceptance. Git executable was unavailable; all work is in the shared dirty worktree and no commit was made. The corrected full runner returned exit 1 after browser assertions passed because its temporary root could not be removed. This report does not claim end-to-end runner success. Root later removed the residual file contents under exact-target elevated cleanup; see the final update below.

## Source and behavior delivered

- Browser evidence is now revisioned (`browser-observed-v2`) and requires a server-observed, owner-bound, exact-candidate transcript. Begin clears prior browser evidence, each desktop/mobile lane advances through selected → partial → bounded refusal → recovery → changed edit → final preview under monotonically increasing CAS revisions, and finalize freezes a canonical hash without issuing a witness. The trusted internal writer alone checks the finalized run/hash/revision/current identity and writes activation evidence. Missing, legacy, forged, replayed, incomplete, stale, and owner-only evidence fail closed. Persisted transcript fields are refs/hashes/counts/closed outcome tokens, not input or HTML.
- The server materializes exact recipe previews, records normalized input/document/artifact hashes and byte lengths, and returns designed HTML for a sandbox-empty read-only owner iframe. The owner UI exposes honest stages, pending-runner state, activation and rollback, and private storefront creation/readback.
- New recipe-backed project versions pin the validated designed profile and renderer identity and store designed immutable artifacts. Existing manual/legacy rendering and previously stored bytes remain untouched. The designed hash canonicalizes the closed profile fields in fixed order after a persisted-roundtrip mismatch was proven. Root approved this narrow extension to `packages/core/src/webDesignRenderer.ts` and its test. Renderer ID remains `web-design-renderer-v1` because this new designed project path had not entered accepted production; the evaluator implementation digest nevertheless changed and retired provisional exact-source receipts.
- The Phase 49 spec now has no fixture-key/deployment read at module import. The disposable runner creates a fresh loopback SQLite/local-storage backend, pushes only to it, sets fresh local-only Convex Auth keys and offline consent, builds the production web app, and checks the app's actual Convex WebSocket endpoint before owner provisioning or fixture mutation. It uses no production storage state or default `.convex/local/default` database.
- The browser-specific positive control in `webRecipeEvals.test.ts` was migrated through the real transcript/internal-witness protocol, with root's narrow approval. Evaluator predicates, fixture corpus, expected outcomes, mutation controls, and refusal behavior were not weakened.

## Evidence and review boundaries

Initial pre-edit SHA-256 anchors included contracts `95FCFCCE6ED4B74A18F9C22B407BA353B9228A585531F7072CF4960A3099339D`, renderer `B7795C03F87C3E4287B7C15034DA670B1522AE679535AC5E7101A804AC7F6E05`, skills `C8987E5B06A9E69F4708865E5F5E0429AA1AA4C35611C2078F227347BF3715D2`, webRecipes `58B5DEF073DE228C93204B10C4F93AEE374798837D1911A22814824A0F9E2C5D`, webProjects `E1D0A4005E5673798C405ACC1E60E40BF00F582F69B4A987DC9E70096994203F`, UI `95F13EC5B46886B61FC0D4DDD474730B0911643936FAA8541F61964DB3502F96`, E2E `26F83F175AA765D3635CC094E39DA974921A3A013D1D3714DD150495202DDC95`, and browser-specific evaluator test `8EDE26F0454DED623D4A572012E63E0E5F88E8EFA3ED0DF44901EF9C7A7683AD`.

First-pass post-edit SHA-256 anchors (the UI/spec anchors here precede the runner correction): contracts `A61D132764B9A5D2F90BDFEE824FEF19B900B70F13B3A5715E3B526E2670A812`; renderer `53CEA77484D81B8C6D3C1B9178D7375AB22CE61AE73F46BA897985EB0449D4E7`; skills `605632B21BAF4D5C34A689B8A8D11809A70A36C80272370806A672B5C4899442`; schema `22397FAF9274AFE66EE2994A112154AD779BA91B43E4B8193B4B1E5688BEC38B`; webRecipes `424E2571F2961C7FECAD2459427E654CC3BEC995D563F6514D15E63B5F2A4C2C`; webProjects `545E2DAF2BD341C2464E64B81F5E0E176B7653F5DDD312B906CFA7E3A6E2FDC2`; owner UI `52ED5032F90905C38AE97FE85382A58D935CF07E35EB5A28B36AB0C8EBC35362`; browser spec `453D17F7DE58F531552C8CAE2AD452DC41FD5CB3456761FA47B672E0B13205BC`.

Verified commands:

| Command | Result |
| --- | --- |
| `pnpm --filter @pikar/core test -- src/webDesignRenderer.test.ts` | Exit 0, 4/4 |
| `pnpm --filter @pikar/backend test -- skills webRecipes webProjects --reporter=dot` | Exit 0, 209/209 |
| `pnpm --filter @pikar/backend typecheck` | Exit 0 |
| `pnpm --filter @pikar/web test -- webRecipeQualification` | Exit 0, 4/4 rendered interactions after correction |
| `pnpm --filter @pikar/web typecheck` | Exit 0 |
| `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check` | Exit 0; implementation `9d153dd40291a8037a306bb20ad327f7f3f24b99e8bd316bc9dfdd382a44f524`, fixture `fc9ff50300ef7de36d4b2e7f28ea32518e10d7f2ad4e18d258ec6e80caa2b379`, cost $0 |
| `node apps/web/e2e/phase49-disposable-stack.mjs` | Corrected final run exit **1**: local Convex push, fresh JWT/JWKS and offline consent, production webpack build, authenticated Chromium E2E all exit 0; exact fixture cleanup removed 6/6; runner correctly failed `TEMP_CLEANUP_FAILED` after 8 attempts. See final run below. |
| `pnpm --filter @pikar/core test -- src/webRuntime.test.ts src/webDesignRenderer.test.ts` | Exit 0, 14/14 legacy + designed renderer |
| `pnpm --filter @pikar/backend test -- webRuntime webRuntimeHttp webProjects --reporter=dot` | Exit 0, 12/12 public-runtime/legacy compatibility |
| `pnpm --filter @pikar/web test -- siteEditor previewCanvas webRecipeQualification` | Exit 0, 8/8 existing editor/preview plus new rendered UI |

The focused backend suite includes non-owner/foreign/same-version identity, stale CAS, incomplete lane, identical edit, forged outcome, direct finalize, missing witness, legacy receipt, replay, and post-finalization refusal controls. The rendered UI tests assert actual interactions, HTML iframe, and exact mutation arguments. The persisted-project tests assert designed hashes, lineage, immutable artifacts, and legacy compatibility. Browser evidence is local disposable qualification, not production founder acceptance or provider/legal completion.

`node scripts/check-playbooks.mjs` exited 0 but silently skipped changed-file discovery because Git is unavailable; this is **not** a passing verifier claim. I manually updated `docs/playbooks/skill-registry.md`, `docs/playbooks/public-web-runtime.md`, and corresponding `docs/playbooks/watch.json` entries for contracts, schema, browser/evaluator tests, preview, renderer, project runtime, UI, Playwright config, and disposable runner. Strict verifier repair remains the next serial task owned by root, not this slice.
`watch.json` parsed successfully as JSON. No `check-free-gates` success is claimed; its Git-dependent repair is also queued to the next serial task.

## Disposable cleanup and limitations

The server fixture cleanup is exact stamped-run/captured-ID only. Both the earlier browser run and the corrected final run reported `Phase 49 exact fixture rows cleaned: 6`. No production deployment, existing default local Convex DB, provider, or owner storage was used.

Windows left temporary roots after runner completion. I stopped only exact, observed run-owned handles: backend PID **20952**, started 17:38:20 local and matching the cached local-backend binary; app listener PID **15628**, started 17:46:56 local and confirmed by `netstat` as the sole `127.0.0.1:3112` listener. No broad process kill was used. Admin and signing files named `config.json`, `jwt-private.txt`, and `jwks.txt` were removed from all 11 prior run-created temp directories (file contents were not printed). A later inventory found those 11 directories empty but still present, not successfully removed:

`C:\Users\expert\AppData\Local\Temp\pikar-phase49-3tKggi`, `...\pikar-phase49-0s3e1T`, `...\pikar-phase49-xSWoWq`, `...\pikar-phase49-Lzo3jj`, `...\pikar-phase49-GMCbkp`, `...\pikar-phase49-aDb6C7`, `...\pikar-phase49-QRHaQw`, `...\pikar-phase49-0DvPwl`, `...\pikar-phase49-JFQOaV`, `...\pikar-phase49-2l7P84`, `...\pikar-phase49-Orl6RJ`.

The previous passing run additionally left `C:\Users\expert\AppData\Local\Temp\pikar-phase49-enRK8i` with SQLite/module blobs. Removing standalone `config.json`, `jwt-private.txt`, and `jwks.txt` does **not** prove the residual deployment is secret-free: `JWT_PRIVATE_KEY` was set in deployment state. This is a **potentially sensitive unresolved cleanup gate**, not inert storage. A fresh temp-root recursive-delete probe succeeded and the residual ACL grants the current user full control; `Remove-Item` on a residual root reported process-use. The exact holding process has not been verified, so no generic `node.exe` kill was attempted. The final `apps/web/test-results` inventory contained only `.last-run.json`; no browser storage-state file or failure screenshot remained. Browser assertions establish isolated rendered behavior, not cryptographic pixel attestation or production acceptance.

## Superseded first-pass refs-only run

The earlier runner returned exit 0 despite failed temp deletion. It is **superseded** by the corrected fail-closed runner and must not be treated as a passing cleanup result. It emitted:

```text
authenticated Phase 49 browser E2E: exit 0
Phase 49 isolated browser qualification: six exact candidate runs, three immutable v2 artifacts, three v1 post-rollback artifacts; refs ts73xpz8ym3cxp2b4980mt6c618eyc0r,ts799n6a40amqx4sx4v0j5kemn8ezwtc,ts77q95jvc35qjcpfj0aawc3v18eyf28
Phase 49 exact fixture rows cleaned: 6
Phase 49 disposable process stop requested; exact temporary directory removed: false; secret files removed: true; cleanup error: EPERM
```

The refs are the three v2 project IDs (site, landing, private storefront), not a claim of production publication. The test compared their immutable version-1 bytes/lineage before and after UI rollback, created three new v1-bound artifacts, verified storefront omission from ordinary discovery and 404 at the exact anonymous private path, and checked both 1280px/390px browser lanes for authored iframe content, edit/refusal/recovery, sandbox, forbidden content, hashes, and overflow before issuing any trusted witness. These browser assertions were repeated in the corrected run described below.

Graphify-first discovery was attempted before source inspection but gave no result in its bounded window. Post-edit `graphify update .` reached “Re-extracting code files” and then stalled for more than 90 seconds; only its exact PID 17184 (started 18:03:07 local) was stopped. `node scripts/extract-convex-edges.mjs` exited 0 but no-op'd at its initial Git-root guard because Git is unavailable; existing `graphify-out/graph.json` retained its 2026-09-21 timestamp. No graph refresh claim is made.

## Runner/lifecycle correction bundle (root findings 1–8)

`apps/web/e2e/phase49-disposable-stack.mjs` now treats cleanup as part of the run outcome. It records a closed `TEMP_CLEANUP_FAILED` failure if the exact owned root cannot be removed and preserves both the original run error and cleanup errors in an aggregate failure. It waits for the captured child process exit rather than inferring stop success from a signal request; it separately checks loopback listeners and root deletion. A new `phase49-stack-lifecycle.mjs` helper validates the owned marker, exact real path, direct-child relationship, and non-symlink target before secret scrubbing or removal. Standalone `config.json`, `jwt-private.txt`, and `jwks.txt` are scrubbed in that validated root before deletion attempts, even when process cleanup failed. Residual SQLite/storage is **not** asserted inert or secret-free. `taskkill /T` was not used by the final runner because a disposable exact-handle probe returned access denied; only the captured direct child received `SIGTERM`, and descendant termination is not assumed. Listener/root checks provide independent gates. Runner failures and browser console/page errors now expose only closed metadata/event presence, never arbitrary backend/browser output or truncated secrets.

The owner UI now prevents opening the second desktop/mobile lane until the first open lane is complete, with an honest unfinished-lane message and empty-review state. Its rendered regression tests cover the formerly stranded selection. The browser test asserts the created `recipeRef` name, version, skillId, and bodyHash against captured exact v1/v2 candidates for site, landing, and private storefront, including v2 immutability after v1 rollback; it retains full artifact/lineage comparisons. The runner correction changed no server protocol or renderer source. `docs/playbooks/skill-registry.md` and `docs/playbooks/watch.json` were updated for the new lifecycle helper/test and runner/UI/spec coverage; source-watch coverage was checked manually, because the Git-dependent verifier skipped discovery.

Correction checks: `node --test apps/web/e2e/phase49-stack-lifecycle.test.mjs` exit 0, 5/5 (outside/broad/symlink guard, failed cleanup and termination, original-error preservation, closed metadata, captured-child stop); `pnpm --filter @pikar/web test -- webRecipeQualification` exit 0, 4/4; `pnpm --filter @pikar/web typecheck` exit 0; `node --check` on runner/helper exit 0. The cached Biome binary `node node_modules/.pnpm/@biomejs+biome@2.5.3/node_modules/@biomejs/biome/bin/biome format --write` on the six exact correction source/test files exited 0; its `check --write` exited 0 with non-blocking warnings and import organization in two files. `pnpm exec biome` could not resolve a binary in this shell, so the cached executable was used. These focused checks preceded the final import-only organization; no further full run is warranted solely for formatting. Root independently owns the final exact-candidate evaluator self-check.

Current correction SHA-256 anchors, measured after Biome:

| File | SHA-256 |
| --- | --- |
| `apps/web/e2e/phase49-disposable-stack.mjs` | `106F55933504B47EFB4E282D99729B24C358E6EF738FACA28C487D184B676129` |
| `apps/web/e2e/phase49-stack-lifecycle.mjs` | `DD036129FB9906545C307212D94AFF8F93F9FE821C289DF6C6087615E08C380A` |
| `apps/web/e2e/phase49-stack-lifecycle.test.mjs` | `E5E2DF1A4703FC3C72DEF8423500EAAD8F5097A8690E32A097F775F0D0406228` |
| `apps/web/e2e/phase49-recipe-qualification.spec.ts` | `4C1302EA8408A4206C11E7A8BFE9693FEA167A5C094E3C8ED070528151471311` |
| `apps/web/app/(app)/ops/WebRecipeQualification.tsx` | `A153B6EE6EBAC487D6FA89E614ED1FF986A794EF4DC811C08B203CDDBC331B1C` |
| `apps/web/app/(app)/ops/webRecipeQualification.test.tsx` | `EE8677746E50E3110502F01D2F0A184E49391D5187D2FD9ECF80054376A884C1` |
| `docs/playbooks/skill-registry.md` | `4DDE93F9346371C86DE5FF7A44A2CF2A4B411B2FB8E5A808B8A4E509AECAF8C5` |
| `docs/playbooks/watch.json` | `8FDE7BDB7717D51D5FBCB23840E4E27CBEF561204FD62C85094ABF8EFE8073D4` |

## Corrected final isolated run and open cleanup gate

The one corrected full run used fresh `C:\Users\expert\AppData\Local\Temp\pikar-phase49-g2R52Z` and an observed local-backend PID **20508**, started **18:46:22 local**, bound to loopback `3410/3411` while active. The runner validated the actual embedded fixture backend before provisioning. Browser/fixture evidence was:

```text
authenticated Phase 49 browser E2E: exit 0
Phase 49 isolated browser qualification: six exact candidate runs, three immutable v2 artifacts, three v1 post-rollback artifacts; refs ts74v8b78t906jbshxhs9zjfhd8ezcy4,ts775v17w8kred9vf29z4g7d6n8eyhs3,ts7evpe5g9bn6b1ghb0yjr0we18ez5ka
Phase 49 exact fixture rows cleaned: 6
Phase 49 disposable stack failed: [{"code":"TEMP_CLEANUP_FAILED","stage":"cleanup","attempts":8}]
```

The **runner exit code was 1**, correctly fail-closed on residual temp deletion. This is passing isolated browser assertion evidence but **not** an accepted, clean lifecycle E2E. Afterward, `netstat` showed no **LISTENING** socket on `3410`, `3411`, or `3112` (only TIME_WAIT entries), and no `convex-local-backend` process was found. That proves only the observed listener/process state at check time, not that every possible descendant was stopped. No more full runs were made. Exact fixture deletion was 6/6; no production owner/provider or existing `.convex/local/default` storage was touched.

The exact residual inventory is 13 run-created directories under `C:\Users\expert\AppData\Local\Temp`:

```text
pikar-phase49-0DvPwl
pikar-phase49-0s3e1T
pikar-phase49-2l7P84
pikar-phase49-3tKggi
pikar-phase49-aDb6C7
pikar-phase49-enRK8i
pikar-phase49-g2R52Z
pikar-phase49-GMCbkp
pikar-phase49-JFQOaV
pikar-phase49-Lzo3jj
pikar-phase49-Orl6RJ
pikar-phase49-QRHaQw
pikar-phase49-xSWoWq
```

Eleven are empty. `enRK8i` contains SQLite/module blobs; `g2R52Z` contains a 64-byte `.phase49-owned` marker, ~7.5 MB `backend.sqlite3`, module blobs and `playwright-results/.last-run.json` (45 bytes). Both storage-bearing roots are **potentially sensitive** because the disposable deployment received `JWT_PRIVATE_KEY`; no raw secret values or database contents were printed. No `config.json`, `jwt-private.txt`, or `jwks.txt` filename remained in any of the 13. Exact-target deletion reported process-use / `EPERM`; one exact `enRK8i/backend.sqlite3` deletion attempt stalled and its exact tool cell was terminated, leaving the file present. A fresh unique temp directory deletion succeeded and ACLs showed current-user full control, but these observations **do not distinguish file handles from execution-sandbox rejection**. No `sandbox_permissions=require_escalated` cleanup attempt was made; every cleanup attempt used default sandbox permissions. Root must decide whether an approved exact-target cleanup outside the workspace can be performed. Until then, deletion is unresolved, not successful.

Earlier observed, run-owned PID **20952** (backend, started 17:38:20 local) and PID **15628** (app listener, started 17:46:56 local) were stopped by exact handle during the earlier run. No generic `node.exe` or broad process kill was performed. The only other stopped handle was the bounded Graphify PID 17184 noted above. The final runner's exact backend PID 20508 was no longer present after the run. No installs, outbound owner/provider messages, production changes, commits, or broad temp/default-DB operations were performed. This remains **ready for root review, not Plan 49-06 acceptance**.

Root's subsequent exact-target `sandbox_permissions=require_escalated` cleanup applied **only to** `enRK8i` and `g2R52Z`, removing all their file contents; fresh recursive readback showed **zero descendants** in each. Root's subsequent checks of all 13 empty/nonreparse historical directories and nonrecursive removal attempts used default sandbox permissions. Final directory removal still failed with `System.IO.IOException` HResult `-2147024864` (sharing violation). Root killed no process. Thus the earlier inventory of potentially sensitive SQLite/module blobs is historical, not current residual file state; the 13 empty historical roots remain an open cleanup gate. My own earlier cleanup attempts used default sandbox only; the elevated exact-target content removal was performed by root, not this worker. The follow-up synthetic backend-plus-local-push probe reproduced an empty-directory sharing violation and left one additional empty probe root, `MygGTP`; see `phase49-minimal-lifecycle-diagnosis.md`. No specific holder has been identified.

Subsequent bounded Windows Job Object correction is documented in `phase49-minimal-lifecycle-diagnosis.md`. It assigns a gated launcher before backend execution, owns one kill-on-close job handle, fails closed on process-list/limit/protocol/stop errors, and preserves independent listener/root gates. Focused lifecycle and synthetic descendant tests passed 8/8. One fresh backend-plus-exact-local-push probe under the new job returned push exit 0, observed four job members, stopped the job, freed both listeners, and removed its fresh root `pikar-phase49-WBBrjf`; exact broker/gate/backend PIDs 3164/7068/16800 were absent on readback. This does **not** supersede the prior full browser-run exit 1 or constitute final Plan 49-06 acceptance. No full browser/build qualification was rerun after the lifecycle correction; root must authorize that separately. The 14 older empty roots were not touched.
