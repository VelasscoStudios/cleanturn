/**
 * In-memory login rate limiter: 5 attempts per 15 minutes per (ip, identifier)
 * pair. Single-process Map is fine for a localhost demo (brief §1).
 *
 * Usage in a route handler:
 *   const key = `${ip}:${email}`;
 *   if (!checkRateLimit(key)) return 429
 *   ... attempt auth ...
 *   if (failed) recordAttempt(key)
 *   else clearAttempts(key) // optional: reset on success
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Bucket = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, Bucket>();

/** Build a stable rate-limit key from an IP address and an identifier (email/phone). */
export function rateLimitKey(ip: string, identifier: string): string {
  return `${ip}:${identifier.toLowerCase()}`;
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

  return bucket.count < MAX_ATTEMPTS;
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
