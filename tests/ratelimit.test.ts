import { describe, it, expect } from "vitest";
import {
  rateLimitKey,
  identifierKey,
  limitForKey,
  MAX_ATTEMPTS,
  MAX_ATTEMPTS_PER_IDENTIFIER,
} from "../lib/ratelimit";

// The counting/window/atomicity behavior lives in registerAttempt(), which is
// a DB-atomic INSERT ... ON CONFLICT and is exercised end-to-end at runtime
// (including a concurrency test). These unit tests cover the pure key/limit
// logic that decides which cap applies and how identifiers are normalized.

describe("ratelimit key construction", () => {
  it("prefixes ip keys and lowercases the identifier", () => {
    expect(rateLimitKey("1.2.3.4", "Admin@Example.com")).toBe("ip:1.2.3.4:admin@example.com");
  });

  it("builds an IP-independent identifier key", () => {
    expect(identifierKey("Admin@Example.com")).toBe("id:admin@example.com");
  });

  it("is case-insensitive on the identifier, so casing yields the same key", () => {
    expect(rateLimitKey("1.2.3.4", "admin@example.com")).toBe(
      rateLimitKey("1.2.3.4", "ADMIN@EXAMPLE.COM"),
    );
    expect(identifierKey("A@B.COM")).toBe(identifierKey("a@b.com"));
  });

  it("keeps different IPs and identifiers in distinct buckets", () => {
    const a = rateLimitKey("1.2.3.4", "admin@example.com");
    const b = rateLimitKey("5.6.7.8", "admin@example.com");
    const c = rateLimitKey("1.2.3.4", "other@example.com");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("ratelimit caps", () => {
  it("applies the per-IP cap to ip keys", () => {
    expect(limitForKey(rateLimitKey("1.2.3.4", "a@b.c"))).toBe(MAX_ATTEMPTS);
  });

  it("applies the higher global cap to identifier-only keys", () => {
    expect(limitForKey(identifierKey("a@b.c"))).toBe(MAX_ATTEMPTS_PER_IDENTIFIER);
  });

  it("the identifier cap is higher than the per-IP cap", () => {
    expect(MAX_ATTEMPTS_PER_IDENTIFIER).toBeGreaterThan(MAX_ATTEMPTS);
  });
});
