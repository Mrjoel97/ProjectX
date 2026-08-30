# 29-W3-TAIL-FIX2 Summary — the absolute that survived three passes, and the true thing deleted on a false premise

**Commit:** `1440017` — comment/prose only. No behaviour changed, no test added, no test deleted.
**Owned paths touched:** `packages/backend/convex/workflowPackBinding.ts`,
`packages/backend/vitest.config.mts`, `packages/backend/convex/skills.test.ts`,
`packages/backend/convex/vaultGround.test.ts`, `docs/playbooks/vault.md`,
`docs/playbooks/skill-registry.md`, plus in-place corrections to
`.planning/phases/29-unified-knowledge-and-routines/29-W3-TAIL-FIX-SUMMARY.md`.
**Owned paths deliberately NOT touched:** `packages/backend/scripts/run-eval-golden.mjs`,
`docs/playbooks/knowledge-search-routines.md` — no outstanding finding against either, and this pass
prefers deleting claims to minting new ones.

---

## Item 1 — the `internalAction` justification, deleted a third time

**Finding:** the claim deleted at two sites in `d76144a` survived on `runWorkflowPack`'s docblock,
253 lines below the comment that records its deletion.

`workflowPackBinding.ts` read:

> `PRODUCTION entry point. `internalAction`, so the model can never supply the tenant, the plan or a
> version pin (the `runSpecialist` precedent, ADR-008).`

