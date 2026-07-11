import { describe, expect, test } from "vitest";
import {
  EXPIRY_WARN_WINDOW_MS,
  REFRESH_TOKEN_TTL_MS,
  isDead,
  isExpiringSoon,
} from "./tokenExpiry";

const NOW = 1_000_000_000_000; // fixed reference clock
const HOUR = 60 * 60 * 1000;

describe("isExpiringSoon — DLVR-03 proactive reconnect window", () => {
  test("true when expiry is inside the window", () => {
    // 1h left, default ~24h window
    expect(isExpiringSoon(NOW + HOUR, NOW)).toBe(true);
    // exactly at the window edge counts as expiring
    expect(isExpiringSoon(NOW + EXPIRY_WARN_WINDOW_MS, NOW)).toBe(true);
  });

  test("false when expiry is outside the window", () => {
    expect(isExpiringSoon(NOW + EXPIRY_WARN_WINDOW_MS + 1, NOW)).toBe(false);
    // a fresh 7-day refresh token is nowhere near its warn window
    expect(isExpiringSoon(NOW + REFRESH_TOKEN_TTL_MS, NOW)).toBe(false);
  });

  test("already-expired is still 'expiring soon' (never < window)", () => {
    expect(isExpiringSoon(NOW - HOUR, NOW)).toBe(true);
  });

  test("honours a custom window", () => {
    expect(isExpiringSoon(NOW + 2 * HOUR, NOW, HOUR)).toBe(false);
    expect(isExpiringSoon(NOW + HOUR, NOW, 2 * HOUR)).toBe(true);
  });
});

describe("isDead — 7-day refresh expiry (Testing mode)", () => {
  test("false before the refresh window passes", () => {
    const refreshExpiresAt = NOW + REFRESH_TOKEN_TTL_MS;
    expect(isDead(refreshExpiresAt, NOW)).toBe(false);
  });

  test("true once the refresh window has passed", () => {
    const refreshExpiresAt = NOW - 1;
    expect(isDead(refreshExpiresAt, NOW)).toBe(true);
    // exactly at expiry counts as dead
    expect(isDead(NOW, NOW)).toBe(true);
  });
});
