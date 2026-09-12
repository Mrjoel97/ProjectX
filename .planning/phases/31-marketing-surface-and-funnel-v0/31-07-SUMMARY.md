---
phase: 31-marketing-surface-and-funnel-v0
plan: "07"
subsystem: acceptance
status: complete
requirements-addressed: [MKTG-01, MKTG-02, MKTG-03]
requirements-completed: [MKTG-01, MKTG-02, MKTG-03]
---

# Phase31-07 — live acceptance and approved activation verified

The user explicitly replied **APPROVE MARKETING NAV ACTIVATION** on2026-09-12 after the concrete acceptance packet. This records authorization before the navigation change. Navigation implementation, qualification, deployment and actual desktop/mobile navigation checks are now verified below. The coordinating root owns final requirement/phase status.

## Release and method

Live preparation began after production644408df4c2c630346c5909aac23f9a352ede287 passed CI34692922592/deploy34693161766. The public matrix began13:00:48.026Z on that runtime. Production41d9551b35ee9508015767cb03084679c5a7ebcf was confirmed at13:02:16Z (CI34694946587/deploy34695175270); that followup changes tests/docs, with no runtime behavior changes. Later lead/prefill/negative-route/read-only checks completed on the equivalent runtime, with final review at13:11:37.583Z. This is an explicit runtime-equivalence statement, not a claim that the earlier matrix ran against a later commit.

The standalone exported-session Playwright suite did not pass all three scenarios. Its first run passed desktop1440/mobile390 checks in17.6seconds, then failed initial readiness before any link; the lead test did not run. A continuous-context retry failed readiness and later tests did not run. Correct-origin diagnostics showed `/signin`; subsequent navigation of the original browser also required sign-in. Refresh replay is a possible cause, not a proven diagnosis. The stale exported auth state was deleted. Following fresh user sign-in, the coordinating agent authorized direct Playwright assertions in the existing authenticated context, with genuinely fresh anonymous contexts for public HTTP. No further auth export/replay or credential reading occurred. This method provides actual live UI/HTTP evidence while retaining the standalone-suite failures explicitly.

## Observed acceptance

- Desktop1440/mobile390: all six channels rendered; Gmail showed Connected, every social channel named legal-entity and provider-review blockers. Keyboard title→source focus passed, document width fit, and the mobile lead control remained reachable. Screenshots were captured only before tokens existed or after the secret panel was cleared.
- Exact existing synthetic note-a document `qh75z490y3jergxd6397mywmx98e6wjy`:243originalbytes, SHA256`76a547aadd460a7eabf9bd8408c500ecf793092546cf69944ea645329a61b08f`, matching the independently retained local original. No upload/generation or source modification occurred.
- One successful test link, title`Marketing UAT live 20260912-1789218048026`, source`uat-1789218048026`. Each newly created anonymous context returned302 to the same stored file and200/243bytes matching the original hash. Counts progressed visits/claims/downloads `[1,0,0]`, `[1,1,0]`, `[1,1,1]`. Responses had no-store/no-referrer, empty bodies and no Set-Cookie.
- HEAD returned405 with counts unchanged. A changed public source parameter still used the stored source and yielded `[2,1,1]`. Deactivation and finally cleanup succeeded. All three deactivated stages returned empty404 without Location, and counters remained `[2,1,1]`.
- Additional anonymous unknown-token, invalid-stage and malformed-token requests returned identical empty404/noLocation/no-store at13:09:16.459Z. The owned deactivated row still showed `[2,1,1]`.
- One-time links were read only from the immediate panel, which was closed before HTTP assertions. Subsequent list UI had no readonly token field, secret link or recovery control. Inspected matrix/negative receipts and logs contained zero literal secret-bearing funnel URLs.
- The exact controlled example.test fixture was created once with absent consent, verified as one `user-entered` Pipeline row, then marked suppressed. Recapture remained `suppressed`; the same single row/provenance persisted and consent still displayed `none on record`. The contact/suppression is intentionally retained because Contacts has no delete seam. No unsuppress/tenant deletion was invented.
- Gmail's Marketing CTA populated the exact static unsent draft, consumed the closed intent/channel parameters, preserved the original workspace tab and showed no working send state. The synthetic unsent draft was cleared without sending. No model/provider/send/publish action was invoked by acceptance.

A pre-creation helper attempt failed on an exact wrapped-select label selector; it created no token. The harness now targets the native combobox with a stable label prefix, confirmed in the actual browser. A separate initial layout helper read Gmail before its query settled; waiting for live state resolved it. Before-unload prompts on the owned acceptance tab were handled within scoped synthetic-navigation cleanup; unrelated tabs and drafts were preserved. None of these attempts is represented as an application semantic failure or silently counted as a passing standalone suite.

## Threat-model evidence and retained limits

Native tests cover cryptographic token/hash persistence, authenticated tenant ownership, trusted storage lookup, atomic bounded integer counters, exact aggregate-only schema, GET-only routing, unchanged middleware, no event table/public contact writer/publisher, and Contacts suppression convergence at approve/send seams with zero provider calls. Live evidence adds actual authenticated management, unauthenticated routing/bytes/counters/refusals, one-time UI disclosure, provenance/suppression and unsent handoff. Backend concurrency/cross-tenant enforcement were not separately load-tested in production; their existing native tests remain the evidence. The standalone exported-session harness remains unsuccessful, and the direct-context method deviation is explicitly disclosed above.

Ignored receipts under `output/playwright/production-acceptance`: `marketing-prerequisites.json`, `marketing-contact-fixture.json`, both original suite logs and `marketing-export-diagnostic.json`, `marketing-direct-layout-result.json`, `marketing-direct-matrix-final-result.json`, `marketing-direct-lead-final-result.json`, `marketing-direct-prefill-result.json`, `marketing-direct-negative-result.json`, and `marketing-direct-final-review-result.json`. Token-free screenshots: `marketing-live-desktop-top.png`, `marketing-live-mobile-top.png`, `marketing-live-mobile-leads.png`, `marketing-live-deactivated.png`. Earlier partial receipts remain as history.

The approved navigation change passed its release gates and the postdeployment checks below. The coordinating root owns final requirement/phase status and release receipts.


## Approved activation verification

Production`4df076dbdc8330c54ace5a3996259f3e71318024` passed CI`34696845981`, deployment`34697141228`, durable probe at13:44:19Z and production status at13:44:23Z. At2026-09-12T13:48:12.226Z, direct Playwright checks in the existing signed-in context verified desktop1440 and mobile390 Marketing navigation. Each viewport navigated from Vault through keyboard focus/Enter and through an actual pointer click; Marketing rendered, `aria-current="page"` was present, and the document fit the viewport. The existing synthetic link remained deactivated with counts `[2,1,1]`; no token panel/recovery control was present. The original workspace tab and its route were preserved. No export/replay, new funnel, model/provider/send or full HTTP-matrix repeat occurred.

Evidence: ignored `marketing-postactivation-result.json` plus `marketing-activated-nav-1440.png` and `marketing-activated-nav-390.png`. The mobile screenshot was visually reviewed: Marketing is visible and active in the compact bar, with no document-width clipping. These checks establish actual deployed navigation, while the earlier failed standalone exported-session suite and authorized direct-context method remain disclosed above. No further browser acceptance work remains for this activation.