That is the same sentence `runPackTurn`'s pin check records as deleted *because nothing enforces it*,
and the same one `skill-registry.md`'s "The pin door IS open" bullet already contradicts in writing
("Every declaring site is internal TODAY, and nothing enforces that it stays so ... There is no test
that fails when a client-callable surface declares the arg"). **Deleted.** What replaces it is the
routing fact that is true and needs no guarantee: the public door is `cockpit.startWorkflowPack`.

**Confirmed unenforced before deleting, not assumed:** `importGuard.test.ts`'s BANNED regex covers
`query|mutation` only — `action` is not in it — and `grep -rn "tenantSkillIds" convex/*.test.ts`
returns call sites only, no source scan of the declaring sites.

**The whole-file sweep the brief asked for**, `grep -nEi "\b(never|cannot|can't|impossible|always|only ever|no way|guarantee[ds]?)\b"` over the entire file, and then each hit read in place:

| Site | Verdict |
| --- | --- |
| `runWorkflowPack` docblock | **DELETED** (this item) |
| `__runWorkflowPackWithScript` docblock — "the production action can never be driven offline" | **REWRITTEN** as mechanism: a `LanguageModel` is not Convex-serializable, so the offline path passes a scripted response array instead. No absolute left. |
| `runPackTurn`'s "an unknown id structurally cannot be written to the plane" | **KEPT.** Runtime-enforced, not type-only: `schema.ts`'s `workflowPackEvents.packId` is a `v.union` of literals (a bad id throws `ArgumentValidationError`) and `packages/core/src/workflowPacks.test.ts` source-scans the two lists together. |
| header "a pack ALWAYS supplies an array — so specialist dispatch ... are never BUILT" | **KEPT.** `toolsForWorkflowPack` mechanism, driven behaviourally by the tool-grant tests in `workflowPackBinding.test.ts`. |
| the `:207` comment recording the deletion, and the `never re-typed`/`never hand-typed` grant comments | **KEPT** — these describe mechanism or record a deletion; none asserts a guarantee. |

**I also grepped the playbooks I own** (`vault.md`, `skill-registry.md`,
`knowledge-search-routines.md`) for the claim in every phrasing: the only hit is
`skill-registry.md`'s changelog *recording that it was deleted*, which is the correct place for it.

**Correcting my own prior enumeration:** `29-W3-TAIL-FIX-SUMMARY.md` called `:143` and `:159` "the two
surviving copies". There were three. The sweep was recorded as complete when it was not.

**Mutation observed RED** (for the sentence that replaces it — that a pinned `pack-*` body really does
reach a model): deleting the `tenantSkillIds` pass-through in `runPackTurn` →
`4 failed | 35 passed (39)`, including `"the pinned CANDIDATE body runs, not the tenant's effective
one"`. Reverted; `git diff --stat HEAD` over my `.ts`/`.mts` files is empty.

**Still open, named not implied:** two live copies of the same justification stand OUTSIDE my
ownership and I did not edit them —
- `convex/llm.ts` ~`:5346`, directly above `runCockpitAgent`'s `skillVersions` declaration:
  *"this is an internalAction, so the model can never supply it"*.
- `convex/dispatch.ts` ~`:659`, `runSpecialist`'s docblock: *"`internalAction`, so the model can never
  supply the lineage or the limits"* — which also carries a raw `llm.ts:1935-1938` citation that has
  drifted (the nearest real anchor is `:1939`).

Both are enumerated by `skill-registry.md`'s eight-declaring-sites bullet and both contradict it.
`llm.ts` and `dispatch.ts` are `cockpit.md`'s watched paths, so closing them owes a `cockpit.md` bump.

---

## Item 2 — I deleted a true, register-sourced exemplar on a false premise

**Finding upheld in full.** Last round I removed this from `vitest.config.mts`:

> *Several are deliberately ungated (`vault.ts`'s `vaultSearch` is driven by
> `apps/web/e2e/vault-redesign.spec.ts` against a real KEYED deployment, where `offlineSeamAvailable()`
> is false by construction).*

on the stated grounds that `29-SMOKE-SEAM-DEBT.md` "does not enumerate `vaultSearch` at all". **I read
the register myself this time. It does.** Under **"NOT closed by this"** it names
`vault.ts`'s `vaultSearch`, its bare `query.startsWith("SMOKE::")`, the `vault-redesign.spec.ts`
coupling and the keyed deployment, and calls it *"the sibling instance this register's coupling warning
is about"*. Only the NUMBERED TABLE omits it — I read the table and reported on the document.

Only the word **"deliberately"** was ever false: the register frames it as unclosed coupling debt, not
a design choice. So the fix was to drop that word, not the exemplar.

**Restored**, in the register's own framing:

> *Its worked example is `vault.ts`'s `vaultSearch`, whose bare `query.startsWith("SMOKE::")` is
> E2E-coupled: `apps/web/e2e/vault-redesign.spec.ts` types those sentinels against a REAL KEYED
> deployment, where `offlineSeamAvailable()` is false.*

Both halves re-verified at HEAD: `grep -n 'startsWith("SMOKE::")' convex/vault.ts` → `:729`;
`apps/web/e2e/vault-redesign.spec.ts` exists.

**No register edit is owed.** The unmade one-entry edit my last SUMMARY handed to the register's owner
was for an entry that is already there. Both statements are corrected in place in
`29-W3-TAIL-FIX-SUMMARY.md`, and the follow-up bullet is struck through and retracted.

**When the register and a comment disagree, the register wins — that is its purpose.** I inverted that
last round by trusting my own reading of one section of it.

---

## Item 3 — a false comment four lines above my own edit, in the same block

`vitest.config.mts` named `knowledgeLlm.test.ts` as one of three files that stub the offline consent
OFF. **It never does.**

`grep -rn 'stubEnv("PIKAR_OFFLINE_FIXTURES"' --include=*.test.ts convex/`:

| File | Values stubbed | Turns the consent OFF? |
| --- | --- | --- |
| `knowledgeLlm.test.ts` | `"1"` (×2) | **NO** |
| `lib/models.test.ts` | parameterised, incl. `""` / `undefined` | yes |
| `vaultGround.test.ts` | `""` | yes |
| `vaultDigest.test.ts` | `undefined` | yes (was not named at all) |

`knowledgeLlm.test.ts`'s OPERATOR-OFF test reaches consent-absence through the **other half** of
`offlineSeamAvailable()` — it plants `OPENROUTER_API_KEY`. The comment now says exactly that, and names
`vaultDigest.test.ts` as the third stubbing file.

**Mutations observed RED, both reverted:**
- `vaultDigest.test.ts:760` `undefined` → `"1"` — `1 failed | 16 passed (17)`. Proves that file's
  stub is a consent-OFF stub.
- `knowledgeLlm.test.ts:889` `"test-key-not-used"` → `undefined` — `1 failed | 50 passed (51)`, the
  failure being *"OPERATOR OFF (a model credential is present): the tenant's sentinel takes the LIVE
  path"*. Proves that test depends on the credential, not on a consent stub.

---

## Item 4 — the "dark candidate" absolute, still standing in `skills.test.ts`

Found while sweeping my own owned files. The `publishPackCustomization` header read:

> *"...and since the pack gate has no tenant lane, the body they compose can never become the one a
> specialist runs."*

That is the **same claim** 29-FIN-05 deleted from `skills.ts` and `workflowPackBinding.ts`, and it is
false for the reason the brief states outright: a tenant pack candidate is unactivatable but **still
runnable under a `tenantSkillIds` pin**. `skill-registry.md`'s "The pin door IS open" section says so
in writing, in the playbook that watches this very test file.

Replaced with what the gate actually bounds — `planTenantActivation` throws `PACK_GATE` for every
`pack-*` name, so the body does not go ACTIVE — plus the test that runs one
(`workflowPackBinding.test.ts`, *"the pinned CANDIDATE body runs"*), and an explicit
"do not read the gate as *this body never reaches a model*".

**Mutation:** the same pin-threading deletion as Item 1 turns that test RED, which is the citation the
new sentence carries. `skills.test.ts` itself is unchanged in behaviour: **170/170** before and after.

`docs/playbooks/skill-registry.md` bumped in the same commit (CLAUDE.md §9).

---

## Item 5 — smaller corrections

**`vaultGround.test.ts` file header.** *"a different tenant's corpus can never enter a grounding
result"* → the mechanism plus the two tests that drive it (`"cross-tenant: tenant B grounding returns
nothing from tenant A's corpus"` and `"a passage is attached only to a doc the TENANT owns"`, both
verified present).

