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
