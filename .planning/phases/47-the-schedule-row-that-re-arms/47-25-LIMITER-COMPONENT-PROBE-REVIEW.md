# Wave 6 disabled candidate — installed limiter component probe review

**Reviewed:** 2026-09-28
**Verdict:** limited component transaction probe accepted; operational recurrence remains `defer`.
**Reviewer:** separate read-only native review agent; root authored the test and assertion strengthening.
**Scope:** isolated `convex-test` evidence in the existing six-file candidate only, not a production recurrence adapter, `enable-safe` or release.

| Candidate path | SHA-256 |
| --- | --- |
| `schema.ts` | `628d3d67dcdefeedd32587341ef715413a537428f6fb6ec9e1c258f61504d909` |
| `model.ts` | `164a0d6513da8ab84932fc44b9b48a1b195b27078a84334d204cb94920424f61` |
| `model.test.ts` | `09711bcd07f68defb83e4bad7d6e4bee46515a30764ed84d3cdeb135f330fb5a` |
| `README.md` | `818680bd21bff2ff94933a68518ae4567c8fbcda2cffedf40bff87636841410f` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |

The only candidate source change since [47-24](47-24-CURRENT-SOURCE-INDEPENDENT-REVIEW.md) is a test-only installed-component probe and its README explanation. It registers the installed `@convex-dev/rate-limiter@0.3.2` in the isolated harness and calls Pikar-AI's existing `dailySpendCents` tenant-keyed and `deploymentSpendCents` shared configuration. The independent reviewer checked the code after two assertion-strength corrections: the success case reads the held app journal directly, and the deliberate late-throw case asserts both component calls returned `ok:true` before testing rollback. The three cases prove, within this harness, two-tenant accounting, replay with no second debit, rollback of a tenant debit when the shared cap refuses, and rollback of both component debits and the app journal on a top-level mutation throw. Candidate Vitest passes **49/49** and candidate TypeScript exits 0.

This accords with [Convex's component transaction contract](https://docs.convex.dev/components/using#transactions), but is **not** a real recurrence rail implementation. The production app has no recurrence journal/adapter using this pattern; the disabled model still uses injected synthetic keyed rails. The installed limiter still has no per-run `reserve`/`lookup`/`release` tombstone API. Cross-window refund, unknown paid-effect settlement, result authentication, operator reconciliation, real deployment behavior, D6, live DST/OAuth/provider observations and owner activation remain open. A further candidate byte change retires this exact review identity.