**The leak-guard ordering sentence** the brief lists as outstanding was already corrected in `d76144a`
and I re-read it: `vaultGround.test.ts` now says the guard *"catches the leak only when it runs after
the stubbing test, and nothing here enforces that ordering"*, and names `unstubEnvs: true` as the
order-free fix. Nothing to change; **I did not restate it**.

**`vault.md` citations.** All four `vaultRag.ts:390` citations for `vaultRag.embedDoc`'s `SMOKE::`
short-circuit are now the symbol `SMOKE_PREFIX`. The line was still correct today — which is precisely
when a line number is cheapest to remove. `Last verified` bumped.

**`29-W3-TAIL-FIX-SUMMARY.md`.** Four false statements corrected in place, each marked as a dated
correction rather than silently rewritten:
1. + 2. the two "the register does not enumerate `vaultSearch`" statements (Item 5 and the follow-up
   bullet, the latter struck through and retracted);
3. + 4. the two claiming `blueprint.test.ts` "carries the identical unprotected `vi.stubEnv` /
   trailing `unstubAllEnvs()` pattern". It does not: one stubbing site, `beforeEach` at `:740`, paired
   `afterEach` at `:747-750` calling `vi.unstubAllGlobals()` / `vi.unstubAllEnvs()` inside the same
   `describe`, and no inline trailing unstub anywhere in the file. **The outstanding env-leak debt is
   one file, not two.** The `unstubEnvs: true` deferral still stands on its own reason.

The "9 failed / 13 passed of 22" blast radius and the "zero line-number citations remain" claim were
both already corrected in `d76144a`; I verified that and did not touch them again.

---

## Gates

