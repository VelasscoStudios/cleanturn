import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  recordAttempt,
  clearAttempts,
  resetRateLimitStore,
  rateLimitKey,
} from "../lib/ratelimit";

describe("ratelimit", () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it("allows the first attempt for a fresh key", () => {
    const key = rateLimitKey("1.2.3.4", "admin@example.com");
    expect(checkRateLimit(key)).toBe(true);
  });

  it("allows up to 5 failed attempts, then blocks the 6th", () => {
    const key = rateLimitKey("1.2.3.4", "admin@example.com");

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key)).toBe(true);
      recordAttempt(key);
    }

    // After 5 recorded failures, the 6th check must be blocked.
    expect(checkRateLimit(key)).toBe(false);
  });

  it("keeps IP+identifier pairs independent", () => {
    const keyA = rateLimitKey("1.2.3.4", "admin@example.com");
    const keyB = rateLimitKey("5.6.7.8", "admin@example.com");
    const keyC = rateLimitKey("1.2.3.4", "other@example.com");

    for (let i = 0; i < 5; i++) recordAttempt(keyA);

    expect(checkRateLimit(keyA)).toBe(false);
    expect(checkRateLimit(keyB)).toBe(true);
    expect(checkRateLimit(keyC)).toBe(true);
  });

  it("is case-insensitive on the identifier portion of the key", () => {
    const keyLower = rateLimitKey("1.2.3.4", "admin@example.com");
    const keyUpper = rateLimitKey("1.2.3.4", "ADMIN@EXAMPLE.COM");

    for (let i = 0; i < 5; i++) recordAttempt(keyLower);

    expect(checkRateLimit(keyUpper)).toBe(false);
  });

  it("clearAttempts resets the bucket (e.g. after a successful login)", () => {
    const key = rateLimitKey("1.2.3.4", "admin@example.com");

    for (let i = 0; i < 5; i++) recordAttempt(key);
    expect(checkRateLimit(key)).toBe(false);

    clearAttempts(key);
    expect(checkRateLimit(key)).toBe(true);
  });

  it("resets the window after WINDOW_MS elapses", () => {
    const key = rateLimitKey("1.2.3.4", "admin@example.com");
    const realNow = Date.now;

    try {
      let currentTime = 1_000_000;
      Date.now = () => currentTime;

      for (let i = 0; i < 5; i++) recordAttempt(key);
      expect(checkRateLimit(key)).toBe(false);

      // Advance time by just under 15 minutes — still blocked.
      currentTime += 15 * 60 * 1000 - 1000;
      expect(checkRateLimit(key)).toBe(false);

      // Advance past the 15-minute window — allowed again.
      currentTime += 2000;
      expect(checkRateLimit(key)).toBe(true);

      // A fresh failed attempt after the window starts a new window of 1.
      recordAttempt(key);
      expect(checkRateLimit(key)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("resetRateLimitStore clears all keys", () => {
    const keyA = rateLimitKey("1.2.3.4", "a@example.com");
    const keyB = rateLimitKey("5.6.7.8", "b@example.com");

    for (let i = 0; i < 5; i++) {
      recordAttempt(keyA);
      recordAttempt(keyB);
    }
    expect(checkRateLimit(keyA)).toBe(false);
    expect(checkRateLimit(keyB)).toBe(false);

    resetRateLimitStore();

    expect(checkRateLimit(keyA)).toBe(true);
    expect(checkRateLimit(keyB)).toBe(true);
  });
});
