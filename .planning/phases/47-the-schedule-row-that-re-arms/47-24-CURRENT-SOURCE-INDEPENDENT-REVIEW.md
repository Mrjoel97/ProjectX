# Wave 6 recurrence candidate — current-source independent review

> Historical exact-source checkpoint. The later test-only installed-limiter probe
> changes `model.test.ts` and `README.md`; the current bounded review is
> [47-25](47-25-LIMITER-COMPONENT-PROBE-REVIEW.md). The hashes below remain the
> reviewed bytes at this checkpoint, not the current candidate identity.

**Reviewed:** 2026-09-28  
**Verdict:** limited candidate design review accepted; operational recurrence remains `defer`.  
**Reviewer:** separate read-only native review agent; root implemented and verified corrections afterward.  
**Scope:** exactly the six isolated files below, not deployed Convex, a real spend rail, provider result authentication, D6 completion, ROUT-02, tenant activation or release.

| Candidate path | SHA-256 |
| --- | --- |
| `schema.ts` | `628d3d67dcdefeedd32587341ef715413a537428f6fb6ec9e1c258f61504d909` |
| `model.ts` | `164a0d6513da8ab84932fc44b9b48a1b195b27078a84334d204cb94920424f61` |
| `model.test.ts` | `87c15f701d54e950e1be9900d438e42f59203caede0eb24fb2a3e43660cc3f0f` |
| `README.md` | `6e7e76db5822a211750299f9a7b69fe47595fb48ac46fb169274b97f5cf01d68` |
| `tsconfig.json` | `f4bcc6cf834dbc7601af35296e14315093ca83639e1f77dbd61c3f126e863087` |
| `vitest.config.mts` | `023572d21ee41e72287a616272f6079a45ac43ed0bb0a85e9d9f453ef6a4a7d8` |

The reviewer found two concrete source paths absent from the 45-test baseline. First, a resolved malformed `planRef` threw inside `landPaidStep`, rolling back the landing and stranding a `start_claimed` run. An adverse test was red on that old behavior. The corrected orchestration preserves both holds and the exact paid-step identity in `reconciliation_required`; it neither refunds nor redispatches a possibly spent effect. A later verified result for that same ID/token can settle. Second, a duplicate terminal landing returned its prior outcome before validating the supplied token. The new test was red; the current source refuses a wrong token before either replay return. The reviewer independently checked the correction and README wording against the current hashes. Candidate Vitest passes **46/46** and candidate TypeScript exits 0.

This is **not** an enable-safe verdict. The synthetic external-action admission is a read-only boolean, not the required committed transaction. The synthetic rails have keyed reserve/lookup/release semantics that the installed `@convex-dev/rate-limiter@0.3.2` client does not expose. The candidate's deterministic token is not production authentication. The real rail, money settlement, operator reconciliation, deployed sweep liveness, DST/OAuth/provider traces and separate owner release decision remain open. A new source edit retires this exact review identity.
