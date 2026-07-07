/**
 * In-memory login rate limiter. Single-process Map is fine for a localhost
 * demo (brief §1); use a shared store (Redis) if deployed multi-instance.
 *
 * Two independent limits are enforced per login attempt:
 *   1. per (ip, identifier): 5 / 15 min — throttles a single source.
 *   2. per identifier alone: 20 / 15 min — a GLOBAL cap that does NOT depend
 *      on the client IP. This is the important one: the request IP is derived
 *      from the X-Forwarded-For header, which a direct attacker controls, so
 *      an IP-keyed limit alone can be bypassed by rotating the header. The
 *      identifier-only cap bounds brute force against one account (e.g. a
 *      6-digit cleaner PIN) regardless of how many source IPs are spoofed.
 *
 * Usage in a route handler:
 *   if (!checkRateLimit(rateLimitKey(ip, id)) || !checkRateLimit(identifierKey(id))) return 429
 *   ... attempt auth ...
 *   if (failed) { recordAttempt(ipKey); recordAttempt(idKey); }
 *   else { clearAttempts(ipKey); clearAttempts(idKey); }
 */

const MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_PER_IDENTIFIER = 20;
const WINDOW_MS = 15 * 60 * 1000;

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

/** Build a stable rate-limit key from an IP address and an identifier (email/phone). */
export function rateLimitKey(ip: string, identifier: string): string {
  return `ip:${ip}:${identifier.toLowerCase()}`;
}

/** Build the IP-independent, identifier-only key (global per-account cap). */
export function identifierKey(identifier: string): string {
  return `id:${identifier.toLowerCase()}`;
}

function limitForKey(key: string): number {
  return key.startsWith("id:") ? MAX_ATTEMPTS_PER_IDENTIFIER : MAX_ATTEMPTS;
}

/**
 * Returns true if the caller is still allowed to attempt (i.e. under the
 * limit). Does NOT itself record an attempt — call recordAttempt() after a
 * failed auth check.
 */
export function checkRateLimit(key: string): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return true;

  const now = Date.now();
  if (now - bucket.windowStart >= WINDOW_MS) {
    // Window has expired — caller is allowed; the bucket will be reset on
    // the next recordAttempt() call.
    return true;
  }

  return bucket.count < limitForKey(key);
}

/** Record a failed attempt, sliding/starting the 15-minute window as needed. */
export function recordAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  bucket.count += 1;
}

/** Clear attempts for a key (e.g. on successful login). */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}

/** Test-only: wipe all rate-limit state. */
export function resetRateLimitStore(): void {
  buckets.clear();
}
