import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// WHAT THIS PROVES AND WHAT IT DOES NOT.
//
// `apps/web`'s vitest config is node-only: no jsdom, no testing-library, and `.tsx` is deliberately
// out of scope (see vitest.config.ts). This file therefore reads `page.tsx` as SOURCE TEXT. It
// proves the shipped source contains and lacks exact things — which mutation-catches a downgraded
// call, a leaked field or a missing gate. It proves NOTHING about pixels, layout, focus order,
// whether the section renders, or whether a click reaches the server. The browser proof is 21-06's.
//
// The actual trust boundary is server-side (`ownerQuery`/`ownerMutation` + EVAL_GATE, proven
// behaviourally in packages/backend/convex/skills.test.ts). Everything here is about the surface.

const page = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

// Strip comments before every NEGATIVE assertion. Without this the guard punishes its own
// documentation: a comment explaining why there is no raw-evidence render reads exactly like one.
const code = page.replace(/\/\*[\s\S]*?\*\/|\{\s*\/\*[\s\S]*?\*\/\s*\}|\/\/.*/g, "");

/** The tenant-candidate owner component body, from its declaration to the next top-level one. */
const panel = (() => {
  const from = code.indexOf("function TenantCandidatesPanel()");
  const to = code.indexOf("export default function OpsPage", from + 1);
  return { from, to, text: code.slice(from, to) };
})();

describe("tenant skill review surface — the panel exists and is wired", () => {
  test("the source was found and the panel is a real, non-empty component", () => {
    // Anti-vacuity for every `toContain` below: an empty string contains nothing and would pass
    // every negative assertion in this file for free.
    expect(page.length).toBeGreaterThan(5000);
    expect(panel.from).toBeGreaterThan(-1);
    expect(panel.to).toBeGreaterThan(panel.from);
    expect(panel.text.length).toBeGreaterThan(3000);
  });

  test("it calls the three owner-gated tenant endpoints and nothing else skill-shaped", () => {
    expect(panel.text).toContain("useQuery(api.skills.tenantCandidatesForReview, {})");
    expect(panel.text).toContain("useMutation(api.skills.activateTenantCandidate)");
    expect(panel.text).toContain("useMutation(api.skills.activateAgentCandidate)");
    expect(code.split("api.skills.activateTenantCandidate").length - 1).toBe(1);
    expect(code.split("api.skills.activateAgentCandidate").length - 1).toBe(1);
    expect(panel.text).toContain("useMutation(api.skills.rollbackTenantSkill)");
    // The GLOBAL optimizer endpoints belong to OptimizerPanel; this panel must not reach them.
    expect(panel.text).not.toContain("api.skills.activateCandidate");
    expect(panel.text).not.toContain("api.skills.candidatesForReview");
    // Nor the ordinary tenant authoring surface — a user's own panel is not an owner control.
    expect(panel.text).not.toContain("api.skills.publishUserCandidate");
    expect(panel.text).not.toContain("api.skills.myUserSkills");
  });

  test("the panel is mounted, and only inside the isOwner branch", () => {
    // A component with no call site is invisible to every green suite here.
    expect(code).toContain("<TenantCandidatesPanel />");
    const gate = code.indexOf("{isOwner && (");
    const gateEnd = code.indexOf("</section>", gate);
    expect(gate).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gate);
    const guarded = code.slice(gate, gateEnd);
    // Non-vacuity floor: the slice really is the owner section (it also holds OptimizerPanel).
    expect(guarded).toContain("<OptimizerPanel />");
    expect(guarded).toContain("<TenantCandidatesPanel />");
    // …and there is exactly ONE mount, so a second unguarded one cannot hide elsewhere.
    expect(code.split("<TenantCandidatesPanel />").length - 1).toBe(1);
  });

  test("global optimizer candidates and user candidates are separately labelled", () => {
    // Two `caps-label` headings, not one merged queue: an optimizer rewrite of the global registry
    // and one tenant's own adaptation are different objects with different correct actions.
    expect(code).toContain("Tenant skill candidates");
    expect(code).toContain("Optimizer");
    expect(code.split('className="caps-label"').length - 1).toBeGreaterThanOrEqual(4);
  });
});

describe("tenant skill review surface — exact-id calls, never name@version", () => {
  test("activate is called with the exact candidate id", () => {
    expect(panel.text).toContain("activateUser({ candidateId: c.candidateId })");
    expect(panel.text).toContain("activateAgent({ candidateId: c.candidateId })");
    expect(panel.text).toContain('c.author === "agent"');
    // The global panel activates by `{ name, version }`. Two tenants can hold the same pair, so
    // that call shape must not appear here at all.
    expect(panel.text).not.toContain("activateUser({ name");
    expect(panel.text).not.toContain("activateAgent({ name");
  });

  test("rollback is called with an id taken from the server's own eligible list", () => {
    expect(panel.text).toContain("rollback({ targetId: pick.id })");
    expect(panel.text).toContain("c.rollbackTargets.find((r) => String(r.id) === choice)");
    // A stale selection resolves to nothing and does nothing. No `!`, no fallthrough to another
    // row, and no `?? c.rollbackTargets[0]` — restoring "some other version" is the whole class
    // of bug this control exists to avoid.
    expect(panel.text).toContain("if (pick)");
    expect(panel.text).not.toContain("=== choice)!");
    // The selectable set is the server's `rollbackTargets` and nothing derived from the candidate
    // itself — the panel never invents a version number to restore.
    expect(panel.text).toContain("c.rollbackTargets.map((r) =>");
    expect(panel.text).not.toContain("targetId: c.candidateId");
  });

  test("Activate is disabled until the eval gate has passed", () => {
    expect(panel.text).toContain("disabled={!c.gatePassed || working}");
    // …with a stated reason, not a mystery grey button (BRAND §6: meaning is never colour alone).
    expect(panel.text).toContain("Activation needs a passing eval run pinning this exact row.");
  });
});