Run from `packages/backend` (the plans' `pnpm --filter … test -- <filter>` form is a no-op; `--` is
swallowed before it reaches vitest).

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm vitest run vaultGround.test skills.test workflowPackBinding.test` | **231 passed (231)**, 3 files |
| `pnpm vitest run vaultGround.test` (alone) | 22/22 |
| `pnpm vitest run skills.test` (alone) | 170/170 |
| `pnpm vitest run workflowPackBinding.test` (alone) | 39/39 |
| `pnpm vitest run vaultDigest.test` (alone) | 17/17 |
| `pnpm vitest run knowledgeLlm.test` (alone) | 51/51 |
| `git diff --stat HEAD` over my `.ts`/`.mts` files | empty — every mutation reverted |

**Not run, and why:** the full backend suite, the web build and any browser/deployment gate. This
commit changes comments and prose only; no import, no export, no runtime value moved, and typecheck is
clean. A live deployment, model call or Playwright run is out of scope per the brief.

**Known red that is not mine:** `convex/env.test.ts` (Phase 28's `QUICKBOOKS_*` / `ENV_MANIFEST`).

**The four-file co-run is nondeterministic and I did not fix it.** A verifier reproduced two distinct
failure signatures across nine identical invocations of
`pnpm vitest run vaultGround.test workflowPackBinding.test skills.test vaultDigest.test` (once a
`TENANT_SKILL_PIN_FOREIGN` assertion resolving instead of throwing; once the nine-red `vaultGround`
env-leak signature; seven times green). My three-file co-run above was green on its single run, which
is evidence of nothing about the flake. The leak sources are not all `stubEnv`-based —
`profileRedaction.test.ts`, `voice.test.ts` and `voiceToken.test.ts` assign `process.env.OPENAI_API_KEY`
directly, which no `afterEach` restores — so `unstubEnvs: true` alone would not close it. **Open.**

---

## What I did NOT close, and why

- **`convex/llm.ts` ~`:5346` and `convex/dispatch.ts` ~`:659`** — two more live copies of the deleted
  `internalAction`/"the model can never supply it" justification, both at declaring sites
  `skill-registry.md` enumerates, both contradicting it. Outside my ownership; `cockpit.md` watches
  both files and would owe a bump. `dispatch.ts` ~`:660` also carries a stale `llm.ts:1935-1938`
  citation (nearest real anchor `:1939`).
- **`convex/vaultDigest.ts` ~`:53`** — *"Mirrors `vaultGround.ts:29-30`'s PER_DOC_CHAR_CAP /
  TOTAL_CHAR_CAP"*. Those constants are at `:39-40`; the citation is wrong by ten lines. It is the one
  code-side pointer for the cap pair `vault.md`'s DEBT block describes. Unowned by this wave; recorded
  in `vault.md`'s new `Last verified` block so it is not lost.
- **`docs/playbooks/workflow-packs.md` owes a §9 bump for my `workflowPackBinding.ts` edit.** A sibling
  has that file staged in this shared worktree, so touching it would mix into their work. **Named
  here, not made.**
- **The rest of `vault.md`'s line-number citations** — it is 4.3k lines and older sections still carry
  them (`schema.ts:900`, `vaultDrive.ts:697`, `DocGrid.tsx:101/148`, and more). An unverified
  conversion is how stale citations get minted, so I converted only the four I re-verified against the
  source today. **Still open.**
- **`unstubEnvs: true` in `vitest.config.mts`** — still deferred, now for the correct reason: it is a
  suite-wide change across 112 test files in a closing pass with two agents committing to the same
  worktree, and per the flake evidence above it would not close the whole leak class anyway.
- **`docs/playbooks/knowledge-search-routines.md`, `packages/backend/scripts/run-eval-golden.mjs`** —
  owned, no outstanding finding, untouched. Deletion over addition.
- **`docs/playbooks/production-beta.md`** still owes a bump for Phase 28's `lib/env.ts` change. Not
  mine.

## What this pass did NOT prove

No behaviour was tested that was not already tested. Every mutation above was run to prove a **claim in
a comment or a SUMMARY**, not to add coverage. The three code-side gaps this pass documents rather than
closes — no test fails when a declaring site becomes client-callable, no test scans for the
justification class, and the cross-file env leak — are all still open.
