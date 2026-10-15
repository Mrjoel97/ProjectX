import { pageReadFeeUsd, RESEARCH_MODEL, searchFeeUsd } from "@pikar/cost";
import {
  goldenTavilyBilling,
  goldenTavilyExtractRequest,
  goldenTavilyObservedCredits,
  goldenTavilyObservedUsd,
  goldenTavilySearchRequest,
} from "@pikar/cost/goldenProviderBudget";
import { scanText } from "@pikar/pii";
import { jsonSchema, type ToolSet, tool } from "ai";
import type { GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

const CALL_TIMEOUT_MS = 45_000;

/** One retrieved web result. `snippet` is Tavily's extracted page text, NOT model prose. */
export type WebResult = { url: string; title: string; snippet: string };

/** How many results one search returns to the model. Small on purpose: each snippet is ~1.4k chars
 *  and they all ride `inputTokens` on the NEXT step, so this is the main lever on research cost. */
export const WEB_RESULTS_PER_SEARCH = 5;

/**
 * The relevance floor a Tavily result must clear to count as EVIDENCE.
 *
 * **MEASURED, not guessed (2026-08-07).** Real research queries and the deliberately-invented entity
 * from fixture 33 separate cleanly on Tavily's own `score`:
 *   real (fixture 32, two queries):  0.8145 0.8052 0.7879 0.7730 0.7376 / 0.7409 … 0.6022
 *   invented (fixture 33):           exact-name searches return NOTHING AT ALL (n=0); only a loose
 *                                    query mixing real words returns anything, topping out at 0.5100
 *                                    before a cliff to 0.0962, 0.0466, 0.0446, 0.0409.
 * 0.55 sits in the gap: above every near-miss, below every genuine result.
 *
 * WHY A FLOOR IS NEEDED AT ALL, given exact-name searches already return zero. `sources` is
 * AGGREGATED ACROSS EVERY SEARCH IN A RUN, and the specialist is instructed to search once per
 * sub-question. One loose sub-question drags near-misses into the aggregate, and the honesty verdict
 * (`declaredQuestionScope && sources.length === 0`) then can never fire — a run that found nothing
 * reports itself as sourced. The hosted OpenAI search never exposed this because it returned no
 * sources for an unanswerable query; that property has to be reconstructed here.
 *
 * ponytail: one flat threshold. The margin (0.51 → 0.60) is real but THIN and rests on five sampled
 * queries — fixtures 32 and 33 are its regression test, and they pull in opposite directions, which
 * is what makes them a calibration set rather than two unrelated cases. If a genuine result ever
 * lands below this, prefer raising `max_results` or splitting the query over lowering the floor.
 */
export const WEB_RESULT_MIN_SCORE = 0.55;

/**
 * Map Tavily's `/search` response to our result shape. Pure and exported for the offline test —
 * the network half is untestable without a key, this half is where the mistakes live.
 *
 * Two things are DROPPED rather than passed through, both because a source list is the evidence half
 * of the research verdict: anything without a parseable absolute URL (the reader cannot open it), and
 * anything below `WEB_RESULT_MIN_SCORE` (a near-miss is not evidence, however topical it looks).
 */
export const parseWebResults = (payload: unknown): WebResult[] => {
  const rows = (payload as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const out: WebResult[] = [];
  for (const r of rows) {
    const url = (r as { url?: unknown })?.url;
    if (typeof url !== "string") continue;
    try {
      new URL(url); // absolute + parseable, or it is not a citation
    } catch {
      continue;
    }
    // A MISSING score is kept, deliberately: absence means the provider did not rank this response,
    // and silently discarding everything would turn a provider change into an empty evidence list —
    // the same silent-zero failure this whole path is built to avoid. Only an EXPLICIT low score
    // drops a row.
    const score = (r as { score?: unknown })?.score;
    if (typeof score === "number" && score < WEB_RESULT_MIN_SCORE) continue;
    out.push({
      url,
      title: String((r as { title?: unknown })?.title ?? ""),
      snippet: String((r as { content?: unknown })?.content ?? ""),
    });
  }
  return out;
};

/** Phase 39 (RSCH-01): how many pages one research run may READ. Each read is a step and ~6k chars
 *  of input on every later step, so this is the second cost lever beside `WEB_RESULTS_PER_SEARCH`. */
export const PAGE_READS_PER_RUN = 6;
/** The char cap on one read page. `/extract` with a `query` returns the top-ranked chunks joined by
 *  `[...]`, so the cap trims the tail of an already-focused excerpt, not the middle of an argument. */
export const PAGE_READ_CHARS = 6000;

/** Tavily `/extract`'s response, reduced to the one page asked for. Exported for the unit test. */
export const parseExtractResult = (
  payload: unknown,
  url: string,
): { content: string; truncated: boolean } | { error: string } => {
  const p = payload as {
    results?: { url?: unknown; raw_content?: unknown }[];
    failed_results?: { url?: unknown; error?: unknown }[];
  };
  const hit = Array.isArray(p?.results)
    ? p.results.find((r) => r?.url === url && typeof r?.raw_content === "string")
    : undefined;
  if (hit) {
    const raw = hit.raw_content as string;
    return { content: raw.slice(0, PAGE_READ_CHARS), truncated: raw.length > PAGE_READ_CHARS };
  }
  const failed = Array.isArray(p?.failed_results)
    ? p.failed_results.find((r) => r?.url === url)
    : undefined;
  return { error: String(failed?.error ?? "no content returned for that page") };
};

/**
 * The sources carried by ONE `webResearch` tool-result part.
 *
 * Separate from `parseWebResults` because the shapes differ and conflating them hid a latent bug:
 * the API response calls the text `content` while our own tool output calls it `snippet`, and the
 * stored output has no `score` at all (already filtered at execute time). Re-running the API parser
 * over our own output happened to work only because the call site reads url/title — one field rename
 * away from silently emptying every source list.
 */
export const sourcesFromToolOutput = (output: unknown): { url: string; title: string }[] => {
  const rows = (output as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  const out: { url: string; title: string }[] = [];
  for (const r of rows) {
    const url = (r as { url?: unknown })?.url;
    if (typeof url !== "string") continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    out.push({ url, title: String((r as { title?: unknown })?.title ?? "") });
  }
  return out;
};

/**
 * ACTN-03. The web-research tool record.
 *
 * **LOCAL AND PROVIDER-EXECUTED ARE DIFFERENT ANIMALS, AND THIS ONE IS NOW LOCAL (2026-08-07).**
 * It used to be `openai.tools.webSearch` / `vertex.tools.googleSearch` — a hosted tool the VENDOR
 * ran. That coupled research to whichever vendor `RESEARCH_MODEL` named (sending one vendor's
 * hosted tool to the other is a 400), and it died outright when the only funded vendor ran out:
 * OpenAI hit $0 and Gemini's free tier grants ZERO Google Search entitlement, so fixtures
 * 32/33/34 could not pass on either door. Tavily is a plain HTTP API we call ourselves, so
 * research now works on ANY model — the vendor-matching constraint documented at `RESEARCH_MODEL`
 * in @pikar/cost is retired by construction, not worked around.
 *
 * **THREE CONSEQUENCES AT THE CALL SITE, all of which had to change together:**
 *   1. `providerExecuted` is FALSE for a local tool, so `runAgentLoop` can no longer count searches
 *      by that flag. It counts `toolName === "webResearch"` instead — and the literal is safe now
 *      precisely BECAUSE we own the tool: the old comment warned against a name literal because the
 *      PROVIDER chose the emitted name (`web_search`) and could rename it. Nobody renames this one.
 *   2. `res.sources` is empty — that array is populated from provider `url_citation` annotations,
 *      which only a hosted tool emits. Sources are now read from this tool's own RESULT parts,
 *      which is strictly better evidence: still structured, still provider-supplied (Tavily's JSON),
 *      still never parsed out of model prose.
 *   3. `onToolExecutionStart` DOES fire for a local tool, so `agentSteps.tool` needs the
 *      `webResearch` literal — schema.ts said "deliberately NO webResearch companion" and that
 *      reasoning inverted with this change. Without the literal the step insert throws inside a
 *      callback the AI SDK SWALLOWS: no trace in prod, every offline test still green.
 *
 * Module scope and exported so `probeGemini` and `cockpitTools.test.ts` use THE SAME record the
 * research loop does — a probe that builds its own tool proves a fiction (the 15.3 `classifyOne`
 * lesson).
 */
export const buildWebResearchTool = (
  evaluation?: {
    ctx: GenericActionCtx<DataModel>;
    tenantId: string;
    budgetId: Id<"spendEvents">;
  },
  requestControl?: {
    ctx: GenericActionCtx<DataModel>;
    tenantId: string;
    controlId: Id<"researchControls">;
    requestId: string;
  },
  admission?: { ctx: GenericActionCtx<DataModel>; tenantId: string },
): ToolSet => {
  // Phase 39 (RSCH-01). THE CONTAINMENT for page reads, and it is structural: `readPage` accepts
  // ONLY a URL that `webResearch` returned in THIS record's lifetime (one build = one run). An
  // injected page cannot steer the specialist to an arbitrary host, because the model never gets to
  // name a host — it can only pick from what the search provider returned. `reads` caps the count.
  const returned = new Set<string>();
  let reads = 0;
  let unresolvedProviderCall = false;
  const ordinaryAdmission = admission ?? requestControl;
  const reserveOrdinary = async (endpoint: "search" | "extract") => {
    if (!ordinaryAdmission) return null; // Direct pure-tool tests; production builders pass scope.
    const costUsd = endpoint === "search" ? searchFeeUsd(RESEARCH_MODEL) : pageReadFeeUsd();
    const reservationId = await ordinaryAdmission.ctx.runMutation(
      internal.guardrails.reservePaidCall,
      {
        tenantId: ordinaryAdmission.tenantId,
        callId: crypto.randomUUID(),
        model: endpoint === "search" ? "tavily-search" : "tavily-extract",
        ceilingCents: Math.ceil(costUsd * 100),
      },
    );
    return { reservationId, costUsd };
  };
  const settleOrdinary = async (reservation: Awaited<ReturnType<typeof reserveOrdinary>>) => {
    if (!reservation || !ordinaryAdmission) return;
    await ordinaryAdmission.ctx.runMutation(internal.guardrails.settlePaidCall, {
      tenantId: ordinaryAdmission.tenantId,
      ...reservation,
    });
  };

  const fetchBudgeted = async (
    endpoint: "search" | "extract",
    apiKey: string,
    request:
      | ReturnType<typeof goldenTavilySearchRequest>
      | ReturnType<typeof goldenTavilyExtractRequest>,
  ) => {
    // Trusted deployment account attestation, never a model/tool argument. Missing metadata
    // refuses before transport; an ambiguous response retains its full reservation.
    const { creditUsd, billingMode } = goldenTavilyBilling(
      process.env.GOLDEN_TAVILY_BILLING,
      process.env.GOLDEN_TAVILY_CREDIT_USD,
    );
    if (!evaluation) throw new Error("EVAL_BUDGET_REQUIRED");
    if (unresolvedProviderCall) throw new Error("EVAL_TAVILY_RESPONSE_UNRESOLVED");
    const reservationId = await evaluation.ctx.runMutation(internal.guardrails.reserveEvalCall, {
      tenantId: evaluation.tenantId,
      budgetId: evaluation.budgetId,
      callId: crypto.randomUUID(),
      model: request.call.kind,
      outputTokens: 0,
      providerCall: request.call,
    });
    unresolvedProviderCall = true;
    const response = await fetch(`https://api.tavily.com/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const body: unknown = await response.json();
    const costUsd = goldenTavilyObservedUsd(body, creditUsd, billingMode);
    const tavilyCredits = goldenTavilyObservedCredits(body);
    if (costUsd === null || tavilyCredits === null) throw new Error("EVAL_COST_UNKNOWN");
    const settled = await evaluation.ctx.runMutation(internal.guardrails.settleEvalCall, {
      tenantId: evaluation.tenantId,
      reservationId,
      costUsd,
      tavilyCredits,
    });
    if (settled.breached) throw new Error("EVAL_PROVIDER_EXCEEDED_RESERVATION");
    if (!response.ok) throw new Error("EVAL_TAVILY_PROVIDER_FAILED");
    unresolvedProviderCall = false;
    return body;
  };
  return {
    webResearch: tool({
      description:
        "Search the live web and get back real pages with their URLs. Use it for anything you " +
        "cannot answer from the conversation or the vault — recent events, external companies, " +
        "prices, published figures. Search ONCE PER SUB-QUESTION rather than once per run: each " +
        "call is a fresh independent query. Every claim you make from a result must cite that " +
        "result's URL.",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A focused natural-language search query for ONE sub-question.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: async ({ query }): Promise<{ results: WebResult[]; note?: string }> => {
        const apiKey = process.env.TAVILY_API_KEY;
        // Structural absence beats a thrown error here: a missing key is an OPERATOR fault, and a
        // throw inside a tool ends the specialist's whole run. Returning an empty result set lets the
        // model finish and say it found nothing — which the evidence verdict then reports honestly.
        if (!apiKey) return { results: [], note: "web search unavailable: TAVILY_API_KEY unset" };
        // §4 REDACT-BEFORE-EGRESS. This is a NEW third-party boundary — the query is model-authored
        // and could echo tenant content from the prompt. The hosted tools had the same exposure to
        // their own vendor; Tavily is one more party, so the same rule that governs every other
        // outbound call governs this one. Fail CLOSED: an unscannable query is not sent.
        const scan = scanText(query);
        if (!scan.ok)
          return { results: [], note: "web search skipped: query failed redaction scan" };
        if (evaluation) {
          const body = await fetchBudgeted(
            "search",
            apiKey,
            goldenTavilySearchRequest(scan.value.safeText, WEB_RESULTS_PER_SEARCH),
          );
          const results = parseWebResults(body);
          for (const r of results) returned.add(r.url);
          return { results };
        }
        const reservation = await reserveOrdinary("search");
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            query: scan.value.safeText,
            max_results: WEB_RESULTS_PER_SEARCH,
            search_depth: "basic",
          }),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        // Same reasoning as the missing key: a 429 (monthly credits gone) or a 5xx must not kill the
        // run. The model is told plainly, and `sources: []` makes the verdict honest downstream.
        if (!res.ok) return { results: [], note: `web search failed: HTTP ${res.status}` };
        await settleOrdinary(reservation); // Settle paid transport before parsing can fail.
        const results = parseWebResults(await res.json());
        for (const r of results) returned.add(r.url);
        return { results };
      },
    }),
    readPage: tool({
      description:
        "Read one page that a webResearch call returned, focused on what you need from it. Use it " +
        "before you cite a result for a claim that matters — a snippet is a lead, the page is the " +
        "evidence. Only URLs returned by your own searches in this run can be read; each read " +
        "costs a step, so read the two or three pages that carry the answer, not every result.",
      inputSchema: jsonSchema<{ url: string; focus: string }>({
        type: "object",
        properties: {
          url: { type: "string", description: "A URL exactly as a webResearch result gave it." },
          focus: {
            type: "string",
            description: "What you are looking for on this page, in one line (ranks the excerpt).",
          },
        },
        required: ["url", "focus"],
        additionalProperties: false,
      }),
      execute: async ({
        url,
        focus,
      }): Promise<{
        url: string;
        content: string;
        truncated?: boolean;
        note?: string;
        pageReadAt?: number;
      }> => {
        const refused = (note: string) => ({ url, content: "", note });
        // Structural absence of a path to an arbitrary host: not a returned URL ⇒ not fetched.
        if (!returned.has(url))
          return refused("readPage refused: that URL was not returned by a search in this run");
        if (reads >= PAGE_READS_PER_RUN)
          return refused(`readPage refused: this run has read its ${PAGE_READS_PER_RUN} pages`);
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) return refused("page read unavailable: TAVILY_API_KEY unset");
        // §4 REDACT-BEFORE-EGRESS, the webResearch rule: `focus` is model-authored and could echo
        // tenant content; an unscannable focus is not sent. The URL itself came from the provider.
        const scan = scanText(focus);
        if (!scan.ok) return refused("page read skipped: focus failed redaction scan");
        reads += 1;
        if (requestControl) {
          let claimed = false;
          try {
            claimed = await requestControl.ctx.runMutation(internal.researchControl.claim, {
              tenantId: requestControl.tenantId,
              controlId: requestControl.controlId,
              requestId: requestControl.requestId,
              attemptId: crypto.randomUUID(),
            });
          } catch {
            /* An ambiguous claim cannot authorize provider egress. */
          }
          if (claimed !== true)
            return refused("readPage refused: request page allowance is unavailable or exhausted");
        }
        if (evaluation) {
          const body = await fetchBudgeted(
            "extract",
            apiKey,
            goldenTavilyExtractRequest([url], scan.value.safeText),
          );
          const parsed = parseExtractResult(body, url);
          if ("error" in parsed) return refused(`page read failed: ${parsed.error}`);
          if (!parsed.content.trim()) return refused("page read failed: empty excerpt");
          return {
            url,
            content: parsed.content,
            truncated: parsed.truncated,
            pageReadAt: Date.now(),
          };
        }
        const reservation = await reserveOrdinary("extract");
        const res = await fetch("https://api.tavily.com/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            urls: [url],
            extract_depth: "basic",
            format: "markdown",
            query: scan.value.safeText,
            chunks_per_source: 3,
          }),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        // A failed read must not kill the run (the webResearch rule): the model is told, and the
        // claim stays snippet-backed, which the skill body tells it to say.
        if (!res.ok) return refused(`page read failed: HTTP ${res.status}`);
        await settleOrdinary(reservation);
        const parsed = parseExtractResult(await res.json(), url);
        if ("error" in parsed) return refused(`page read failed: ${parsed.error}`);
        if (!parsed.content.trim()) return refused("page read failed: empty excerpt");
        return {
          url,
          content: parsed.content,
          truncated: parsed.truncated,
          pageReadAt: Date.now(),
        };
      },
    }),
  };
};
