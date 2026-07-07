/**
 * Durable login rate limiter, backed by the LoginRateLimit table (SQLite).
 *
 * Two independent limits are enforced per login attempt:
 *   1. per (ip, identifier): 5 / 15 min — throttles a single source.
 *   2. per identifier alone: 20 / 15 min — a GLOBAL cap that does NOT depend
 *      on the client IP. The request IP comes from the X-Forwarded-For header,
 *      which a direct attacker controls, so an IP-keyed limit alone can be
 *      bypassed by rotating the header. The identifier-only cap bounds brute
 *      force against one account (e.g. a 6-digit cleaner PIN) no matter how
 *      many source IPs are spoofed.
 *
 * Concurrency: registerAttempt() increments with a single atomic
 * `INSERT ... ON CONFLICT ... RETURNING` statement — NOT a read-modify-write —
 * so a burst of parallel attempts cannot lose increments and slip past the cap.
 * Persisting to the DB (rather than an in-process Map) means the window
 * survives restarts and is shared across workers; expired rows are evicted on
 * each call so neither memory nor disk grows without bound.
 *
 * Usage in a route handler (record-then-check at the gate, before bcrypt):
 *   const ipOk = await registerAttempt(ipKey);
 *   const idOk = await registerAttempt(idKey);
 *   if (!ipOk || !idOk) return 429
 *   ... attempt auth ...
 *   if (success) { await clearAttempts(ipKey); await clearAttempts(idKey); }
 */
import { prisma } from "./db";

export const MAX_ATTEMPTS = 5;
export const MAX_ATTEMPTS_PER_IDENTIFIER = 20;
export const WINDOW_MS = 15 * 60 * 1000;

/** Build a stable rate-limit key from an IP address and an identifier (email/phone). */
export function rateLimitKey(ip: string, identifier: string): string {
  return `ip:${ip}:${identifier.toLowerCase()}`;
}

/** Build the IP-independent, identifier-only key (global per-account cap). */
export function identifierKey(identifier: string): string {
  return `id:${identifier.toLowerCase()}`;
}

/** The attempt cap for a key: the higher global cap for identifier-only keys. */
export function limitForKey(key: string): number {
  return key.startsWith("id:") ? MAX_ATTEMPTS_PER_IDENTIFIER : MAX_ATTEMPTS;
}

/**
 * Atomically record one failed-or-pending attempt against `key` and report
 * whether it is still within the limit for the current 15-minute window.
 * Returns true if allowed, false if this attempt exceeds the cap.
 */
export async function registerAttempt(key: string): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);

  // Evict every expired window: bounds the table AND resets this key's own
  // expired window in the same sweep, so the ON CONFLICT below only ever
  // increments a still-live window (never an expired one).
  await prisma.loginRateLimit.deleteMany({ where: { windowStart: { lt: cutoff } } });

  // Single atomic statement: create the row (count 1) or increment it. No
  // read-modify-write, so concurrent attempts each get a distinct final count.
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    INSERT INTO "LoginRateLimit" ("key", "count", "windowStart", "updatedAt")
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT("key") DO UPDATE SET
      "count" = "LoginRateLimit"."count" + 1,
      "updatedAt" = ${now}
    RETURNING "count" AS count
  `;
  const count = Number(rows[0]?.count ?? 1);
  return count <= limitForKey(key);
}

/** Clear a key (e.g. on successful login). */
export async function clearAttempts(key: string): Promise<void> {
  await prisma.loginRateLimit.deleteMany({ where: { key } });
}
