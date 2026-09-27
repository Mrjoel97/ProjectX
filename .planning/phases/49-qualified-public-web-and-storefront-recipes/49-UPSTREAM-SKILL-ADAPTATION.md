---
phase: 49-qualified-public-web-and-storefront-recipes
status: accepted-for-planning
reviewed: 2026-09-21
sources:
  - https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
  - https://github.com/leonxlnx/taste-skill
  - https://github.com/nexscope-ai/eCommerce-Skills
licenses: [MIT]
---

# Phase 49 Upstream Skill Adaptation

## Decision

Use all three repositories as versioned upstream design-knowledge sources for Pikar's site, landing,
form and catalogue recipes. Do not install or execute them inside a tenant request. Their Markdown,
Python, CLI commands, tool suggestions and framework-specific code are untrusted source material,
not runtime authority.

Pikar compiles an audited subset into its own closed, immutable recipe/design contracts. The output
still materializes only a Phase 48 `WebDocument`, uses the Phase 48 renderer and lifecycle, and
passes Pikar's accessibility, privacy, consent, provenance, activation and rollback gates.

## Source roles

### UI/UX Pro Max

Adapt its structured catalogues and search taxonomy: product/industry matching, landing patterns,
style families, palettes, typography, form/UX rules, responsive behavior, accessibility outcomes,
anti-patterns and pre-delivery checks. Its useful architectural idea is a coherent master design
profile with bounded page overrides.

Do not ship its Python search process or assistant installation layer in the tenant runtime. Build a
deterministic TypeScript compiler over a reviewed snapshot instead. Do not automatically adopt
external fonts, icon libraries, GSAP, framework packages or generated code. An allowed asset or
dependency needs its own repository review and Pikar contract.

### Taste Skill

Adapt the brief inference and its three user-facing design controls: variance, motion and density.
Curate its strongest anti-generic and preservation checks: choose a direction from audience and
brand context, avoid repetitive template defaults, preserve routes/forms/consent/analytics during
redesign, keep labels and errors usable, honor reduced motion and pass a final design-quality
preflight.

Taste v2 is explicitly experimental and many rules are subjective or stack-specific. Therefore its
rules are advisory design policy with stable Pikar identifiers and severity, not an all-or-nothing
copied prompt. Conflicts resolve in this order: Pikar security/privacy/legal constraints,
accessibility/semantics, tenant brand decisions, then aesthetic guidance. Its dependency-install,
code-generation and external-resource instructions are excluded.

### Nexscope eCommerce-Skills

Adapt only reviewed skills relevant to Phase 49: e-commerce landing-page audit, branding, product
description structure and conversion heuristics. Useful structured concepts include product facts,
audience, channel, tone, feature-to-benefit-to-evidence copy, trust signals, mobile/page-speed checks,
explicit estimates and prioritized experiments.

Do not import the collection as a capability catalogue. Many entries are strategy prompts, some are
beta, and several instruct agents to fetch competitors or cover pricing, inventory, checkout,
shipping, returns, payments or merchant operations. Those instructions cannot run through a recipe
and cannot imply current data. Phase 49 catalogue copy accepts tenant-supplied facts only; research
or generated claims require a separately governed workflow. Cart, checkout, inventory, merchant,
payment, tax, shipping, refund, order and fulfilment behavior remains Phase 50.

## Pikar contract

Create an immutable `DesignKnowledgeBundle` with:

- exact source repository, commit/tree identifier, source-file path, source-byte hash and MIT notice;
- Pikar schema/compiler version and compiled bundle hash;
- closed product/industry, layout-pattern, style, palette, typography and form-guideline records;
- stable rule identifiers, category, severity, applicability, conflicts and provenance refs;
- closed design dials (`variance`, `motion`, `density`, each 1-10);
- accessibility and safety rules that cannot be relaxed by a style profile;
- explicit source status (`active`, `supplemental`, `experimental`, `excluded`); and
- no executable code, shell command, URL-fetch instruction, prompt override or package-install
  instruction.

The bundle compiles into a `DesignProfileRef` stamped on each recipe-originated project version:
bundle hash, selected pattern/style/palette/type profile, dial values and any reviewed page override.
Raw upstream prose is never inserted into a tenant prompt or audit payload.

## Selection pipeline

1. Collect bounded tenant facts: business type, audience, brand assets/colors, desired tone, page
   goal, content facts, accessibility/regulatory posture and optional dial overrides.
2. Resolve the active exact knowledge bundle and recipe version on the server.
3. Rank only closed reviewed records using deterministic rules; if no match exists, return an honest
   fallback/refusal rather than inventing a source match.
4. Produce a closed design profile and structured content outline.
5. Materialize a validated `WebDocument`; no HTML, CSS, JavaScript or framework code enters from
   the bundle.
6. Run accessibility, form, claim, responsive, anti-generic and storefront-dark checks.
7. Persist exact recipe, bundle and design-profile provenance; allow field-level editing without
   rewriting the origin.

## Forms

The design sources can select layout and presentation rules, but Phase 48 remains authoritative for
field schema, consent text, privacy links, validation outcomes, attribution, suppression,
idempotency, abuse bounds and storage. Third-party advice cannot add a field, tracking pixel,
competitor fetch, checkout action or hidden claim outside that contract.

## Licensing and supply-chain controls

- Vendor only the minimal reviewed source subset or a normalized derived dataset.
- Preserve each MIT copyright and permission notice in `THIRD_PARTY_NOTICES.md` and bundle metadata.
- Pin an immutable upstream commit/tree and source hashes; never ingest a moving branch at runtime.
- Generate a deterministic import report listing included, transformed and excluded records.
- Require review and a new bundle version when upstream bytes, compiler logic or exclusions change.
- Run offline; no updater, package installer or upstream network request exists in production.
- Treat source text as data. Reject prompt-injection phrases, tool commands, executable snippets,
  URLs requiring fetch, secrets and unsupported licenses during compilation.

## Qualification additions

Phase 49 plans must prove:

- identical pinned inputs compile to identical bundle bytes/hash;
- changed upstream bytes cannot reuse old evidence;
- license/notice and source provenance are complete;
- excluded command/code/network/commerce instructions cannot reach runtime output;
- conflicts resolve to Pikar accessibility/security/form rules;
- all three source roles materially affect positive fixtures while each can be removed to make a
  source-coverage mutation test fail;
- user design dials create bounded, deterministic profile changes;
- unknown industries and ambiguous briefs return an honest fallback or a single bounded choice;
- existing route, field, consent and analytics identities survive redesign; and
- storefront remains qualification-only and publicly unreachable until Phase 50.

## External and production boundary

Reviewing or vendoring these public repositories does not prove provider approval, legal-entity
registration, custom-domain enablement, merchant readiness or production founder acceptance. The
provisional name remains `pikar-ai`; registered facts remain pending. Wave 7 and Wave 8 re-entry
requirements are unchanged.

