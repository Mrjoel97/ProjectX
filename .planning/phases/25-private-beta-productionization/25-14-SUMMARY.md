---
phase: 25-private-beta-productionization
plan: 14
status: complete
completed: 2026-09-21
---

# 25-14 — First governed self-send bridge

## Delivered

- Added the optional, server-owned `plans.firstSendRecipient` marker.
- Added `cockpit.startFirstSend`, which derives the recipient from `onboarding.firstSendOffer`,
  creates/reuses the existing cockpit thread, and routes the draft through `proposeEmailPlan`.
- Added proposal-time and approval-time recipient checks. A rewritten recipient refuses before the
  proposed state or approval fan-out can advance.
- Made approval preflight provider-aware: Google checks the Gmail grant; Microsoft distinguishes no
  connection from a connected calendar-only grant and routes both to the existing recovery pages.
- Added inline postal-address recovery through `tenantProfile.saveFacts`; saving preserves the same
  proposed plan and requires an explicit second Approve.
- Added the fresh-chat cockpit offer and the opt-in browser fixture
  `apps/web/e2e/onboarding-first-send.spec.ts`.
- Added idempotent shown/started/prerequisite-recovered journey producers and a refs-only receipt
  for every successful human plan-approval arm; double approval remains one receipt and one send.
- Updated the onboarding/cockpit playbooks and watch map with the provider boundary and provisional
  entity name `pikar-ai`.

## Verification

- Cockpit plus journey tests: **89/89 passed**, including self-recipient, provider-aware same-plan
  retry, and exactly-once approval-receipt guards.
- Workspace/result-history tests: **10/10 passed**.
- Controlled local first-send browser run: **2/2 passed** (fresh dual-identity auth setup plus the
  thin-profile offer → governed draft → approval → safe refusal/report terminal). No real provider
  was authorized and no outbound message was sent.
- Playwright discovery: **3 tests in 3 files** (auth setup, Admin isolation, first-send fixture).
- `node scripts/check-playbooks.mjs`: **passed**.
- Web production build: **passed** (including TypeScript; only the existing NFT tracing warning).
- Biome checked all touched source files with no new errors; remaining output is pre-existing warnings.

## Scope boundary

- The standalone backend typecheck remains red on the repository's broad pre-existing test/source
  errors; the web production build completed its TypeScript phase successfully, so no standalone
  backend typecheck pass is claimed.
- This closes the controlled first-send bridge, not hosted provider qualification. No provider
  authorization, real mailbox send, deployment, paid diagnostic, founder checkpoint, or Wave 8
  qualification was performed. Legal registration and external provider enablement remain pending.
