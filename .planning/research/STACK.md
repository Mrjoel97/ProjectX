# Stack Research — Pikar v2.0 Platform milestone

**Domain:** Governed agentic operating layer (chief-of-staff), adding platform breadth to a shipped Convex/TS app
**Researched:** 2026-07-24
**Confidence:** HIGH (all versions verified live against the npm registry; integration patterns read from the actual code — `gmail.ts`, `llm.ts` tool-loop, `routing.ts`, skills registry). MEDIUM only on the Pikar-Ai MCP's OAuth specifics (remote connector, not inspectable from the repo — flagged below).

> **Reading note for the roadmap author.** This milestone is *breadth on an existing spine*, so the headline is how little needs adding. The existing stack (TS monorepo, Convex + pinned pre-1.0 components, `ai@7.0.20` + `@ai-sdk/openai@4.0.11` → OpenAI direct, Convex Auth, `@convex-dev/agent@0.6.4`, RAG/vault, Gmail via raw `fetch`) stays as-is. Six of the seven new capabilities need **zero or one** new runtime dependency. The two real dependency decisions are: an **MCP client** for the media service and **MSAL** for Microsoft Graph auth. Everything else is a new pure-TS `packages/*` module + a thin `convex/` adapter reusing what is already installed.

---

## The one pattern everything reuses

