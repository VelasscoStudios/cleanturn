import { prisma } from "./db";
import { todayStr, addDays } from "./dates";
import { parseIcs, type ParsedBookingEvent } from "./ical";
import {
  reconcile,
  computeSameDay,
  type ExistingBooking,
  type SameDayJobInput,
  type SameDayBookingInput,
} from "./sync-core";
import { demoEvents, eventsToIcs } from "./fixtures";
import { notifyCleaner, notifyAdmin } from "./notify";

export type SyncCounts = {
  created: number;
  moved: number;
  cancelled: number;
  errors: number;
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1MB cap
const MAX_REDIRECTS = 3;
const LOCAL_SHORT_CIRCUIT_MARKER = "/api/dev/ical/";
const ADMIN_ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000; // dedupe to 1/day
const FEED_ERROR_ALERT_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6h
const UNASSIGNED_WINDOW_DAYS = 2; // "within 48h"

/**
 * Registrable Airbnb domains whose calendar exports we accept. Airbnb serves
 * iCal from www.airbnb.<tld>; we allow each apex and any subdomain of it.
 *
 * This is an explicit allowlist rather than a loose regex on purpose: a
 * pattern like /airbnb\.[a-z.]+/ also matches lookalike hosts an attacker can
 * register — "airbnb.com.evil.com" and "airbnb.evil.com" both satisfy it —
 * which is exactly the SSRF bypass we must not permit. Matching against a
 * fixed set of registrable domains makes "airbnb" the registrable label, not
 * just any label in the name.
 */
const AIRBNB_DOMAINS = [
  "airbnb.com",
  "airbnb.ca",
  "airbnb.co.uk",
  "airbnb.com.au",
  "airbnb.de",
  "airbnb.fr",
  "airbnb.es",
  "airbnb.it",
  "airbnb.nl",
  "airbnb.ie",
  "airbnb.mx",
  "airbnb.pt",
  "airbnb.at",
  "airbnb.ch",
  "airbnb.dk",
  "airbnb.se",
];

function hostIsAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, ""); // strip trailing dot
  return AIRBNB_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * SSRF guard: accept only https:// URLs, with no embedded credentials, whose
 * hostname is one of the registrable Airbnb domains above (or a subdomain of
 * one). Re-run on every redirect hop — see fetchIcsWithTimeout.
 */
function isAllowedRemoteIcalUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Reject user:pass@host forms that can confuse allowlist reasoning.
  if (url.username || url.password) return false;
  return hostIsAllowed(url.hostname);
}

