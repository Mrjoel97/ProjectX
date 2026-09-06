# Code Conventions

## Governing Sources

- Repository-wide rules live in `CLAUDE.md`; they are binding architecture and contribution guidance, not optional notes.
- Before changing `packages/backend/**`, read `packages/backend/AGENTS.md` and then `packages/backend/convex/_generated/ai/guidelines.md`.
- Subsystem invariants and verification commands live in `docs/playbooks/*.md`; watched path mappings are in `docs/playbooks/watch.json`.
- Accepted architecture decisions live in `docs/decisions/`; significant new decisions should add a new ADR rather than rewrite an accepted one.
- User-facing work must also follow `docs/design/BRAND.md` and reuse tokens from `apps/web/app/globals.css`.

## Formatting and Linting

- TypeScript/JavaScript is formatted by Biome according to `biome.json`: spaces, 2-space indentation, 100-column width, and double quotes.
- Generated Convex code, `.next`, and `dist` are excluded by `biome.json`; do not hand-edit or lint `packages/backend/convex/_generated/**`.
- Biome recommended lint rules are enabled. A repository-specific `noRestrictedImports` rule bans public raw Convex `query`, `mutation`, and `action` builders outside `packages/backend/convex/lib/functions.ts`.
- There is no root `lint` or `format` package script in `package.json`; use an explicit command such as `pnpm exec biome check .` when validating style.
- Python under `skillopt/` follows conventional four-space/PEP-style formatting, type annotations where useful, module docstrings, and `snake_case`; no Ruff, Black, Mypy, or Pytest configuration is committed.
- Comments are deliberately extensive around invariants, trust boundaries, live-vs-offline seams, and product decisions. Keep comments focused on why a constraint exists rather than narrating obvious syntax.
- Intentional simplifications use a `ponytail:` comment naming the current ceiling and an upgrade path; examples appear in `packages/core/src/businessProfile.ts` and `apps/web/playwright.config.ts`.

## Naming

- Source filenames use lower camel case for TypeScript modules, for example `packages/core/src/buildTelemetry.ts` and `packages/backend/convex/tenantProfile.ts`.
- React component files and exported components use PascalCase, for example `apps/web/app/(app)/dashboard/vault/PreviewModal.tsx` and `ErrorBoundary`.
- React hooks start with `use`, as in `apps/web/app/(app)/dashboard/voice/useVoiceSession.ts`.
- Functions, variables, and Convex exports use lower camel case: `deriveTier`, `tenantMutation`, `writeTerminal`, and `vaultGroundHydrated`.
- Types and interfaces use PascalCase: `Result`, `BusinessProfile`, `VoiceSession`, `FailureCopy`, and `RoutingDecision`.
- Constants and closed value sets use `UPPER_SNAKE_CASE`, such as `PERSONAS`, `TIER_REASON`, `MIME_ALLOWLIST`, and `VAULT_EXTRACT_CHAR_CAP`.
- Tests are colocated as `<module>.test.ts`; Playwright behavior specs use descriptive kebab-case names such as `apps/web/e2e/cockpit-attachment.spec.ts`.
- Convex index names describe every indexed field in order (`by_field1_and_field2`); schema and query code must remain aligned.
- Event names are dotted strings such as `vault.extracted`, `mailbox.searched`, and `plan.canceled`; failure reasons are stable `snake_case` codes such as `pii_scan_failed`.

## Module and Component Structure

- Domain logic belongs in framework-neutral packages under `packages/*`; `packages/backend/convex/**` should remain a thin persistence/orchestration adapter.
- Each package exposes a barrel at `src/index.ts` plus subpath exports through its `package.json`, as demonstrated by `packages/core/package.json` and `packages/vault/package.json`.
- Pure modules are generally paired directly with tests, for example `packages/pii/src/scan.ts` and `packages/pii/src/scan.test.ts`.
- Convex file routing defines API namespaces: an export in `packages/backend/convex/vault.ts` is referenced through `api.vault.*` or `internal.vault.*`.
- Shared tenant-aware Convex builders live only in `packages/backend/convex/lib/functions.ts`; authenticated public reads/writes/actions use `tenantQuery`, `tenantMutation`, and `tenantAction`.
- Internal workflow functions may use `internalQuery`, `internalMutation`, or `internalAction` because durable jobs carry explicit tenant IDs rather than browser identity.
- Node-runtime Convex actions are isolated in files with `"use node";`; files exporting queries or mutations must not also opt into the Node runtime.
- Next.js uses App Router route groups: public auth pages are under `apps/web/app/(auth)`, authenticated pages under `apps/web/app/(app)`, and route-local UI helpers sit beside the owning page.
- Add `"use client"` only to components/hooks that need browser state, effects, events, or Convex React hooks; `apps/web/app/layout.tsx` remains a server component while `apps/web/app/providers.tsx` is the client provider boundary.
- Large features are composed from route-local components and hooks, although several current files are very large (`packages/backend/convex/llm.ts`, `apps/web/app/(app)/dashboard/workspace/cards.tsx`); prefer extending existing seams over adding parallel abstractions.

## Type and Validation Practices

