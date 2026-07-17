const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Edmonton";

/** Today's date as YYYY-MM-DD in APP_TIMEZONE. Never use server-local time directly. */
export function todayStr(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Add n days (may be negative) to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
export function addDays(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  // Use UTC noon to avoid DST edge issues when just adding whole days.
  const dt = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Whole days from `a` to `b` (positive when b is after a), for YYYY-MM-DD strings. */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  // Use UTC midnight for both sides so DST never skews the day count.
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

/** Format a YYYY-MM-DD string as e.g. "Monday, Jul 6". */
export function fmtDay(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dt);
}

/** Extract the YYYY-MM month portion from a YYYY-MM-DD string. */
export function monthOf(d: string): string {
  return d.slice(0, 7);
}

/** Monday (YYYY-MM-DD) of the week containing `dateStr`. */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isoDow = dow === 0 ? 7 : dow; // Sunday (0) -> 7, so Monday is always day 1.
  return addDays(dateStr, -(isoDow - 1));
}

/**
 * Saturday (YYYY-MM-DD) on or before `dateStr` — the start of a billing "pay
 * week". Cleaners are paid on Friday for Saturday→Friday, so billing weeks run
 * Sat–Fri, unlike calendar weeks (see mondayOf).
 */
export function saturdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return addDays(dateStr, -((dow - 6 + 7) % 7));
}

/** Last day of the month containing `d` (a YYYY-MM-DD string), as YYYY-MM-DD. */
export function lastDayOfMonth(d: string): string {
  const [y, m] = d.split("-").map(Number);
  // Day 0 of the next month is the last day of this month.
  const dt = new Date(Date.UTC(y, m, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
