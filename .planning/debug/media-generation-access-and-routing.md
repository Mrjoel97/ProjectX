---
status: resolved
trigger: "Investigate and fix image/video generation failures in C:\\Users\\expert\\desktop\\pikar-ai."
created: 2026-08-13T23:00:47+03:00
updated: 2026-08-14T00:50:00+03:00
---

## Current Focus

hypothesis: Confirmed and repaired: the original AccessDenied came from using the wrong workspace host, while retry/UI handling and explicit video routing were separate application defects.
test: The corrected production workspace host accepted the deployed key on both image and video submit endpoints; protected CI and the ordered production deployment completed successfully.
expecting: New explicit video requests stage a review deck, and failed/blocked image attempts expose a retry that follows the newest attempt. Paid generation remains behind the human confirmation gate.
next_action: Optional human UAT can create one approved image/video when a billable provider call is acceptable.

## Symptoms

expected: Explicit image/video requests produce review proposals and, after human click/approval, successfully generate Wan assets.
actual: Image paid submission fails AccessDenied; video requests do not appear to invoke dispatchMedia/reach a reel plan; failed image cannot retry same conversation; UI still says fal.
errors: mediaJobs failureReason AccessDenied; dev missing Media env configuration.
reproduction: Ask cockpit agent for image, click Generate image -> Wan job failed. Ask for video/reel -> no dispatchMedia evidence/job.
started: Provider cutover to direct Wan accepted 2026-08-13; failure observed 2026-08-13.

## Eliminated

## Evidence

- timestamp: 2026-08-13T23:03:30+03:00
  checked: repository worktree and broad media symbol inventory
  found: The worktree contains many unrelated modified and untracked files, including cockpit and workspace files; media behavior spans backend provider/action code, cockpit routing, and proposal UI.
  implication: Preserve existing edits and inspect diffs before touching overlapping files; treat the three symptoms as potentially independent until evidence connects them.

- timestamp: 2026-08-13T23:07:00+03:00
  checked: Wan adapter against Alibaba Model Studio's official legacy Wan 2.5 async API documentation and production configuration probes
  found: The code uses the documented workspace-specific Singapore endpoint, Bearer key, X-DashScope-Async header, model, and request shape. The configured key can access the workspace model-deployments endpoint, while the visual submit returns AccessDenied before any task id.
  implication: The production failure is provider-side model/workspace authorization, not polling, serialization, missing env, or an invalid workspace endpoint. It cannot be repaired safely in repository code.

- timestamp: 2026-08-13T23:09:00+03:00
  checked: generateImage mutation and ImageCanvas attempt selection
  found: generateImage rejected when any historical image row existed, including failed/blocked rows; ImageCanvas selected the first image row, disabled generation whenever one existed, omitted failureReason, and displayed stale fal/Flux copy.
  implication: A single provider rejection permanently stranded that conversation even after provider access was corrected, and the UI could never follow a subsequent attempt.

- timestamp: 2026-08-13T23:12:55+03:00
  checked: focused backend media suite after retry fix
  found: 146 active tests passed (24 superseded legacy tests skipped), including the new failed-attempt retry and active-attempt double-click guard.
  implication: Failed/blocked standalone image attempts can now create one fresh governed reservation while queued/submitted/succeeded attempts remain single-start protected.

- timestamp: 2026-08-13T23:13:24+03:00
  checked: focused web media canvas suite
  found: 2 tests passed, proving latest-attempt selection, terminal retry affordance, failure reason visibility, and current Wan/model copy.
  implication: The canvas no longer remains pinned to the first failed attempt and no longer describes direct Wan generation as fal/Flux.

- timestamp: 2026-08-13T23:14:30+03:00
  checked: cockpit media tool registration and supplied production trace summary
  found: dispatchMedia and proposeImage are both conditionally registered for executive turns with root lineage; proposeImage was observed in production. No video job or dispatchMedia step was present in the sampled last 100 steps, but no exact video request/response trace was available.
  implication: Tool availability is proven; video misrouting is not yet reproducible or attributable to a deterministic code predicate. A fresh explicit request after deployment is required to distinguish model choice from an actual routing defect.

- timestamp: 2026-08-13T23:28:00+03:00
  checked: deterministic routing for unambiguous video-creation requests
  found: Explicit create/generate/make/want-video phrasing now invokes dispatchMedia directly and records the normal activity step; video strategy, review, and existing-video questions remain in the model loop.
  implication: An explicit request for a video deliverable can no longer be lost to model tool selection, while the free proposal and separate human spend gate remain intact.

- timestamp: 2026-08-14T00:50:00+03:00
  checked: corrected clipboard workspace host, no-charge provider authorization probes, protected CI, and ordered production deployment
  found: Both Wan image and video endpoints accepted the production key and rejected only the intentionally empty model field, before task creation. PRs #9 and #10 passed full CI; production run 31747156480 passed Convex dry run/deploy, skill seeding, staged-site probe, Vercel promotion, and durable URL verification. https://www.pikar-ai.com returned HTTP 200.
  implication: Provider authorization, application retry/routing behavior, and production release are repaired without performing a billable media generation.

## Resolution

root_cause: "Three independent causes: (1) production used the wrong Alibaba workspace host for its key, so Wan rejected the request before creating a task; (2) the app treated every historical image row as permanently active and rendered the oldest attempt, so a failed provider submission could never be retried or superseded; (3) explicit video creation depended entirely on model tool selection, and the sampled production trace never invoked dispatchMedia."
fix: "Allow a fresh standalone-image reservation only after prior attempts are terminal failed/blocked; keep queued/submitted/succeeded as the serializable double-click guard. Return attempts oldest-first with failureReason, render the newest image attempt, expose actionable failure copy and Retry image, and replace stale fal/Flux labels with Wan and the configured model. Route narrowly defined explicit video-creation requests directly to the free dispatchMedia proposal while preserving the human paid-generation gate."
verification: "Backend media + explicit-video routing: 157 passed, 24 legacy skipped. Web media canvas regression suite: 2 passed. Backend and web TypeScript typechecks passed. Protected CI passed on PR and main. Production run 31747156480 completed every backend/web release step, and the durable URL returned HTTP 200. No paid provider call was made."
files_changed:
  - packages/backend/convex/media.ts
  - packages/backend/convex/media.test.ts
  - apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx
  - apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts
  - packages/backend/convex/mediaIntent.ts
  - packages/backend/convex/mediaIntent.test.ts
  - packages/backend/convex/llm.ts