The codebase already has the exact seam every new external tool needs — **`gmail.ts`**: a `"use node"` `internalAction` that calls a REST API with raw `fetch`, refreshes OAuth tokens through one shared root (`freshAccessToken`), returns a **discriminated result** (never throws on a dead token → routes to a governed reauth state), and is driven by `@convex-dev/action-retrier` for retries/dead-letter. Calendar, Contacts, People, and Microsoft Graph all follow this precedent. **Rung 2 of the ponytail ladder (reuse what's here) covers most of this milestone.**

Governed agent tools already have a pattern too — **`buildCockpitTools()` in `llm.ts`**: each tool wraps a primitive, preserves its cost/PII/audit governance, and is handed to `ai`'s `generateText({ tools, stopWhen: stepCountIs(8) })`. New action tools and sub-agents extend this object; they do not invent a new mechanism.

---

## Recommended Stack — per new capability

### 1. Business-evaluation engine — **NO new dependencies**

Pure-TS `packages/evaluation` (assessment scoring + gap detection) + a thin `convex/` adapter. It is LLM analysis grounded on the vault, structured by a skill, scored by domain code.

| Piece | Uses (already installed) | Integration |
|-------|--------------------------|-------------|
| Structured assessment/gap output | `ai@7.0.20` + `@ai-sdk/openai@4.0.11`, `generateObject` + `zod@4` schema | New skill rows (`business-evaluator`, `gap-detector`) in the `skills` table — CLAUDE.md §5, no hardcoded prompts |
| Grounding on the business profile | existing `vaultGround.ts` hybrid retrieval (the review specifically noted this was built but unreached — wire it) | pass retrieved context into the eval prompt |
| Scheduled proactive **in-app** review | **Convex cron** (`crons.ts`, native) → `@convex-dev/workpool@0.4.8` for per-tenant fan-out | writes an in-app notification/briefing, never auto-sends |
| Scoring / gap math | plain TS in `packages/evaluation` with one assert-based self-check | testable without Convex (CLAUDE.md §1) |

**Do NOT add:** a rules engine (json-rules-engine, etc.), a BPMN runtime, or an analytics SaaS. Evaluation is LLM + a scoring function + the vault; a rules DSL is unrequested abstraction.

---

### 2. Real sub-agent dispatch — **NO new runtime dependency** (promote one devDep)

Make the `routing.ts` `sub_agent` enum real. Today the pipeline dead-letters it (`routing.ts` L10-11). A sub-agent is just **another governed `generateText` loop** with its own skill and its own scoped tool subset, invoked as a Convex action and orchestrated durably.

| Concern | Use (already present) | Note |
|---------|----------------------|------|
| Sub-agent = nested governed loop | the existing `runAgentLoop` / `buildCockpitTools` pattern in `llm.ts` | each sub-agent loads its own skill row; keep cost/PII/audit wrapping per call |
| Durable dispatch / multi-step orchestration | `@convex-dev/workflow@0.4.4` (installed, pinned) | survives restarts; already the pipeline's backbone |
| Bounded parallel fan-out to sub-agents | `@convex-dev/workpool@0.4.7` → **promote from `devDependencies` to `dependencies`** | it's currently dev-only; runtime dispatch needs it as a dep |
| First exemplar sub-agent | one new skill + a scoped tool set | ship one real specialist (e.g. the research sub-agent from #3) to prove the seam |

`@convex-dev/agent@0.6.4` is already installed and **is** the latest published version — it provides threads/messages/sub-agent primitives if you prefer its abstraction over hand-rolled nested loops. Pick one; do not run both mechanisms.

**Do NOT add:** LangChain, LangGraph, CrewAI, AutoGen, or any Python agent framework. They duplicate what `generateText` + `@convex-dev/workflow` already do durably, drag heavy abstractions across the `packages/*` portability line, and bypass the `tenantQuery/Mutation/Action` governance wrappers (CLAUDE.md §2). The tool-loop + Convex workflow *is* the orchestration engine.

---

### 3. Non-email action tools

**Calendar (Google + Microsoft)** — **NO new dependency.**
- Google Calendar API v3 via raw `fetch`, reusing the existing Google OAuth token root (`freshAccessToken` in `gmail.ts`); add the `https://www.googleapis.com/auth/calendar.events` scope. This is an *incremental scope*, not a new consent stack.
- Microsoft calendar rides the Graph adapter from capability #7 (`/me/events`, `/me/calendar/getSchedule`).

**Web research / browsing** — **add ONE search+extract API client.**

| Recommended | Version | Why |
|-------------|---------|-----|
| **Tavily** (`@tavily/core`) | `0.7.6` | Purpose-built for LLM/agent research: one call returns ranked results **plus cleaned page content and an optional synthesized answer**, so the agent doesn't fetch-and-strip HTML itself. Reachable via raw `fetch` (it's a plain REST API — you can skip even the SDK). Wrap as a governed cockpit tool. |

Integration: a `webResearch` tool in the tool-loop that calls Tavily server-side from a `"use node"` action, PII-scans results before they enter context, and records refs/hashes only in audit (CLAUDE.md §4).

**Do NOT add for web:** a headless browser at runtime (Playwright/Puppeteer) — Playwright is a **dev-only e2e** dep and must stay that way; full browser automation in the product is brittle, slow, and a large security/SSRF surface. Tavily/Exa/Firecrawl do fetch+extract server-side. Also do not wire the dev-only Brave wrapper in `gsd-tools.cjs` into the product; it's a build-time convenience, not a per-tenant runtime capability.

**Document / content creation** — **NO new dependency for v2.0 (defer `docx`).**
- Text/markdown content = LLM + a skill; no dep.
- PDF output already exists: `markdownToPdf()` in `llm.ts` on `pdf-lib@1.17.1`; extraction on `unpdf@1.6.2`. Reuse both.
- Editable Word output: `docx@9.7.1` is the clean pure-JS choice **only if** users demand `.docx`. Defer until a Validated line asks for it — PDF covers the delivery story today (YAGNI, ladder rung 1).

**Do NOT add for docs:** a LibreOffice/Gotenberg/headless-Chrome PDF sidecar (a whole deployment plane for what `pdf-lib` already renders).

**Contacts / CRM / follow-ups** — **NO new dependency.**
- A tenant-scoped **`contacts` Convex table** (native) is the CRM. It composes directly with the `resolveContacts` tool the cockpit already has.
- Follow-ups = the **Convex scheduler** (native `ctx.scheduler` / crons) — the same mechanism deferred-send already uses.
- Optional one-way import from Google People API or MS Graph `/me/contacts` via raw `fetch` (reuse OAuth) when a user wants to seed contacts.

**Do NOT add for CRM:** a Salesforce/HubSpot SDK or an external CRM integration. The minimal contacts table + scheduler is the lazy solution that fully covers the solopreneur follow-up story.

---

### 4. Media canvas (images + video ≤3 min) — **add an MCP client; the Pikar-Ai MCP IS the media backend**

The connected **Pikar-Ai** service (a claude.ai remote OAuth connector, Higgsfield-backed) exposes `generate_image` / `generate_video` / `generate_audio` / `generate_3d` / `upscale_*` / `outpaint_image` / `reframe` / `remove_background` / `motion_control` / `virality_predictor` and a `models_explore(action:'recommend')` chooser. The mandate is to **call it, not rebuild generation.** The app backend must connect to it as an MCP client over Streamable HTTP.

**`ai@7.0.20` does NOT ship an MCP client** (verified: the installed `dist/index.d.ts` has no `createMCPClient` export — MCP moved to a separate package in later `ai` builds). So a client dep is genuinely required:

| Recommended | Version | Why |
|-------------|---------|-----|
| **`@modelcontextprotocol/sdk`** | `1.29.0` | Official client. `StreamableHTTPClientTransport` + built-in OAuth helpers fit a **remote OAuth-gated** connector, and the media flow runs **outside** the `generateText` loop (see below) so we don't need SDK-native `tools()` wiring. Node ≥18. |

Alternative: **`@ai-sdk/mcp@2.0.16`** (peers `zod ^4.1.8`, compatible with the repo's `zod@4.4.3`) — its `.tools()` plugs straight into `generateText`. Choose this **only if** you decide to expose generation as inline agent tools rather than async jobs.

**CRITICAL architecture — media is an async job, not a sync tool call.** Video up to 3 minutes takes far longer than the cockpit loop's `CALL_TIMEOUT_MS` / `stepCountIs(8)` budget. Do NOT call `generate_video` synchronously inside `runAgentLoop`. Pattern (mirrors deferred-send + the retrier discipline already in the codebase):

```
agent tool `createMedia` → submit job to Pikar-Ai MCP → store {jobRef, status:'running'} in a mediaJobs table
   → @convex-dev/workpool@0.4.8 worker polls (or receives webhook) via @convex-dev/action-retrier
   → on completion: pull the asset, ctx.storage.store(), surface in the vault/canvas + notify
```

Auth: store the Pikar-Ai/Higgsfield OAuth token in the **Convex secrets plane** (env, per README secrets rules) and refresh it exactly like `gmail.ts` does for Google. **[MEDIUM confidence: the connector's precise OAuth flow / whether a machine token or REST fallback exists could not be inspected from the repo — a spike to confirm the transport + token exchange is the first task of this capability.]**

**Do NOT add:** Higgsfield/Replicate/fal.ai/Runway SDKs, `ffmpeg`, or any model-hosting/inference dep — that *is* rebuilding the generation the MCP already provides, and splinters the "one media backend" story. No new frontend canvas/component library either (CLAUDE.md §10 — build on `globals.css`, don't add a UI kit without asking).

---

### 5. Dynamic / self-authored skills — **NO new dependency**

The machinery exists: the `skills` table (`name`, `version`, `body`, `status`), the seed/publish path, versioning + rollback, the audit spine, and SkillOpt's held-out-validation loop for the eval gate. Self-authoring is a **governance flow over existing tables**, not new tech.

| Piece | Uses | Note |
|-------|------|------|
| User-authored skill | new governed mutation writing a `draft` skill row → `published` via the existing status lifecycle | zod-validate the body at the trust boundary (installed) |
| Agent-authored skill (late, governance-heavy) | same write path behind owner-approval + a SkillOpt eval gate | the `requireOwner` primitive from the governance phase gates the self-modification write |
| Rollback / provenance | existing skill versioning + append-only `audit` | no new store |

**Do NOT add:** a plugin sandbox/VM, or an external prompt-management SaaS (Langfuse, PromptLayer, Humanloop). The Convex skills registry + audit + SkillOpt is already the system of record; a second one is duplicate infrastructure and a second PII/governance surface.

---

### 6. ISO 9001:2015 QMS tooling for software — **NO runtime dependency (mostly docs + native tables)**

This is process formalization, not a library. The QMS bones already exist and map onto the standard:

| ISO 9001:2015 clause | Existing mechanism |
|----------------------|--------------------|
| 7.5 Documented information / doc control | `docs/playbooks/` + immutable `docs/decisions/` ADRs + git + the Stop-hook enforcement (CLAUDE.md §9) |
| 8.5.6 Control of changes | skill versioning + GSD phase/plan records + ADR supersession |
| 7.1.5 / 9.1 Monitoring & measurement | existing `telemetry` + `audit` (append-only, WORM export) tables |
| 8.7 / 10.2 Nonconformity & corrective action (CAPA) | **add a tenant-scoped `nonconformities`/`capa` Convex table** (native) + a management-review report query over `audit`/`telemetry` |
| 9.3 Management review | a Convex query aggregating audit/telemetry/eval outcomes into a review record |

So the only "build" is a small native table + a couple of report queries; everything else is writing controlled documents against the existing spine.

**Do NOT add:** an ISO/QMS SaaS platform or a document-management system. For a solo product, git + ADRs + the audit spine already satisfy document and record control; a QMS SaaS is cost and a second source of truth.

---

### 7. Microsoft Graph / Outlook (second email provider, DLVR-02) — **add MSAL; keep API calls on raw `fetch`**

Phase 9 context (`09-CONTEXT.md`) already specs this: delegated `Mail.Send` + read scopes on the `/common` tenant, **full parity** (send + read plane), **connect-both-choose-per-send** provider model, behind a provider-abstraction seam. Clean de-scope lever: Outlook **send-only** for beta.

| Piece | Recommended | Version | Why |
|-------|-------------|---------|-----|
| Graph OAuth (auth-code + refresh, token cache, consent quirks) | **`@azure/msal-node`** | `5.4.2` | Graph's token/refresh/consent model differs enough from Google's that hand-rolling it at the security boundary is the *wrong* place to be lazy (the ponytail "not lazy about security" carve-out). MSAL handles refresh + cache correctly. Node ≥20 ✓. |
| Graph REST calls (`/me/sendMail`, `/me/messages`, `/me/events`) | **raw `fetch`** (no SDK) | — | Follows the `gmail.ts` precedent exactly. |
| Provider abstraction seam | new **`packages/delivery`** pure-TS `Provider` interface `{ send, search, listInbox, fetchInboxBodies, getReplyTarget }` | — | `gmail` + `graph` adapters in `convex/`; `deliverApprovedPlan` picks per send. This is the seam `09-CONTEXT.md` L116-118 flagged as the open shape question — resolve it toward a `packages/delivery` package (CLAUDE.md §1). |

**Do NOT add:** `@microsoft/microsoft-graph-client` (v3.0.7). It is a thin `fetch` wrapper with its own auth-provider abstraction; the repo's precedent is raw `fetch`, the version is stale (3.x, long unmaintained relative to Graph's cadence), and it adds a dependency for endpoints you call in one line. Also do NOT adopt a unified-email SaaS (Nylas, etc.) — it inserts a third-party processor into a restricted-scope data path (the CASA/zero-retention surface).

---

## Installation (only the genuinely-new deps)

```bash
# @pikar/backend — media MCP client + Microsoft Graph auth
pnpm --filter @pikar/backend add @modelcontextprotocol/sdk@1.29.0 @azure/msal-node@5.4.2

# @pikar/backend — web research (or skip the SDK and raw-fetch Tavily's REST API)
pnpm --filter @pikar/backend add @tavily/core@0.7.6

# Promote existing devDep → dep (runtime sub-agent/media-job fan-out)
pnpm --filter @pikar/backend add @convex-dev/workpool@0.4.7

# DEFERRED until a Validated line requires editable Word output:
# pnpm --filter @pikar/backend add docx@9.7.1
```

Everything else (business-evaluation, sub-agent dispatch, calendar via Google, contacts table, self-authored skills, QMS tables) adds **no** package — new `packages/*` modules + thin `convex/` adapters over already-installed deps.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@modelcontextprotocol/sdk` 1.29.0 (media MCP client) | `@ai-sdk/mcp` 2.0.16 | If you expose generation as **inline** agent tools inside `generateText` rather than async jobs — its `.tools()` wires straight in. (Not the default: video ≤3min must be async.) |
| Tavily `@tavily/core` 0.7.6 (web research) | Exa (`exa-js` 2.16.0) — neural/semantic search; Firecrawl (`@mendable/firecrawl-js` 4.30.1) — deep crawl/scrape | Exa for research-discovery/semantic recall; Firecrawl when you need to crawl a whole site or convert pages to markdown at scale |
| MSAL + raw `fetch` (Graph) | `@microsoft/microsoft-graph-client` 3.0.7 | Only if you want typed request builders and accept the extra dep + its own auth abstraction — not worth it here |
| Nested `generateText` loop + `@convex-dev/workflow` (sub-agents) | `@convex-dev/agent` 0.6.4 thread/sub-agent primitives (already installed) | If you prefer its managed threads/messages abstraction over hand-rolled loops — pick one, not both |
| `contacts` Convex table (CRM) | Google People / MS Graph contacts sync | When a user wants to seed from an existing address book (one-way import, raw fetch) |
| PDF via existing `pdf-lib` | `docx` 9.7.1 | Only when users need **editable** `.docx`, confirmed by a Validated line |

---

## What NOT to Use (consolidated)

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| LangChain / LangGraph / CrewAI / AutoGen | Duplicate `generateText` + Convex workflow; heavy abstractions; bypass tenant-wrapper governance; break `packages/*` portability | Nested governed loop + `@convex-dev/workflow` (+ `@convex-dev/agent` if you want threads) |
| Higgsfield/Replicate/fal.ai/Runway SDKs, `ffmpeg`, model hosting | Rebuilds the generation the Pikar-Ai MCP already provides; splinters the media backend | The connected Pikar-Ai MCP via `@modelcontextprotocol/sdk` |
| Playwright/Puppeteer at runtime | Brittle, slow, SSRF/security surface; Playwright is dev-only e2e here | Tavily/Exa/Firecrawl server-side fetch+extract |
| `@microsoft/microsoft-graph-client` | Stale thin wrapper + own auth abstraction; repo precedent is raw fetch | MSAL (auth) + raw `fetch` (calls) |
| Unified-email SaaS (Nylas etc.) | Inserts a third-party processor into restricted-scope data (CASA/zero-retention surface) | Direct Gmail + Graph adapters behind `packages/delivery` |
| External prompt-mgmt SaaS (Langfuse/PromptLayer) | Duplicates the skills registry + audit; second PII/governance surface | Existing `skills` table + SkillOpt + `audit` |
| Rules-engine / BPMN runtime (evaluation) | Unrequested abstraction; the spec explicitly dropped UiPath/BPMN-as-runtime | LLM + a scoring function in `packages/evaluation` + the vault |
| ISO/QMS SaaS or DMS | Cost + second source of truth for a solo product | Playbooks/ADRs/git + audit spine + a `nonconformities` table |
| LibreOffice/Gotenberg/headless-Chrome PDF sidecar | A deployment plane for what `pdf-lib` already renders | Existing `markdownToPdf()` |
| Bumping pinned pre-1.0 Convex components | CLAUDE.md §6 — API churn; requires changelog read + full boot check | Keep exact pins; only `@convex-dev/workpool` moves devDep→dep at its **current** 0.4.7 |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@1.29.0` | Node ≥20 (repo engines `>=20`) ✓ | StreamableHTTP transport for the remote Pikar-Ai connector |
| `@ai-sdk/mcp@2.0.16` | `zod ^3.25.76 \|\| ^4.1.8` → repo `zod@4.4.3` ✓ | only if inline-tool path chosen |
| `@azure/msal-node@5.4.2` | Node ≥20 ✓ | delegated auth-code + refresh for Graph |
| `@tavily/core@0.7.6` | Node ≥18 ✓ | or skip the SDK and raw-fetch the REST API |
| `@convex-dev/workpool@0.4.7→0.4.8` | matches installed Convex `1.42.1` component set | promote devDep→dep; keep exact pin per §6 |
| `docx@9.7.1` (deferred) | pure JS, no native build | no `onlyBuiltDependencies` entry needed |
| **Unchanged, keep as-is** | `ai@7.0.20`, `@ai-sdk/openai@4.0.11`, `@convex-dev/agent@0.6.4` (already latest), all pinned Convex components, Convex Auth `0.0.94` | do NOT bump casually (§6) |

---

## Sources

- **Live npm registry** (`npm view … version`, 2026-07-24) — HIGH: `ai@7.0.37` latest / `@ai-sdk/openai@4.0.20` latest / `@microsoft/microsoft-graph-client@3.0.7` (stale) / `@azure/msal-node@5.4.2` / `@modelcontextprotocol/sdk@1.29.0` / `@ai-sdk/mcp@2.0.16` / `@tavily/core@0.7.6` / `exa-js@2.16.0` / `@mendable/firecrawl-js@4.30.1` / `docx@9.7.1` / `ical-generator@11.0.0` / `googleapis@173.0.0` / `@convex-dev/agent@0.6.4` (=installed, is latest) / `@convex-dev/workpool@0.4.8`.
- **Installed `ai@7.0.20` `dist/index.d.ts`** inspected — HIGH: confirms **no** `createMCPClient`/`MCPClient` export, so an MCP client is a genuine addition (not reuse).
- **AI SDK docs — MCP client** (`ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client`) — HIGH: `createMCPClient` + `sse`/`http` transports; `.tools()` → `generateText`.
- **Repo code read** — HIGH: `gmail.ts` (raw-fetch + `freshAccessToken` OAuth refresh + discriminated result + retrier), `llm.ts` (`buildCockpitTools` / `runAgentLoop` / `generateText({ tools, stopWhen: stepCountIs(8) })`), `routing.ts` (`sub_agent` enum unimplemented → dead-lettered), `package.json` files (installed versions).
- **`.planning/phases/09-private-beta-productionization/09-CONTEXT.md`** — HIGH: DLVR-02 already scoped (delegated `Mail.Send` + `/common`, full parity, connect-both/choose-per-send, provider-abstraction seam, send-only de-scope lever).
- **Pikar-Ai MCP server instructions** (this session's connector) — MEDIUM: tool surface (`generate_image/video/audio/3d`, `upscale_*`, `outpaint`, `reframe`, `remove_background`, `motion_control`, `virality_predictor`, `models_explore`); **its OAuth/token exchange for backend (non-Claude) callers is unverified — spike first.**

---
*Stack research for: Pikar v2.0 — platform breadth on a governed Convex/TS agent app*
*Researched: 2026-07-24*