- `tsconfig.base.json` enables strict mode, `isolatedModules`, `noUncheckedIndexedAccess`, and casing enforcement; all workspace TypeScript configs extend it except the Convex-generated environment-specific config.
- Prefer inferred literal unions from `as const`, for example `Persona = (typeof PERSONAS)[number]` in `packages/core/src/businessProfile.ts`.
- Use `satisfies` for exhaustiveness without widening, as in `TIER_REASON satisfies Record<Tier, string>`.
- Use discriminated unions for expected outcomes. `packages/core/src/result.ts` defines `Result<T,E>` and `packages/contracts/src/routing.ts` returns an explicit parse success/failure instead of silently defaulting.
- Validate untrusted structured input at boundaries. Contracts use Zod (`routingSchema.safeParse`), while every Convex function defines `args` with `v.*` validators.
- Use branded/derived types for security-sensitive strings, such as `SafeText` in `packages/pii/src/scan.ts`.
- Use Convex `Id<"table">`, `Doc<"table">`, and generated `FunctionArgs` instead of plain strings or `any`; `useVoiceSession.ts` derives client ID types from generated API argument types.
- Avoid `any` for contexts and application data. Local casts are used only at known framework seams and should be explained.
- `undefined` is not a Convex value; return/store `null` or omit optional object fields as dictated by the schema.
- Environment variables are read at explicit boundaries, such as `NEXT_PUBLIC_CONVEX_URL` in `apps/web/app/providers.tsx`; secrets must stay server-side and browser voice code receives only ephemeral credentials.

## State and Data Patterns

- React local UI state uses `useState`, lifecycle synchronization uses `useEffect`, and mutable protocol/session state uses `useRef`; the full WebRTC lifecycle is encapsulated by `useVoiceSession.ts`.
- Remote UI state uses reactive Convex `useQuery`, `useMutation`, and `useAction`; `undefined` consistently means loading, while `null` or an empty collection represents a resolved empty state.
- Authentication is composed at the root by `ConvexAuthNextjsServerProvider` in `apps/web/app/layout.tsx` and `ConvexAuthNextjsProvider` in `apps/web/app/providers.tsx`.
- Authenticated children mount only inside `<Authenticated>` in `apps/web/app/(app)/layout.tsx`, so tenant-scoped queries do not run before a client token exists.
- Durable multi-step work uses Convex workflow/scheduler components; state transitions and terminal rows are designed to be idempotent, for example `writeTerminal` in `packages/backend/convex/telemetry.ts`.
- Database queries should use named indexes, bounded `.take()`/pagination, and `.unique()` for uniqueness; avoid unbounded `.collect()` in production paths.
- High-churn, append-only, and stable data are separated by table purpose in `packages/backend/convex/schema.ts`.
- Deterministic serialization is preferred for persisted projections; `serializeProfile` in `packages/core/src/businessProfile.ts` deliberately produces byte-identical markdown.

## Errors, Logging, and Security

- Expected domain failures return explicit results; unexpected invariant failures throw at the adapter/boundary. `scanText` fails closed, while `unwrap` is reserved for controlled boundaries.
- Governed stops are stable returned reason codes, not generic exceptions; callers distinguish business stops such as `kill_switch` from programmer/data errors.
- User-facing components map backend reason codes to safe actionable copy in `apps/web/app/(app)/dashboard/vault/failureCopy.ts`; raw SDK errors are not shown verbatim.
- Nonessential UI may degrade behind a local error boundary; `apps/web/app/(app)/dashboard/workspace/ErrorBoundary.tsx` logs the error and renders a scoped fallback.
- Structured logging uses single-line JSON via `createLogger` in `packages/core/src/logger.ts`; fields must contain only IDs, refs, hashes, counts, and other redaction-safe metadata.
- `audit.payload`, dead-letter payloads, telemetry, and logs must never contain raw user content or PII. Redact before writing, then test the absence of raw needles.
- The audit module is insert-only. `packages/backend/convex/audit.ts` is the sole write surface and must not gain patch/replace/delete behavior.
- Authentication/authorization is derived server-side; clients must never supply a user ID for authorization. Public tenant functions derive scope through `packages/backend/convex/lib/functions.ts`.
- Model prompts are loaded from the versioned skill registry, never hardcoded into agent source.
- Public Convex functions are internet-exposed; sensitive operations remain internal and carry explicit validated arguments.
- File, mail, model, and tool boundaries use allowlists, caps, hashes, and fail-closed checks; security invariants are often reinforced with static source-scan tests.

## Contribution and Build Conventions

- The workspace uses pnpm 10 and Node 20+ (`package.json`), with Turbo coordinating `dev`, `build`, `typecheck`, and `test`.
- Clean-clone order is `pnpm install`, create/start the Convex deployment, generate `packages/backend/convex/_generated/**`, then run typecheck/dev; `scripts/boot-check.mjs` automates install → codegen → typecheck after deployment setup.
- Pinned pre-1.0 Convex component versions in `packages/backend/package.json` must not be casually bumped; review changelogs and rerun boot, type, unit, smoke, and relevant E2E gates.
- Reuse existing helpers and installed dependencies before adding an abstraction or package; `CLAUDE.md` calls this “ponytail discipline.”
- A change to a watched subsystem must update its playbook and “Last verified” marker in the same contribution; `scripts/check-playbooks.mjs` enforces coverage of changed/new code.
- New nontrivial logic should leave a runnable check, normally a focused colocated test; pure package logic is preferred because it is cheap to test.
- Verify proportionally: run the narrow package/test first, then `pnpm typecheck`, relevant smoke/E2E gates, and `pnpm test` when the environment can support the full suite.
- Do not commit local secrets, generated auth state (`apps/web/e2e/.auth/user.json`), Convex generated output, `.next`, coverage output, or live evaluation exports.
