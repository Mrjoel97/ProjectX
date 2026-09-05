// Plan 28-09 Task 2: list-level and interactive lifecycle guards for the Connections panel.
//
// The row copy has focused tests in connectorRows.test.ts. This file deliberately carries the
// plan's `connections` name so the plan-mandated `vitest ... connections` command cannot succeed
// without exercising the actual Phase 28 surface.
import { describe, expect, test } from "vitest";
import { connectorBusyLabel, connectorListView } from "./connectorRows";

describe("connector list loading and omission", () => {
  test("query loading is checking, never an empty or disconnected provider card", () => {
    expect(connectorListView(undefined)).toEqual({ state: "checking", rows: [] });
  });

  test("a loaded empty server projection stays hidden", () => {
    expect(connectorListView([])).toEqual({ state: "hidden", rows: [] });
  });
});

describe("interactive lifecycle copy", () => {
  test("connect and disconnect in flight are named and announced", () => {
    expect(connectorBusyLabel("connecting")).toBe("Connecting…");
    expect(connectorBusyLabel("disconnecting")).toBe("Disconnecting…");
    expect(connectorBusyLabel(null)).toBeNull();
  });
});
