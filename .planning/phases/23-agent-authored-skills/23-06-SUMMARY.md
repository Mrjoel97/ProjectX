---
phase: 23-agent-authored-skills
plan: "06"
subsystem: acceptance
status: in-progress
requirements-addressed: [SKILL-02]
requirements-completed: []
---

# Phase 23-06 — authorized bounded browser probe, execution pending

## Recorded authorization — 2026-09-12

The owner replied exactly **"do it"** to the explicit Phase 23 probe question describing:

- Account A: `qd7bqyyt3yked865nd2b3fm1s18e917z`; account B: `qd79msa8e29c2nkg629cvxp5xd8e8gk1`.
- One irreversible platform-owner grant to A; B remains non-owner.
- Exactly two ordinary browser submissions, with an aggregate ceiling of 100 cents ($1),
  one-hour native expiry, `or/openai/gpt-4o-mini` and eligible `or/openai/gpt-4.1-nano` fallback.
- An attempt to create one inert candidate, with no full evaluation, candidate activation,
  or automatic paid retry.

This records authorization before execution. It is not evidence that the owner grant, model
turns, candidate creation, refusal, budget closure, or handoff have occurred.

## Prerequisite evidence

Production `41d9551b35ee9508015767cb03084679c5a7ebcf` passed CI `34694946587`, deployment
`34695175270`, and its durable probe. Runtime and evaluator pins are unchanged from `644408df`.
The mutation supplement contains 17 preserved historical-target receipts and five additional
direct writer/independent-entry proofs, with explicit compiler/composite reconciliations.
The owning skills suite passed 187 tests; the mutation harness passed six checks over 22 anchors.
The artifact validator passed 1,338 checks; the accepted Phase 21 bundle and no-model inspector
guards were rechecked. All 22 registered free gates passed in CI.

Both controlled accounts completed fresh native password sign-in and independent non-owner
readback. Actual fixed private auth states were exported without token decoding or replay;
`output/playwright/phase23-acceptance/fixed-auth-state-readiness.json` records their limited
readiness claim. The browser harness signs in natively again and bypasses legacy auth setup;
its sign-in-first/button-case correction passed the five offline checks and discovery.

## Execution and handoff

Pending. Stop on the first failed or unresolved model outcome; preserve native holds and recovery
references. A successful budget counter check alone never certifies adversarial policy behavior.
No full paid evaluation, owner candidate activation, rollback, or requirement closure is authorized
by this checkpoint.

### Launcher preflight — no browser probe or mutation started

The first launcher invocation stopped at Windows DPAPI decryption before Node, Playwright, its
once-only attempt lock, native ownership changes, probe registration or model work. The protected
bundle's original null-entropy/CurrentUser parameters were confirmed. An identical compatibility
check succeeded in the default execution context and failed in the escalated context; no
credential value was printed or exported. This is a launcher-context observation, not a claim
that the saved credentials are invalid or a paid attempt failed.

Production-release CI for `7c1a158` separately reported a stale mobile-tab assertion. Paid execution
is held until that free gate is repaired and qualified. The authorization above remains recorded;
there has been no paid retry, owner grant, candidate write, native budget issuance, or handoff.
The private launcher also normalizes duplicate `PATH`/`Path` keys: the prior duplicate prevented
pnpm from resolving existing shims, while the single-key child environment correctly resolved
Vitest without installation or bypassing prerequisite checks.

A credential-free browser preflight then confirmed that the default context can launch Chromium
but cannot navigate even the public sign-in page (`ERR_NETWORK_ACCESS_DENIED`). The escalated
browser context has network access but failed the matching DPAPI decryption check. The approved
run therefore still needs a private, authorized credential handoff between these contexts;
neither plaintext credential files nor weaker machine-wide encryption have been used. Fix
`4df076dbdc8330c54ace5a3996259f3e71318024` addresses the stale free-test assertion, but its new CI
result must be green before the owner/probe sequence may begin.

### Reviewed launcher resumed after green CI — 2026-09-12 13:53 UTC

Root confirmed exact `4df076dbdc8330c54ace5a3996259f3e71318024` CI and production qualification before releasing the authorized launcher. The supported CLI named-secret path cannot launch the frozen test runner with a private child environment. A separately reviewed, ignored one-use local handoff therefore used RSA-4096/OAEP-SHA256, a pinned public-key hash, an exact attempt ID, a closed canonical payload, and ciphertext-only disk transport. Eleven synthetic checks passed before real use, including the PowerShell-to-Node path and wrong-key, tamper, wrong-attempt and wrong-pin refusals. There was no network listener, private-key file, plaintext credential file, JWT extraction or change to product code. Key objects and immutable strings remain process-memory values; immediate secure zeroization is not claimed.

The handoff launched the authorized runner once as `3de192cf-9ffa-427e-a7f7-83a0d33910f0`, executing the exact qualified Git revision above. The consumed ciphertext was removed and the private canary retained under original-context CurrentUser DPAPI. The existing exclusive once-lock is now present and must not be deleted to replay this attempt. Immutable local `attempt-start.json` and receiver identity receipts bind the harness, evaluator and transport source hashes. At this recorded boundary, Playwright has started its real prerequisite checks; they have not yet returned a result, and the owner/probe/model sequence has not been certified as started or completed. The native one-hour budget begins only after those checks and fresh identity baselines pass. No semantic success or final handoff is claimed.

### Attempt stopped before owner/probe/model work — 2026-09-12 14:15 UTC

The single runner exited `1` at `2026-09-12T14:15:14.785Z` with `PHASE23_BROWSER_PROOF_FAILED`; its captured source hashes remained unchanged. Both actual prerequisite subprocesses (`check-free-gates.mjs` and `turbo run test typecheck build --concurrency=1`) returned success: execution passed their fail-closed checks and reached the later browser-proof catch. Their buffered individual logs were not separately retained, so this is control-flow/exit evidence rather than an invented full test-count receipt.

Read-only native checks after the failure returned `isOwner:false` for both exact A/B identities. A's existing authoring projection still had zero total skill rows, candidates, active rows, authoring tool calls for the pre-authoring thread, requests, approved plans and governance activation/rollback audit events. The final private browser snapshot showed the sign-in UI with disabled `Signing in…` and `Connecting…` controls. This establishes a pending authentication/connection boundary, not invalid credentials or a semantic model failure. No probe was assigned in the harness and no recovery attachment was emitted. Together with the verified non-owner state and source order (owner bootstrap precedes registration and both submissions), this supports that this attempt never registered its budget or submitted either model turn. No independent tenant-wide provider-ledger count is claimed from the narrower authoring projection.

The once-lock, immutable start/result records, encrypted canary and failed private browser evidence remain preserved. No passing handoff, owner grant, candidate creation, paid retry, evaluation or activation was certified or attempted after this failure. Any free authentication-harness repair must first receive root review and qualification before resuming the still-unconsumed authorized model scope.
