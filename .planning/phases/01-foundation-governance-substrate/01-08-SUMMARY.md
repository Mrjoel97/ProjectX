# 01-08 Summary — Public web surface (PARTIAL)

**Status:** Task 1 complete. Tasks 2 and 3 deferred to Phase 9.
**Requirement:** SC-5 (OAuth-prerequisites portion) — **not** satisfied. See "Deferred".

## What shipped

- `apps/web/app/page.tsx` — public homepage. No login wall. Describes the product,
  links `/privacy` and `/terms`. Carries JSON-LD (`Organization`, `WebSite`,
  `SoftwareApplication`). `aggregateRating` and `logo` are deliberately absent:
  Pikar AI has no genuine ratings and no crawlable logo asset, and fabricating
  either violates Google's structured-data guidelines.
- `apps/web/app/privacy/page.tsx` — GDPR-structured privacy policy. Named controller,
  lawful basis per purpose (Art. 6), processor list, international transfers, Art. 15–22
  rights, Art. 22 automated-decision statement, Art. 32 security, 72-hour breach
  notification. All Google disclosures preserved: `gmail.send` as the only Gmail scope,
  no mailbox reads, nothing sends without approval, no model training, Limited Use
  affirmation.
- `apps/web/app/terms/page.tsx` — Terms of Service. §6 states the load-bearing fact:
  `gmail.send` sends *as the user*, so the user is the legal sender and is responsible
  for every approved message. §13 carves out liability that EU/UK consumer law does not
  permit excluding.
- `apps/web/app/legal.ts` — shared constants + a production-build guard.
- `apps/web/app/globals.css` — design system ("custody & clearance") + `.notice`.

## The guard

`legal.ts` throws when `VERCEL_ENV=production` while any bracketed placeholder remains.
A Terms of Service naming `[LEGAL ENTITY — NOT YET FORMED]` binds nobody, and a privacy
policy with no named controller fails GDPR Art. 13 *and* Google's OAuth review. Local and
preview builds are unaffected. A draft banner renders on both legal pages and removes
itself once the placeholders are resolved.

Verified by falsification: normal `pnpm build` → 4 static routes, exit 0.
`VERCEL_ENV=production pnpm build` → fails, naming all five unresolved placeholders.

## Deferred (NOT done)

- **Task 2** — Vercel deploy.
- **Task 3** — domain attachment + Google Search Console DNS verification.
- **Plan 01-09** — OAuth consent screen + demo video + verification submission.

**Why.** Verification requires a privacy policy naming a real data controller. No legal
entity exists. The 2–4 week verification clock therefore cannot start regardless of
whether the site is deployed — so deploying now would publish draft legal documents for
zero gain.

**Why this costs nothing.** Gmail **Testing mode** permits `gmail.send` unverified for up
to 100 test users (users see an "unverified app" warning; refresh tokens expire after
7 days). Phase 2 SC-5 already anticipated exactly this — *"a Gmail token nearing its
7-day expiry prompts the user to re-auth"*. Phases 2–8 need no public site, no verified
domain, and no legal entity.

Verification blocks **Phase 9** (private beta). Form the entity before then.

## Unverified claims in the legal documents

Not legal advice; requires review by a qualified lawyer before publication.

1. OAuth tokens are "encrypted at rest by the platform" — asserted about Convex, not verified.
2. "Never used to train models" — the LLM provider is not chosen until Phase 3, and appears
   in the processor list as `[LLM PROVIDER — TBD]`. Personal data must not be sent to a
   processor the policy does not name.
3. One-month deletion commitment — no erasure process is implemented. Nothing enforces it.
4. Standard Contractual Clauses are asserted; no DPA has been signed with any processor
   (Convex, Vercel, AWS, Google).
5. Effective date `10 July 2026`.

## GDPR obligations a document cannot satisfy

DPAs with every processor; a working erasure process; an Art. 30 record of processing
activities; and the legal entity itself. Note that `CLAUDE.md` §4 (audit payloads carry
refs/hashes/ids/counts only) is what allows the immutable WORM archive (OPSG-03) and the
right to erasure to coexist — there is no personal data in the archive to erase.
**Phase 7 must not violate that**, or erasure becomes impossible to honour.

## Commits

`419c7f4` homepage + privacy · `5d891f0` visual identity · `4fadfa2` typescript pin
`5c38739` boot-order fix · `54f9421` GDPR rewrite + Terms
