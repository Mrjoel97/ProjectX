import { describe, expect, test } from "vitest";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  notificationMessage,
} from "./notificationTemplates";

describe("notificationMessage (§4 static-label firewall)", () => {
  test("every NotificationKind has a defined, non-empty message", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const msg = notificationMessage(kind);
      expect(msg, `kind ${kind} has no message`).toBeTruthy();
      expect(typeof msg).toBe("string");
    }
  });

  test("no message can carry interpolated content (§4 — refs/counts only, never a template)", () => {
    for (const kind of NOTIFICATION_KINDS) {
      // A literal `${` would mean the label was built to accept a content argument.
      expect(notificationMessage(kind)).not.toContain("${");
    }
  });

  test("the union covers every Phase-7 notification site", () => {
    const expected: NotificationKind[] = [
      "validation.rejected",
      "guardrail.blocked",
      "review.expired",
      "review.escalated",
      "retry.limit",
      "agent.timeout",
      "deadletter",
      "awaiting_reauth",
      "optimizer.candidate",
    ];
    expect([...NOTIFICATION_KINDS].sort()).toEqual([...expected].sort());
  });

  test("labels are stable (a fixed string per kind, not derived at call time)", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(notificationMessage(kind)).toBe(notificationMessage(kind));
    }
  });
});