async function fetchIcsWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so the SSRF allowlist is re-checked on EVERY
    // hop. With the default redirect:"follow", the guard would only inspect
    // the first URL and an allowed host could 30x us onto an internal target.
    let currentUrl = url;
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "CleanTurn/1.0 (+localhost sync)" },
      });
      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) {
          throw new Error("iCal fetch exceeded redirect limit");
        }
        const location = res.headers.get("location");
        if (!location) {
          throw new Error("iCal redirect response missing Location header");
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isAllowedRemoteIcalUrl(nextUrl)) {
          throw new Error("Refused to follow iCal redirect: SSRF guard rejected target");
        }
        currentUrl = nextUrl;
        continue;
      }
      break;
    }
    if (!res.ok) {
      throw new Error(`iCal fetch failed with status ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new Error("iCal response exceeded 1MB cap");
      }
      return text;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          throw new Error("iCal response exceeded 1MB cap");
        }
        chunks.push(value);
      }
    }
    const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return combined.toString("utf-8");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchIcsWithRetry(url: string): Promise<string> {
  try {
    return await fetchIcsWithTimeout(url);
  } catch (firstErr) {
    try {
      return await fetchIcsWithTimeout(url);
    } catch (secondErr) {
      throw secondErr instanceof Error ? secondErr : new Error(String(firstErr));
    }
  }
}

/**
 * Get the raw ICS text for a property. Local short-circuit: if the URL
 * contains /api/dev/ical/, generate the ICS in-process from lib/fixtures.ts
 * instead of making an HTTP request — but still run the result through
 * lib/ical.ts so the parser is exercised.
 */
async function getIcsTextForProperty(icalUrl: string): Promise<string> {
  const marker = LOCAL_SHORT_CIRCUIT_MARKER;
  const idx = icalUrl.indexOf(marker);
  if (idx !== -1) {
    const key = icalUrl.slice(idx + marker.length).split(/[/?#]/)[0];
    const events = demoEvents(key, todayStr());
    return eventsToIcs(events);
  }

  if (!isAllowedRemoteIcalUrl(icalUrl)) {
    throw new Error("Refused to fetch iCal URL: SSRF guard rejected host/protocol");
  }

  return fetchIcsWithRetry(icalUrl);
}

async function loadExistingBookingsForProperty(
  propertyId: string
): Promise<ExistingBooking[]> {
  const bookings = await prisma.booking.findMany({
    where: { propertyId },
    include: { job: true },
  });

  return bookings.map((b) => ({
    id: b.id,
    icalUid: b.icalUid,
    checkinDate: b.checkinDate,
    checkoutDate: b.checkoutDate,
    status: b.status as "active" | "cancelled",
    job: b.job
      ? {
          id: b.job.id,
          status: b.job.status,
          cleanerId: b.job.cleanerId,
        }
      : null,
  }));
}

async function applyCreates(
  propertyId: string,
  cleanCostCents: number,
  creates: { icalUid: string; checkinDate: string; checkoutDate: string }[]
): Promise<number> {
  let count = 0;
  for (const c of creates) {
    // Guard against a rare race/duplicate within the same run.
    const existing = await prisma.booking.findUnique({
      where: { propertyId_icalUid: { propertyId, icalUid: c.icalUid } },
    });
    if (existing) continue;

    const booking = await prisma.booking.create({
      data: {
        propertyId,
        icalUid: c.icalUid,
        checkinDate: c.checkinDate,
        checkoutDate: c.checkoutDate,
        status: "active",
      },
    });

    await prisma.job.create({
      data: {
        bookingId: booking.id,
        propertyId,
        date: c.checkoutDate,
        costCents: cleanCostCents,
        status: "unassigned",
      },
    });

    count++;
  }
  return count;
}

async function applyMoves(
  moves: {
    bookingId: string;
    jobId: string;
    newCheckinDate: string;
    newCheckoutDate: string;
    resetDoneJob: boolean;
  }[]
): Promise<number> {
  let count = 0;
  for (const m of moves) {
    await prisma.booking.update({
      where: { id: m.bookingId },
      data: {
        checkinDate: m.newCheckinDate,
        checkoutDate: m.newCheckoutDate,
      },
    });

    if (m.resetDoneJob) {
      await prisma.job.update({
        where: { id: m.jobId },
        data: {
          date: m.newCheckoutDate,
          status: "assigned",
          arrivedAt: null,
          leftAt: null,
          cleanedAt: null,
        },
      });
    } else {
      await prisma.job.update({
        where: { id: m.jobId },
        data: {
          date: m.newCheckoutDate,
        },
      });
    }

    count++;

    const job = await prisma.job.findUnique({
      where: { id: m.jobId },
      select: { cleanerId: true, status: true },
    });
    if (job?.cleanerId && job.status !== "cancelled") {
      await notifyCleaner("job_moved", m.jobId);
    }
  }
  return count;
}

async function applyCancels(
  cancels: { bookingId: string; jobId: string; hadAssignedCleaner: boolean }[]
): Promise<number> {
  let count = 0;
  for (const c of cancels) {
    await prisma.booking.update({
      where: { id: c.bookingId },
      data: { status: "cancelled" },
    });
    await prisma.job.update({
      where: { id: c.jobId },
      data: { status: "cancelled" },
    });
    count++;

    if (c.hadAssignedCleaner) {
      await notifyCleaner("job_cancelled", c.jobId);
    }
  }
  return count;
}

async function recomputeSameDayForProperty(propertyId: string, today: string): Promise<void> {
  const activeBookings = await prisma.booking.findMany({
    where: { propertyId, status: "active" },
    select: { propertyId: true, checkinDate: true, status: true },
  });

  const futureJobs = await prisma.job.findMany({
    where: {
      propertyId,
      date: { gte: today },
      status: { not: "cancelled" },
    },
    select: { id: true, propertyId: true, date: true },
  });

  const jobInputs: SameDayJobInput[] = futureJobs.map((j) => ({
    id: j.id,
    propertyId: j.propertyId,
    date: j.date,
  }));
  const bookingInputs: SameDayBookingInput[] = activeBookings.map((b) => ({
    propertyId: b.propertyId,
    checkinDate: b.checkinDate,
    status: b.status as "active" | "cancelled",
  }));

  const results = computeSameDay(jobInputs, bookingInputs);

  for (const r of results) {
    await prisma.job.update({
      where: { id: r.jobId },
      data: {
        sameDayTurnover: r.sameDayTurnover,
        nextCheckinNote: r.nextCheckinNote,
      },
    });
  }
}

async function maybeNotifyFeedError(propertyId: string, nickname: string): Promise<void> {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property || property.syncStatus !== "error") return;

  // "failing for > 6h": use updatedAt-less signal — we approximate using
  // lastSyncAt (last time it was healthy) vs now. If lastSyncAt is null
  // (never synced OK, e.g. a brand-new property whose first sync failed),
  // fall back to createdAt so we still wait the full 6h before alerting
  // instead of alerting immediately on first-ever failure.
  const sinceHealthy = property.lastSyncAt
    ? Date.now() - property.lastSyncAt.getTime()
    : Date.now() - property.createdAt.getTime();

  if (sinceHealthy < FEED_ERROR_ALERT_THRESHOLD_MS) return;

  const dedupeMarker = `feed-error:${propertyId}`;

  const recentAlert = await prisma.notificationLog.findFirst({
    where: {
      template: "admin_alert",
      recipient: "admin",
      status: "sent",
      error: dedupeMarker,
      createdAt: { gte: new Date(Date.now() - ADMIN_ALERT_LOOKBACK_MS) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentAlert) return;

  await notifyAdmin(`Feed error for "${nickname}" has persisted over 6h. Check its iCal URL.`);

  // Stamp a dedupe marker on the row we just wrote (best-effort; ignore
  // errors since notify already logged the primary row).
  try {
    const latest = await prisma.notificationLog.findFirst({
      where: { template: "admin_alert", recipient: "admin" },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      await prisma.notificationLog.update({
        where: { id: latest.id },
        data: { error: dedupeMarker },
      });
    }
  } catch {
    // non-fatal
  }
}

async function maybeNotifyUnassignedDigest(today: string): Promise<void> {
  const cutoff = addDays(today, UNASSIGNED_WINDOW_DAYS);

  const unassignedCount = await prisma.job.count({
    where: {
      status: "unassigned",
      date: { gte: today, lte: cutoff },
    },
  });

  if (unassignedCount === 0) return;

  const dedupeMarker = "unassigned-digest";
  const recentAlert = await prisma.notificationLog.findFirst({
    where: {
      template: "admin_alert",
      recipient: "admin",
      error: dedupeMarker,
      createdAt: { gte: new Date(Date.now() - ADMIN_ALERT_LOOKBACK_MS) },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentAlert) return;

  await notifyAdmin(
    `${unassignedCount} clean${unassignedCount === 1 ? "" : "s"} unassigned in the next 48 hours.`
  );

  try {
    const latest = await prisma.notificationLog.findFirst({
      where: { template: "admin_alert", recipient: "admin" },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      await prisma.notificationLog.update({
        where: { id: latest.id },
        data: { error: dedupeMarker },
      });
    }
  } catch {
    // non-fatal
  }
}

/**
 * runSync(): iterate active properties sequentially, reconcile bookings
 * against the freshly parsed calendar feed, apply changes via prisma,
 * recompute same-day flags, and fire admin alerts. Returns aggregate
 * counts. Never throws — a single property's failure is recorded on that
 * property (syncStatus/syncError) and counted as an error, and the loop
 * continues.
 */
export async function runSync(): Promise<SyncCounts> {
  const today = todayStr();
  const counts: SyncCounts = { created: 0, moved: 0, cancelled: 0, errors: 0 };

  const properties = await prisma.property.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });

  for (const property of properties) {
    try {
      const icsText = await getIcsTextForProperty(property.icalUrl);
      const parsedEvents: ParsedBookingEvent[] = parseIcs(icsText);

      const existingBookings = await loadExistingBookingsForProperty(property.id);

      const { creates, moves, cancels } = reconcile(existingBookings, parsedEvents, today);

      counts.created += await applyCreates(property.id, property.cleanCostCents, creates);
      counts.moved += await applyMoves(moves);
      counts.cancelled += await applyCancels(cancels);

      await recomputeSameDayForProperty(property.id, today);

      await prisma.property.update({
        where: { id: property.id },
        data: {
          syncStatus: "ok",
          syncError: null,
          lastSyncAt: new Date(),
        },
      });
    } catch (err) {
      counts.errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      try {
        await prisma.property.update({
          where: { id: property.id },
          data: {
            syncStatus: "error",
            syncError: message,
          },
        });
      } catch (updateErr) {
        console.error(`[sync] failed to record error for property ${property.id}:`, updateErr);
      }
      console.error(`[sync] property ${property.id} (${property.nickname}) failed:`, message);
    }
  }

  // Admin alerts, after all properties processed.
  try {
    const failingProperties = await prisma.property.findMany({
      where: { active: true, syncStatus: "error" },
    });
    for (const p of failingProperties) {
      await maybeNotifyFeedError(p.id, p.nickname);
    }
  } catch (err) {
    console.error("[sync] admin feed-error alert pass failed:", err);
  }

  try {
    await maybeNotifyUnassignedDigest(today);
  } catch (err) {
    console.error("[sync] admin unassigned-digest alert pass failed:", err);
  }

  return counts;
}
