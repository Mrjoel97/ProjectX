// Phase 34 (Goal Engine v0, ADR-033): the agenda's pure lifecycle rules.
import { describe, expect, test } from "vitest";
import {
  AGENDA_STATUS_WORD,
  AGENDA_STATUSES,
  agendaStatusFromPlan,
  nextAgendaStatus,
  segmentForRoute,
} from "./agenda";

describe("nextAgendaStatus — the transition for a gap PRESENT in the latest review", () => {
  test("a gap never seen before opens; open, proposed and recurring hold", () => {
    expect(nextAgendaStatus(null, false)).toBe("open");
    expect(nextAgendaStatus("open", false)).toBe("open");
    expect(nextAgendaStatus("proposed", false)).toBe("proposed");
    expect(nextAgendaStatus("recurring", false)).toBe("recurring");
    // cameBack cannot matter for a row that was never absent
    expect(nextAgendaStatus("open", true)).toBe("open");
  });
  test("a gap already acted on that is still here has come back", () => {
    expect(nextAgendaStatus("acted", false)).toBe("recurring");
    expect(nextAgendaStatus("acted", true)).toBe("recurring");
  });
  test("a dismissal holds while the gap persists, and lifts only once it closed and returned", () => {
    expect(nextAgendaStatus("dismissed", false)).toBe("dismissed");
    expect(nextAgendaStatus("dismissed", true)).toBe("recurring");
  });
});

describe("agendaStatusFromPlan — the plan row is the proposal's fate", () => {
  test("crossing the gate is acted; Discard is dismissed; waiting is null", () => {
    for (const s of ["approved", "scheduled", "delivering", "done"])
      expect(agendaStatusFromPlan(s), s).toBe("acted");
    expect(agendaStatusFromPlan("canceled")).toBe("dismissed");
    expect(agendaStatusFromPlan("proposed")).toBeNull();
    expect(agendaStatusFromPlan("collecting")).toBeNull();
  });
});

describe("goal linkage v0 reads the blueprint segment the specialist owns", () => {
  test("registered routes map; the ask branch's empty route and unknown routes do not", () => {
    expect(segmentForRoute("offer-architect")).toBe("offer");
    expect(segmentForRoute("money-model-designer")).toBe("money-model");
    expect(segmentForRoute("lead-engine")).toBe("leads");
    expect(segmentForRoute("")).toBeNull();
    expect(segmentForRoute("document-analyst")).toBeNull();
  });
});

test("every status has a word that is not its slug", () => {
  for (const s of AGENDA_STATUSES) {
    expect(AGENDA_STATUS_WORD[s]).toBeTruthy();
    expect(AGENDA_STATUS_WORD[s]).not.toBe(s); // a capitalised word or a phrase, never the raw slug
  }
});
