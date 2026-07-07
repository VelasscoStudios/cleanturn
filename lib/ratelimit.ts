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
 * Persisting the buckets (rather than an in-process Map) means the window
 * survives process restarts, is shared across every worker on the same DB,
 * and cannot grow unbounded in memory. The decision/advancement logic is kept
 * as pure functions (isAllowed / nextBucket) so it is unit-tested without a DB.
 *
 * Usage in a route handler:
 *   if (!(await checkRateLimit(ipKey)) || !(await checkRateLimit(idKey))) return 429
 *   ... attempt auth ...
 *   if (failed) { await recordAttempt(ipKey); await recordAttempt(idKey); }
 *   else { await clearAttempts(ipKey); await clearAttempts(idKey); }
 */
import { prisma } from "./db";

export const MAX_ATTEMPTS = 5;
export const MAX_ATTEMPTS_PER_IDENTIFIER = 20;
export const WINDOW_MS = 15 * 60 * 1000;

export type Bucket = {
  count: number;
  windowStart: number; // epoch ms
};

/** Build a stable rate-limit key from an IP address and an identifier (email/phone). */
export function rateLimitKey(ip: string, identifier: string): string {
  return `ip:${ip}:${identifier.toLowerCase()}`;
}

/** Build the IP-independent, identifier-only key (global per-account cap). */
export function identifierKey(identifier: string): string {
  return `id:${identifier.toLowerCase()}`;
}

export function limitForKey(key: string): number {
  return key.startsWith("id:") ? MAX_ATTEMPTS_PER_IDENTIFIER : MAX_ATTEMPTS;
}

/**
 * Pure decision: is a caller holding `bucket` allowed to attempt at time `now`
 * under `limit`? A missing bucket or an expired window means allowed.
 */
export function isAllowed(bucket: Bucket | null, now: number, limit: number): boolean {
  if (!bucket) return true;
  if (now - bucket.windowStart >= WINDOW_MS) return true;
  return bucket.count < limit;
}

/** Pure: the bucket after recording one failed attempt at time `now`. */
export function nextBucket(bucket: Bucket | null, now: number): Bucket {
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    return { count: 1, windowStart: now };
  }
  return { count: bucket.count + 1, windowStart: bucket.windowStart };
}

async function loadBucket(key: string): Promise<Bucket | null> {
  const row = await prisma.loginRateLimit.findUnique({ where: { key } });
  if (!row) return null;
  return { count: row.count, windowStart: row.windowStart.getTime() };
}

/** Returns true if the caller is still under the limit. Does NOT record. */
export async function checkRateLimit(key: string): Promise<boolean> {
  const bucket = await loadBucket(key);
  return isAllowed(bucket, Date.now(), limitForKey(key));
}

/** Record a failed attempt, starting/advancing the 15-minute window. */
export async function recordAttempt(key: string): Promise<void> {
  const now = Date.now();
  const bucket = await loadBucket(key);
  const nb = nextBucket(bucket, now);
  const windowStart = new Date(nb.windowStart);
  await prisma.loginRateLimit.upsert({
    where: { key },
    create: { key, count: nb.count, windowStart },
    update: { count: nb.count, windowStart },
  });
}

/** Clear a key (e.g. on successful login). */
export async function clearAttempts(key: string): Promise<void> {
  await prisma.loginRateLimit.deleteMany({ where: { key } });
}