describe("tenant skill review surface — honest state words", () => {
  test("both gate states are rendered as explicit sentences", () => {
    expect(panel.text).toContain("Evaluation passed — ready for owner activation");
    expect(panel.text).toContain("Candidate — awaiting evaluation");
    // A recorded-but-mismatched pin is its own operator situation and must not read as "none".
    expect(panel.text).toContain('c.evidenceState === "failing"');
  });

  test("loading and empty states are honest and distinct", () => {
    expect(panel.text).toContain("Loading tenant skill candidates…");
    expect(panel.text).toContain("No tenant skill candidates awaiting review.");
    expect(panel.text).toContain("No earlier version has ever been live for this tenant.");
  });

  test("refusals surface inline, and are never swallowed or thrown at a dialog", () => {
    expect(panel.text).toContain('role="alert"');
    expect(panel.text).toContain("err instanceof Error ? err.message : String(err)");
    expect(panel.text).not.toContain("window.alert");
    expect(panel.text).not.toContain("window.confirm");
    expect(panel.text).not.toContain("console.error");
  });
});

describe("tenant skill review surface — disclosure boundaries", () => {
  test("no eval fixture, corpus or held-out case leaks onto the page", () => {
    for (const tell of ["fixture", "golden", "evalCase", "eval-case", "expectedOutput"]) {
      expect(panel.text, `panel mentions ${tell}`).not.toContain(tell);
    }
    // The raw evidence STRING is not rendered — only the server's refs summary is. Matching on
    // `c.evidence}` alone is NOT enough: `c.evidence ?? "…"` renders it just as well and slips
    // through (measured — that mutation was green until this regex replaced the substring).
    expect(panel.text).not.toMatch(/c\.evidence(?![A-Za-z])/);
    expect(panel.text).toContain("c.evidenceSummary");
  });

  test("provenance is refs: ids, never a name or an email", () => {
    expect(panel.text).toContain("{c.tenantId}");
    expect(panel.text).toContain("{c.authorUserId ?? ");
    expect(panel.text).toContain("{c.authorAgentId ?? ");
    expect(panel.text).toContain("shortRef(c.sourceThreadId)");
    expect(panel.text).toContain("shortRef(c.sourceTurnId)");
    for (const field of ["email", "displayName", ".name}", "avatar"]) {
      expect(panel.text, `panel renders ${field}`).not.toContain(field);
    }
  });

  test("agent approval state is explicit but raw evidence and fixtures remain absent", () => {
    expect(panel.text).toContain("Owner approval: not recorded");
    expect(panel.text).toContain("c.ownerApproval.evalRunId");
    expect(panel.text).not.toMatch(/c\.evidence(?![A-Za-z])/);
  });
});

describe("tenant skill review surface — BRAND compliance", () => {
  test("colours come from tokens; amber is never spent here", () => {
    expect(panel.text).toContain("var(--ink-soft)");
    expect(panel.text).toContain("var(--teal-600)");
    expect(panel.text).toContain("var(--released)");
    // BRAND §2: `--held` is the approval gate's alone. A skill candidate is not an approval.
    expect(panel.text).not.toContain("--held");
    // The only literal hexes permitted are the two this file already documents and uses
    // everywhere: #fff on a teal fill, and the incident red no token covers.
    const hexes = [...panel.text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect([...new Set(hexes)].sort()).toEqual(["#991b1b", "#fff"]);
  });

  test("no component library and no new route were introduced", () => {
    for (const dep of ["@radix", "@mui", "antd", "chakra", "react-diff", "next/link"]) {
      expect(page, `page imports ${dep}`).not.toContain(dep);
    }
    // The diff is the page's own existing helper, reused rather than re-implemented.
    expect(panel.text).toContain("unifiedDiff(c.baseBody, c.candidateBody)");
    expect(page.split("function unifiedDiff(").length - 1).toBe(1);
  });

  test("controls are keyboard-reachable and labelled", () => {
    expect(panel.text).toContain('type="button"');
    expect(panel.text).toContain("aria-label={`Roll ${c.label} back to a previous version");
    // Every interactive element is a real control — no div-as-button, no span-as-button.
    expect(panel.text).not.toMatch(/<(div|span|li)\b[^>]*onClick/);
    // …and every onClick in the panel belongs to a <button>.
    const onClicks = panel.text.split("onClick=").length - 1;
    expect(onClicks).toBe(2); // Author-specific Activate, Roll back
    expect(panel.text.split("<button").length - 1).toBe(2);
  });
});
