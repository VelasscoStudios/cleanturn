import { describe, it, expect } from "vitest";
import {
  isAllowed,
  nextBucket,
  limitForKey,
  rateLimitKey,
  identifierKey,
  MAX_ATTEMPTS,
  MAX_ATTEMPTS_PER_IDENTIFIER,
  WINDOW_MS,
  type Bucket,
} from "../lib/ratelimit";

// The DB-backed checkRateLimit/recordAttempt/clearAttempts wrap these pure
// functions; the branching logic lives here and is tested without a database.

const T0 = 1_000_000;

/** Simulate recording n failed attempts starting from no bucket, at time T0. */
function afterAttempts(n: number, startBucket: Bucket | null = null, now = T0): Bucket | null {
  let b = startBucket;
  for (let i = 0; i < n; i++) b = nextBucket(b, now);
  return b;
}

describe("ratelimit key construction", () => {
  it("prefixes ip keys and lowercases the identifier", () => {
    expect(rateLimitKey("1.2.3.4", "Admin@Example.com")).toBe("ip:1.2.3.4:admin@example.com");
  });

  it("builds an IP-independent identifier key", () => {
    expect(identifierKey("Admin@Example.com")).toBe("id:admin@example.com");
  });

  it("case-insensitive identifier means same key regardless of case", () => {
    expect(rateLimitKey("1.2.3.4", "admin@example.com")).toBe(
      rateLimitKey("1.2.3.4", "ADMIN@EXAMPLE.COM"),
    );
  });

  it("applies the higher cap to identifier-only keys", () => {
    expect(limitForKey(rateLimitKey("1.2.3.4", "a@b.c"))).toBe(MAX_ATTEMPTS);
    expect(limitForKey(identifierKey("a@b.c"))).toBe(MAX_ATTEMPTS_PER_IDENTIFIER);
  });
});

describe("ratelimit decision logic", () => {
  it("allows the first attempt for a fresh (missing) bucket", () => {
    expect(isAllowed(null, T0, MAX_ATTEMPTS)).toBe(true);
  });

  it("allows up to 5 attempts on an IP key, then blocks the 6th", () => {
    let b: Bucket | null = null;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(isAllowed(b, T0, MAX_ATTEMPTS)).toBe(true);
      b = nextBucket(b, T0);
    }
    expect(isAllowed(b, T0, MAX_ATTEMPTS)).toBe(false);
  });

  it("allows up to 20 attempts on an identifier key, then blocks the 21st", () => {
    const b = afterAttempts(MAX_ATTEMPTS_PER_IDENTIFIER);
    expect(isAllowed(b, T0, MAX_ATTEMPTS_PER_IDENTIFIER)).toBe(false);
    const b19 = afterAttempts(MAX_ATTEMPTS_PER_IDENTIFIER - 1);
    expect(isAllowed(b19, T0, MAX_ATTEMPTS_PER_IDENTIFIER)).toBe(true);
  });

  it("resets the window after WINDOW_MS elapses", () => {
    const b = afterAttempts(MAX_ATTEMPTS);
    expect(isAllowed(b, T0, MAX_ATTEMPTS)).toBe(false);

    // Just under 15 minutes — still blocked.
    expect(isAllowed(b, T0 + WINDOW_MS - 1000, MAX_ATTEMPTS)).toBe(false);

    // Past the window — allowed again.
    expect(isAllowed(b, T0 + WINDOW_MS + 1, MAX_ATTEMPTS)).toBe(true);
  });

  it("a failed attempt after the window starts a fresh window of 1", () => {
    const b = afterAttempts(MAX_ATTEMPTS);
    const revived = nextBucket(b, T0 + WINDOW_MS + 1);
    expect(revived.count).toBe(1);
    expect(revived.windowStart).toBe(T0 + WINDOW_MS + 1);
    expect(isAllowed(revived, T0 + WINDOW_MS + 1, MAX_ATTEMPTS)).toBe(true);
  });

  it("counting within the window keeps the original windowStart", () => {
    const b1 = nextBucket(null, T0);
    const b2 = nextBucket(b1, T0 + 5000);
    expect(b2.windowStart).toBe(T0);
    expect(b2.count).toBe(2);
  });
});
