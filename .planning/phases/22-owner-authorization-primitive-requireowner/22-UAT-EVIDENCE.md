---
phase: 22
type: uat-evidence
date: 2026-08-01
deployment: "local:pikar-ai-50c69 (the configured CONVEX_DEPLOYMENT, not a lane deployment)"
verdict: "Server-side trust boundary PROVEN live in both directions. DOM half NOT completed — blocked by environment, not by a defect."
---

# Phase 22 — live UAT evidence (GOVN-01)

Run against the configured deployment on 2026-08-01. The second identity was created through the
**Password provider** (`auth.ts` registers it alongside Google), which is what made a two-identity
test possible without the owner's Google credentials — `22-VALIDATION.md`'s "one authenticated
account" assumption turned out to be wrong in our favour.

---

## ✅ 22-01 Task 3 — owner bootstrap. PASS.

Target resolved from deployment data and confirmed against this session's account before granting:
`kn73kmcdzqxem7mkq4n5b9x2b18abrnq` = `joel.feruzi@gmail.com`, Google-verified, the only
non-test row. No guessing, no registration-order inference.

| Check | Result |
|---|---|
| First `bootstrapOwner` | `{ changed: true, userId: kn73km… }` |
| Second `bootstrapOwner` (idempotence) | `{ changed: false, userId: kn73km… }` |
| `users.owner` after | `true` on that row, **and on no other row** |
| `owner.granted` audit rows | **exactly 1** |
| Audit payload | `{ "owner": true, "userId": "kn73km…" }` — key set exactly `owner,userId` |
| Audit actor / correlation | `operator` / `owner-grant:kn73km…` (deterministic) |
| Leakage check | no email, name, image, subject or session anywhere in the row |

A malformed id is rejected even earlier than `NO_SUCH_USER` — at the `v.id("users")` **validator**,
before the handler runs. The `NO_SUCH_USER` branch is reachable only with a well-formed deleted id,
which `owner.test.ts` covers.

---

## ✅ 22-03 Task 3, step 4 — THE trust boundary. PASS, both directions.

This is the step 22-03 flags as load-bearing: *"the DOM check alone is insufficient."*

### Authenticated NON-owner → all four refuse

Fresh password identity, no `owner` field.

```
owner.viewer                          -> {"isOwner": false}      <- authenticated, so refusals below are AUTHZ
optimizerConfig:getOptimizerStatus    -> OWNER_REQUIRED
optimizerConfig:setOptimizerEnabled   -> OWNER_REQUIRED
skills:candidatesForReview            -> OWNER_REQUIRED
skills:activateCandidate              -> OWNER_REQUIRED
```

`owner.viewer` returning `false` rather than throwing is the anti-vacuity anchor: it proves the
caller was genuinely **authenticated**, so every refusal is an authorization decision and not
`UNAUTHENTICATED` in disguise.

**No state change.** A real `optimizerConfig` row already existed. After the refused
`setOptimizerEnabled(true)` it was byte-unchanged — `enabled: false`, `updatedAt: 1784902035415`
(days old, not the UAT timestamp). Stronger evidence than the offline "table stays absent" test,
because here there was a live row that could have been flipped.

### Owner → all four work

Same account after `bootstrapOwner`, so the ONLY variable is the boolean.

```
owner.viewer                          -> {"isOwner": true}
getOptimizerStatus                    -> full config row returned
setOptimizerEnabled(true)             -> {"ok": true, "enabled": true}
setOptimizerEnabled(false)            -> restored; optimizer left DORMANT
candidatesForReview                   -> 4 candidates, BODIES READABLE
activateCandidate(bogus version)      -> NO_SUCH_SKILL_VERSION
```

Two things this pins that the refusals alone cannot:

1. **The refusals were authorization, not breakage.** Same endpoints, same deployment, one flag.
2. **The two gates are independent and correctly ordered.** As owner, `activateCandidate` reaches
   the *skill* gate (`NO_SUCH_SKILL_VERSION`), never the owner gate — so `requireOwner` runs first
   and `EVAL_GATE` still bites afterwards, exactly as `authorization.md` invariant 9 requires.

---

## ❌ 22-03 Task 3, steps 2/3/5 — the DOM half. NOT COMPLETED.

Not a defect and not a pass — simply not obtained. Recorded honestly rather than inferred.

**Why:** the app's `(app)/layout.tsx` force-redirects any tenant without a committed
`business_profile` to `/dashboard/onboarding`, so a fresh test account cannot reach `/ops` at all —
the first "optimizer absent" reading was **vacuous** (the page never rendered) and was discarded
rather than reported as a pass. After seeding a profile doc to clear that gate, the local backend
had degraded badly (a function push took 5.6 minutes; `auth:signIn` hit its 1 s limit) and the
`/signin` form stopped completing in Playwright. Injecting the Convex Auth JWT into localStorage to
bypass the form also failed — the storage-key namespace did not match.

Five approaches, all environmental. Stopped rather than keep retrying.

**What is still unverified by live DOM:** that `/ops` renders the Optimizer section for an owner and
omits it for a non-owner, and that Eval signals / Dead letters / Compliance nav / DLQ badge survive
for a non-owner.

**What covers it in the meantime:** `owner.viewer` returns the correct boolean live for both
identities (proven above), the page's only gate is `viewer?.isOwner === true` around the whole
section, and web typecheck + production build are green. The residual risk is a wiring mistake in
`ops/page.tsx` — real, but small, and it is a *presentation* risk: the server boundary is proven, so
a UI slip could only ever expose the mount, never the data behind it.

**To finish it** (needs a healthy deployment): follow
`docs/playbooks/authorization.md` § "Live owner/non-owner checklist", steps 2, 3 and 5.

---

## Environment left behind

- Deployment state is **clean**: exactly one owner (the real account), **zero** `uat-` test
  accounts, optimizer **DORMANT** (`enabled: false`).
- All throwaway scripts and the temporary `convex/uatTmpRevoke.ts` module are deleted, and the
  module is confirmed gone from the deployment.
- One orphan `vaultDocuments` row remains (the seeded profile whose test tenant was deleted). Inert
  — it belongs to a tenant id that no longer resolves.
- The playbooks hook auto-committed the throwaway paths into `watch.json _unassigned`
  (`fbdd388`, `7b8b31f`); reverted in `6ab36b6`.
