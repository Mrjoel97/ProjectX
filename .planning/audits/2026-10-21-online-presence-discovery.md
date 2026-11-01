# Online presence service — discovery and recovery report

Date: 2026-10-21 (Africa/Dar_es_Salaam). Historical discovery snapshot, completed before the owner authorized implementation with multiple agents. The findings below describe that inspection point. Follow-up implementation and actual validation are recorded in `../phases/53-agentic-online-presence/53-01-SUMMARY.md` and `53-VALIDATION.md`; this discovery report is not a release acceptance claim.

## Finding

The previous website and shop work exists. Most of it is on an older, unmerged draft branch, not on current `main`. Rebuilding from current `main` without examining that branch would duplicate substantial work.

The earlier draft contains a real structured website/landing-page runtime and designed recipes, with recorded repository/local qualification. Its commerce foundation includes private catalogue, inventory, policy, cart and order mechanisms. Public storefront commerce is deliberately disabled. The agent-led service that reads the business foundation, gathers only missing facts and delivers the entire online-presence package is still missing from the inspected paths.

The next work should recover and reconcile the existing implementation, then add the agent-led service around it. It should preserve current-main improvements and existing release boundaries. This is a recommendation for approval, not an executed implementation plan.

## 1. Isolation completed

| Item | Value |
| --- | --- |
| Repository | `Mrjoel97/ProjectX` |
| Separate working folder | `C:\Users\expert\Desktop\Pikar-ai\online-presence-discovery-20261021` |
| Local and GitHub branch | `codex/online-presence-discovery-20261021` |
| Starting commit | `821c3206e47eb4cec0ebcf3d99cf943358f2910a` — fetched current `main` before creating the worktree |
| GitHub branch | [Open discovery branch](https://github.com/Mrjoel97/ProjectX/tree/codex/online-presence-discovery-20261021) |
| Earlier implementation | [PR 36: Draft: integrate closure programme and evidence-integrity repairs](https://github.com/Mrjoel97/ProjectX/pull/36) |
| Earlier branch | `step0-evidence-integrity` |
| Inspected draft commit | `5d7b9e5a8e0acaecbdc110123718798565421b5c` — 2026-09-29, `feat: add private merchant policy editor` |
| Shared ancestor | `33eec7d37f46b32004558cba015b00e8b167dd82` |
| Divergence at inspection | Current-main baseline has 95 commits beyond the shared ancestor; the draft has 264 |

GitHub reported PR 36 open, draft, unmerged and not mergeable at inspection, with 625 changed files. That is not a safe single-feature merge candidate. The source was fetched for inspection only; no merge, cherry-pick, rebase, deployment, provider mutation, skill activation or paid evaluation was performed. Existing checkout files were not edited. This report is the only authored repository file in the discovery worktree.

The repository was initially shallow. Older Git history was retrieved before the historical conclusions below. The discovery branch stays based on current `main`; the older implementation is a reference, not an implicit new baseline.

## 2. Intended product outcome

The user provides the business information and requirements that the agent cannot already establish from the approved business foundation and documents. Pikar coordinates the rest: requirements, content, design, assets, pages, validation, preview, deployment preparation, publication and handover, with an appropriate shop branch when selling is required.

The user should not have to assemble prompts, select and dispatch specialists, write HTML, operate a JSON editor, connect workflow nodes or manually move artifacts between product areas. Business decisions, account ownership and approval of externally published material remain distinguishable from technical work performed by the agent.

Three outcomes need separate completion criteria:

- **Landing page:** a focused campaign/offer page, working CTA and optionally consented inquiry capture.
- **Business website:** coherent multiple pages, brand and business information, navigation, contact paths, publishing and maintainable revisions.
- **Online shop:** a sellable catalogue plus verified merchant/payment, order, delivery, stock, policy and buyer-support behavior. A catalogue presentation alone does not satisfy this outcome.

Service businesses also need an explicit sales path. Listing services exists in the earlier site recipe; service booking, deposits, service fulfilment and paid appointments are not established by the inspected physical/digital-goods commerce contracts.

## 3. Evidence and scope

The audit covered repository conventions, current GSD state/requirements/roadmap, the original growth-surface decision, document-generation history, current workflow and vertical architecture, foundation/blueprint context, Marketing/funnel records, billing/connector boundaries, the approved managed-services programme, Git history, GitHub branch inventory and relevant PR searches. The current baseline contains 1,615 tracked Markdown files; those were inventoried and searched, with relevant records and implementation paths read in depth. This is not a claim that every line of every unrelated or vendored Markdown file was read.

For the recovered draft, the audit examined public-web and commerce playbooks; website, recipe and merchant phase plans/summaries/verification; upstream-design adaptation; release re-entry packets; owner merchant choices; the closure wave map; structured contracts; renderer/recipe/lifecycle code; private catalogue/policy UI; and the absence of web-creation wiring in the inspected Executive tool paths.

`graphify query` was attempted as required by repository conventions, but the executable is unavailable. Focused source/history reads were used. The existing graph was not represented as a freshly regenerated or authoritative current-source graph. The backend AGENTS file was read; its referenced generated AI guidelines file is absent in this checkout. No Convex implementation was attempted.

No current production rows, provider dashboards, private credentials, other chats' histories or unavailable private evidence files were inspected. Historical qualification statements below are attributed to their recorded branch and source scope; they are not fresh live observations. Current provider eligibility and legal facts require a later official-source and account-specific check.

At the final isolation check, the original `ProjectX` checkout had acquired concurrent, uncommitted GSD updates and a PR81 staging-handoff packet. Those files were left untouched and were not imported into this stable discovery snapshot. The Phase 23/48 status below describes committed baseline `821c3206`; reconcile the other lane's newer receipts before implementation or any live qualification action. The separate worktree prevented that ongoing work from changing the source being audited here.

## 4. Where the work actually stopped

| Period | Record or implementation | Meaning now |
| --- | --- | --- |
| 2026-07-31 | `growth-surfaces-canvas-funnels-connections.md`, section 3.1 | Landing-page output was scoped to escaped downloadable HTML. Public publishing was deferred. |
| 2026-08-01 | `dc990a51`, `1b53e32b`; Phase 18 plans 01 and 05 | HTML renderer and attachment-format path implemented. This remains on main. |
| 2026-08-08 | Phase 18 plan 08 summary | Document creation teaching was live-certified after a real create/replace defect was fixed. It did not close the full phase. |
| 2026-09-06 | Phase 40, `c2cefd42`, ADR-036 | Inline PDF, spreadsheet generation and format-preserving regeneration added; HTML remains an attachment format. |
| 2026-09-12 | Phase 31 verification | Public tracked file links and Marketing navigation qualified at their recorded scope. These are file redirects, not customer-site hosting. |
| 2026-09-21 to 29, older draft | `48-business-website-and-landing-page-runtime` | Six plans complete at the recorded repository/local layer: site lifecycle, immutable rendered versions, preview, public HTTP, forms, metrics and rollback. |
| 2026-09-23 to 29, older draft | `49-qualified-public-web-and-storefront-recipes` | Seven plans complete at the recorded repository/local layer: three designed recipe families, provenance, qualification and private storefront presentation. |
| 2026-09-24 onward, older draft | `50-tenant-merchant-commerce` | Provider-independent commerce and later physical/digital policy work implemented. Provider-dependent work and public checkout remain open. |
| 2026-09-27 | `6e0db5b0` on older branch | Earlier uncommitted product-spine work landed on a revision, making it traceable in Git. |
| 2026-09-29 | Draft head `5d7b9e5a` | Latest inspected change mounts the private merchant-policy editor. This is the latest concrete feature continuation found. |
| 2026-10-19 to 21, current main | Managed-services programme, phases 48–52 | A newer shared-service programme was planned. Its service boundary is not implemented; readiness qualification remains partial. |

The answer to “where did we end last time?” is therefore: **the site and landing runtime reached recorded local qualification on the older draft; storefront commerce stopped at private operational foundations and a pending merchant/provider decision; the complete agent-led online-presence service was not connected.**

## 5. Current-main capability boundary

### HTML generation is real, but limited

`packages/core/src/documentGen.ts` defines `pdf | html | xlsx`. Its `renderHtmlDocument` renders headings, paragraphs, emphasis, lists and tables using escaped text and fixed document CSS. `llm.ts` calls it through `generateAttachment({format: "html"})`, with the existing drafting, size, storage and spend controls. Regeneration preserves the existing format.

This is a basic document-shaped HTML file. It has no site/page model, layout selection, navigation lifecycle, image/asset composition, working form or rendered Markdown link. An offline invocation of this existing renderer during the audit verified escaped supplied markup, headings/tables and HTML MIME/filename behavior; it also confirmed that a Markdown CTA remains text rather than becoming a link.

`createDocument` accepts `short | long | sheet`; there is no standalone HTML form in that tool. The current Output card renders PDF or Markdown. The original proposed sandboxed HTML `srcDoc` preview is not implemented in that card. The PDF iframe has a different policy under ADR-036 and must not simply be reused for active HTML.

### Marketing is useful infrastructure, not a site publisher

`funnels.ts` and `/f/:token/:stage` share a chosen stored artifact through a hashed bearer token, count independent raw requests and redirect to the exact stored file. Deactivation closes that resolver; it cannot erase copies or revoke storage URLs already handed out. Existing anonymous OAuth, unsubscribe and webhook routes also mean the July statement “no public routes” is historical, not current architecture.

There is no customer website/shop runtime in the inspected main schema and application routes. Pikar's own homepage and the Phase 35 homepage-copy changes are unrelated to building a tenant's website.

### Existing workflow library

`/dashboard/skills-workflows` reads active workflow offers and launches an existing workspace thread. The seven curated pack IDs are business-pulse, campaign-plan, customer-complaint, sales-call-prep, process-sop, brand-review and offer-and-lead-plan. None is a site builder.

Packs are leaf agents. Code owns their tool grants; their instructions cannot grant delegation, paid image generation or arbitrary external publication. They can contribute research, copy, offer structure or a saved document where their existing grants allow it. The Executive must own cross-workflow composition.

The six optional Phase 30 verticals are legal, HR, product, design, engineering and data. They are specialist document/analysis candidates, not website or commerce services, and current records leave them unqualified for general release. A website workflow is not already present merely because “verticals” exists in the product.

### Business context is reusable

Foundation records already distinguish business overview, offers/customers, operating model, sales/delivery, goals and constraints. They preserve user statements, provenance and current-versus-planned intent. Publication is bound to a revision and reviewed content hash.

The Executive's ordinary turn already receives a confirmed Blueprint spine and a separately obtained finance spine, and can retrieve owned Vault documents. Missing Blueprint context fails open to a conversation with less context; it is not a declaration that enough business information exists to publish a site.

A future website brief should explicitly snapshot the selected approved sources, identify conflicts/staleness and ask only for unresolved information. It must not silently treat private documents, planned operations, generated copy or unapproved claims as public business facts. Generated work remains distinct from user evidence under existing promotion/provenance rules.

## 6. Recovered draft: reusable website and landing implementation

The draft adds the following concrete components:

| Component | Existing implementation | Qualification limit |
| --- | --- | --- |
| Structured content | `packages/contracts/src/webRuntime.ts`; bounded `WebDocument`, closed node types, site/landing/storefront kinds | No arbitrary executable site code; existing bounds include 20 pages and 100 nodes. |
| Rendering | `webRuntime.ts`, `webDesignRenderer.ts` in core | Deterministic HTML and stored version artifacts; old public bytes survive renderer changes. |
| Project lifecycle | `webProjects.ts`; `webProjects` and `webProjectVersions` | Draft/edit, exact-version approval, publication/update, unpublish and rollback with revision checks. |
| Host/public boundary | `webRuntime.ts`, `/p/:slug/:page` routes | Server-owned host/tenant resolution; only approved published stored bytes are served. |
| Leads and metrics | `webForms.ts` | Bounded contact forms, suppression/consent, idempotency, abuse coordination, attribution and raw aggregate counters. |
| User interface | `/dashboard/sites`, `SiteEditor`, `PreviewCanvas` | Protected editor and exact stored-artifact preview; currently user/operator driven. |
| Recipe system | core/backend `webRecipes.ts` | Business site, campaign landing and storefront catalogue; exact active registry identity and evidence required. |
| Design knowledge | compiled design knowledge, renderer profiles and three pinned upstream snapshots | Offline reviewed data; not upstream code or prompts executed inside tenant requests. |
| Release controls | phase 48/49 acceptance and qualification checkers, disposable browser stacks, owner qualification interface | Recorded local evidence, not hosted/production acceptance or current-main integration evidence. |

The draft's recipes use `web-recipe-business-site`, `web-recipe-campaign-landing` and `web-recipe-storefront-catalogue` registry names. They are canonical structured recipe definitions, not unrestricted agent prompts. Recipe-produced versions carry skill/version/body, definition, input, design-bundle and renderer provenance. Typed brand/headline/services/offer/proof/contact/catalogue values are materialized into the structured document.

The upstream adaptation record covers UI/UX Pro Max, Taste Skill and Nexscope eCommerce-Skills. It excludes runtime package installation, arbitrary code, external scripts and claims of commerce functionality. Eight compiled records and three pinned MIT sources are recorded. This is a reusable starting design system; it is not evidence of unlimited bespoke design or automatic business-context reasoning.

The recorded phase 48 matrix covers desktop/mobile lifecycle, stale-write refusal, exact anonymous bytes, CTA/form paths and rollback. Phase 49 records later serialized 21-plane local qualification and two separate browser/audit stacks. These receipts must remain historical for their exact source sets. Integration with October main changes source identities and requires fresh affected checks.

## 7. Recovered draft: commerce status

### Implemented provider-independent foundations

- Closed tenant-commerce identities and safe integer-minor money calculations, separate from Pikar billing and finance reads.
- Tenant products, stock and reservations, explicit finite versus untracked stock, revision checks and expiry/release mechanisms.
- Authenticated private catalogue UI and physical/digital classification, including refusal for unclassified legacy products.
- Versioned merchant-authored policy with distinct physical shipping/returns and digital delivery/revocation references.
- Private cart and mapped live-product quote, server-recomputed prices, immutable quote hash and one local order/attempt per cart revision.
- Atomic stock holds, expiry, cancellation and conservative handling of inconsistent links and late-payment transitions.
- Export/erasure classifications and retention refusals for unresolved order/attempt records.
- A bounded anonymous cart-intent preflight that remains read-only and closed before order writes.

Plans 50-01–05, 18, 19 and 20 have recorded summaries for their bounded work. That does not close SHOP-02–05 or Phase 50 as a sellable shop.

### Deliberately unavailable

`packages/backend/convex/webRecipes.ts` contains `commerceContractReady = (): false => false`. Normal discovery excludes storefront recipes. Publication/runtime paths also refuse storefronts; owner qualification creates a private presentation artifact. Seeded pointers or UI changes cannot legitimately open it.

There are no implemented/qualified merchant Stripe and PayPal receiving adapters in the inspected commerce inventory. The pending decision packet, buyer checkout, signed payment lifecycle, refunds, merchant review, delivery/entitlement, buyer notifications and public readiness remain material unfinished work. Some pure transitions and policy references exist; they are not evidence of those operational flows.

### Prior owner choices to preserve

The draft records these specific decisions, which should not be asked again as if unknown:

1. Both Stripe and PayPal in the first **test-mode release**; an individual merchant can use an eligible selected provider.
2. Merchant-owned direct receiving accounts; no pooled seller proceeds and no reuse of Pikar's subscription account.
3. Both physical and digital goods.
4. Merchant-authored tax, shipping, refund and buyer-retention policies, enforced by version.
5. All countries as a long-term target; eligible seller/account/currency combinations first. USD, EUR and GBP settlement are targets, not universal capability claims.
6. Merchant-configured finite-stock holds of 1–60 whole minutes.
7. A paid-after-expiry/unavailable-stock exception goes to merchant-admin review; refund or documented fulfilment alternative plus buyer status notice, with no automatic fulfilment/refund in that branch.

`docs/releases/phase-50-merchant-decision.md` remains pending. It lists unresolved provider/account eligibility, supported delegated account flow, country/currency/payment-method matrix, fees/liability, buyer SDK/account binding, merchant policy bounds, delivery/refund/notification and retention facts. Its September provider research is historical. This report makes no new current provider-country or legal finding.

## 8. The agent-led experience is the principal missing integration

In the draft, `WebRecipeForm` asks the user for recipe values, title and slug. `SiteEditor` provides manual editing/lifecycle controls; the private shop adds catalogue and policy forms. `createProjectFromRecipe` is a tenant mutation that materializes supplied structured values.

Targeted searches found no `webRecipes`, `webProjects` or `createProjectFromRecipe` connection in the draft's `llm.ts`, `cockpit.ts`, `toolGrants.ts` or agent skill Markdown. The inspected web recipe/project/UI paths also do not read the Foundation or Blueprint. Thus the evidence supports a form-driven runtime and recipe platform, not the fully adaptive Executive service requested here.

The missing service should orchestrate an outcome with persisted progress and clear terminals. A skill alone supplies instructions; it does not create a new trusted site/merchant operation, persist a service run, grant permission or make a published site reliable.

Candidate service stages, for later approved design:

1. Read approved Foundation/Blueprint and selected Vault evidence; identify business, audience, offers, goals and constraints.
2. Determine landing/site/shop and whether selling means inquiry, booking, digital delivery or physical fulfilment. Resolve only missing or contradictory facts.
3. Produce a structured public-content brief with claim provenance, brand decisions, page map, assets, domain intent and necessary seller policy/account inputs.
4. Compose qualified design/content/asset operations and materialize a site through the recovered renderer/project seam.
5. Validate responsive pages, accessibility, navigation, asset resolution, form consent, public/private data and the specific selling path. Repair within a bounded budget.
6. Present one reviewable package and an exact publication decision; execute allowed publication and verify the actual result.
7. Hand back the live URL, editable project, source/asset references, lead/order handoff, policies, support status and a real rollback path. Record partial/failed/unknown outcomes honestly.

These are proposed service stages, not new GSD phases, runtime contracts or claims of implemented behavior. No hosting or payment provider was selected anew during discovery.

## 9. Connection to the existing managed-services programme

Current main's 2026-10-19 owner-approved programme already states that users supply outcomes and operating boundaries while the Executive coordinates approved skills, workflows and connector tools. It is aligned with the desired user experience.

Its current order is readiness closure → shared managed-service boundary → recurring read/prepare → Brain/outcome links → a complete social pilot. Phase 49 plans service setup/revisions, readiness, trusted idempotent starts, pause/stop, validated operation composition and conversational supervision. Those contracts are planned, not implemented in current source.

Current records retain Phase 23 at 6/9, Phase 27 at 8/9, optional verticals unqualified, and the Phase 48 readiness seal unfinished. Only the capability inventory is complete among the new programme's requirements. This discovery does not alter that order or silently authorize the online-presence lane to bypass its entry rules. A later owner-approved plan must explicitly reconcile whether this service waits for, contributes to or changes that sequence.

A one-time attended website build should not depend on finishing generalized recurring execution. Ongoing monitoring/content updates are a separate extension, with existing recurrence decisions preserved. ADR-046 currently allows unattended reads/preparation, with human approval of external writes. “Agent does the work” can fit that boundary; permission for unlimited future publishing is a different decision and has not been inferred here.

## 10. Integration conflicts that must be resolved before building

1. **Branch/source divergence.** Recover selected feature modules onto current main with explicit shared-file ownership. Do not merge the 625-file closure PR wholesale or roll back October fixes. Relevant shared files include schema, HTTP, tenant lifecycle/export/erasure, skills, tool/runtime, UI, cost and evaluator identities.
2. **GSD number collisions.** Draft phase 48 means public website runtime; current-main phase 48 means readiness/qualification closure. Draft phase 49 means web/storefront recipes; current phase 49 means shared managed-service boundary. Draft phase 50 means merchant commerce; current phase 50 means recurring read/prepare. Use full directory names and source commits; establish an explicit mapping before changing roadmap/state/requirements. Do not overwrite either history.
3. **Authority and evidence scope.** July deferrals, September local qualification and October programme admission describe different scopes. Preserve historical decisions and introduce an explicit superseding/recovery record where needed. Local browser receipts are not current hosted acceptance, merchant approval or real customer success.
4. **Skill/grant integration.** Keep curated packs as leaves. Add only the approved trusted Executive/service operations; do not permit a recipe or prompt to acquire deployment, payment or code-execution authority.
5. **Public data boundary.** Business documents can contain private information. Public copy needs an explicit selected-source and claim review; permission to retrieve a document is not permission to publish it.
6. **Merchant separation.** Preserve the distinct stores and credentials for Pikar subscriptions, tenant read-only finance and tenant selling. Existing billing checkout is not a shortcut to merchant checkout.
7. **Publication identity.** Preserve immutable exact versions, content hashes, host bindings and rollback. Unknown provider effects require reconciliation before retry; duplicate paid work or orders must not be hidden by a successful-looking progress card.
8. **Operational readiness.** Verify owned hosting/domain setup, actual deployed routes/headers/forms, retention and abuse behavior, account capabilities and release rollback. Old Wave 7/8 records are open historical prerequisites, not current observed facts.
9. **Service sales.** Add a specific supported inquiry/booking/payment/fulfilment contract for services before advertising service commerce. Physical/digital goods do not automatically cover it.

## 11. Recommended continuation for the owner's approval

The next authorized unit should be a **recovery and service-design plan**, grounded in this inventory:

- Map the old website/recipe/commerce requirements and files onto current main and current GSD numbering, with a minimal selective-port strategy and affected tests.
- Define one online-presence service with landing, business-site and shop branches, using the recovered runtime rather than a parallel builder.
- Specify what the Executive can reuse from approved business context, how it asks for missing inputs, what it produces, and the exact completion/partial/failure criteria.
- Reconcile the shared managed-service entry boundary with the current approved programme and decide the release order explicitly.
- Retain the existing shop decisions and isolate unresolved provider/operational questions. The agent should perform the research and preparation, then present concrete account/business decisions only where required.
- Plan source-bound local qualification first, followed by hosted/merchant acceptance at its actual scope. Do not claim a shop complete because a catalogue renders.

An attended landing/site path appears to have substantially more recoverable implementation than a full shop. That is a readiness assessment, not permission to narrow the requested full package or to drop either payment provider, physical/digital goods, or service-business needs.

## 12. Checks actually performed in this discovery

- Created the separate Git worktree and verified both branch refs point to the intended main baseline.
- Retrieved older Git history, inspected relevant commit paths/messages and compared the recovered draft with main (95/264 divergent commits).
- Queried GitHub branch inventory and relevant PR searches; inspected PR 36 metadata, changed filenames and exact fetched source.
- Inventoried/searched current tracked Markdown and followed relevant playbook/GSD/source paths on both baselines.
- Executed a zero-cost, dependency-free check of the existing main HTML renderer: escaped markup, headings/tables, HTML MIME/filename and the absence of rendered links/images/forms for supplied Markdown/markup.
- Confirmed no application-file changes against the discovery starting commit before writing this report.

No full test suite, draft browser stack, production build, hosted UAT, paid model corpus, payment flow or deployment was run in this audit. The test/build counts in historical summaries remain their authors' recorded evidence for those historical source sets, not tests executed by this discovery.

## 13. Source index

Current-main paths are relative to this discovery worktree. Draft links are immutable commit references.

### Current main

- [Repository conventions](../../CLAUDE.md), [documentation conventions](../../docs/README.md).
- [GSD state](../STATE.md), [roadmap](../ROADMAP.md), [requirements](../REQUIREMENTS.md).
- [Original growth-surface decision](../design/growth-surfaces-canvas-funnels-connections.md).
- [Phase 18 history](../phases/18-document-content-creation/18-05-SUMMARY.md), [document-creation certification](../phases/18-document-content-creation/18-08-SUMMARY.md), [open drift-exclusion plan](../phases/18-document-content-creation/18-10-PLAN.md).
- [HTML renderer](../../packages/core/src/documentGen.ts), [agent/tool implementation](../../packages/backend/convex/llm.ts).
- [Office/HTML preview decision](../../docs/decisions/036-office-fidelity-pdf-twin-text-projection-xlsx-out.md).
- [Foundation model](../../packages/core/src/foundation.ts), [foundation publication](../../packages/backend/convex/foundation.ts), [Blueprint spine](../../packages/backend/convex/blueprint.ts).
- [Workflow registry](../../packages/core/src/workflowPacks.ts), [binding](../../packages/backend/convex/workflowPackBinding.ts), [tool grants](../../packages/core/src/toolGrants.ts), [vertical policy](../../packages/core/src/verticalPacks.ts).
- [Workflow playbook](../../docs/playbooks/workflow-packs.md), [vertical playbook](../../docs/playbooks/vertical-packs.md).
- [Marketing acceptance](../phases/31-marketing-surface-and-funnel-v0/31-VERIFICATION.md), [funnel implementation](../../packages/backend/convex/funnels.ts).
- [Billing boundary](../../docs/playbooks/billing.md), [Stripe read connector](../../docs/playbooks/connector-stripe.md).
- [Approved managed-services programme](../design/managed-services-programme.md), [capability inventory](../phases/48-readiness-and-qualification-closure/48-CAPABILITY-INVENTORY.md), [planned shared-service boundary](../phases/49-shared-managed-service-boundary/49-RESEARCH.md).
- [Standing-approval decision](../../docs/decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md).

### Recovered draft at 5d7b9e5a8e0acaecbdc110123718798565421b5c

- [PR 36](https://github.com/Mrjoel97/ProjectX/pull/36).
- [Public-web playbook](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/docs/playbooks/public-web-runtime.md).
- [Commerce playbook](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/docs/playbooks/tenant-commerce.md).
- [Website runtime verification](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/.planning/phases/48-business-website-and-landing-page-runtime/48-VERIFICATION.md).
- [Recipe verification](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/.planning/phases/49-qualified-public-web-and-storefront-recipes/49-VERIFICATION.md).
- [Upstream adaptation](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/.planning/phases/49-qualified-public-web-and-storefront-recipes/49-UPSTREAM-SKILL-ADAPTATION.md).
- [Runtime contracts](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/packages/contracts/src/webRuntime.ts), [recipe core](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/packages/core/src/webRecipes.ts), [recipe adapter and commerce gate](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/packages/backend/convex/webRecipes.ts), [project lifecycle](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/packages/backend/convex/webProjects.ts).
- [Merchant scope](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/.planning/phases/50-tenant-merchant-commerce/50-CONTEXT.md), [actual owner inputs](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/.planning/phases/50-tenant-merchant-commerce/50-06-OWNER-INPUTS-2026-09-24.md).
- [Pending merchant decision](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/docs/releases/phase-50-merchant-decision.md), [private order implementation](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/packages/backend/convex/tenantOrders.ts).
- [Closure wave map](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/.planning/phases/37.1-closure-programme-integration-and-wave-0-baseline/37.1-WAVE-MAP.md).
- [Website external re-entry](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/docs/releases/phase-48-wave7-reentry.md), [recipe hosted/production re-entry](https://github.com/Mrjoel97/ProjectX/blob/5d7b9e5a8e0acaecbdc110123718798565421b5c/docs/releases/phase-49-wave7-wave8-reentry.md).

Implementation approval is pending. This report changes no requirement verdict, accepted decision, phase completion or release authority.
