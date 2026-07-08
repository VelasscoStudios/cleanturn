import type { ParsedBookingEvent } from "./ical";

/**
 * Minimal shape of an existing booking + its job, as needed by the pure
 * reconciliation logic. Callers (lib/sync.ts) map their Prisma rows into
 * this shape.
 */
export type ExistingBooking = {
  id: string;
  icalUid: string;
  checkinDate: string; // YYYY-MM-DD
  checkoutDate: string; // YYYY-MM-DD
  status: "active" | "cancelled";
  job: {
    id: string;
    status: string; // unassigned|assigned|in_progress|awaiting_confirm|done|cancelled
    cleanerId: string | null;
  } | null;
};

export type ReconcileCreate = {
  icalUid: string;
  checkinDate: string;
  checkoutDate: string;
};

export type ReconcileMove = {
  bookingId: string;
  jobId: string;
  newCheckinDate: string;
  newCheckoutDate: string;
  /** true when this move takes a done job's date into the future — job should reset to assigned + clear timestamps */
  resetDoneJob: boolean;
};

export type ReconcileCancel = {
  bookingId: string;
  jobId: string;
  hadAssignedCleaner: boolean;
};

export type ReconcileResult = {
  creates: ReconcileCreate[];
  moves: ReconcileMove[];
  cancels: ReconcileCancel[];
};

/**
 * PURE reconciliation of existing bookings against freshly parsed iCal
 * events for a single property. No I/O, no prisma. Rules (brief §9 / spec
 * §4.2):
 *
 *  - New UID                          -> create
 *  - Existing UID, checkin/checkout changed -> move (keep cleaner & status
 *    unless the job is done; a done job whose checkout moves to a future
 *    date gets reset to assigned with cleared timestamps by the caller)
 *  - UID disappeared from the feed, booking still active, checkout >= today
 *    -> cancel
 *  - Never touch a booking that is fully in the past (checkout < today),
 *    whether it disappeared or not.
 */
export function reconcile(
  existingBookings: ExistingBooking[],
  parsedEvents: ParsedBookingEvent[],
  todayStr: string
): ReconcileResult {
  const creates: ReconcileCreate[] = [];
  const moves: ReconcileMove[] = [];
  const cancels: ReconcileCancel[] = [];

  const existingByUid = new Map<string, ExistingBooking>();
  for (const b of existingBookings) {
    existingByUid.set(b.icalUid, b);
  }

  const eventsByUid = new Map<string, ParsedBookingEvent>();
  for (const e of parsedEvents) {
    eventsByUid.set(e.uid, e);
  }

  // New or moved bookings.
  for (const event of parsedEvents) {
    const existing = existingByUid.get(event.uid);

    if (!existing) {
      creates.push({
        icalUid: event.uid,
        checkinDate: event.checkin,
        checkoutDate: event.checkout,
      });
      continue;
    }

    if (existing.status === "cancelled") {
      // A cancelled booking reappearing with the same UID is not
      // reconstituted automatically — out of scope for this reconciler.
      continue;
    }

    const checkinChanged = existing.checkinDate !== event.checkin;
    const checkoutChanged = existing.checkoutDate !== event.checkout;

    if (!checkinChanged && !checkoutChanged) {
      continue; // no-op, nothing to reconcile
    }

    if (!existing.job) {
      // Shouldn't normally happen (booking always has a job), but guard.
      continue;
    }

    const wasDone = existing.job.status === "done";
    const movesToFuture = event.checkout >= todayStr;
    const resetDoneJob = wasDone && movesToFuture;

    moves.push({
      bookingId: existing.id,
      jobId: existing.job.id,
      newCheckinDate: event.checkin,
      newCheckoutDate: event.checkout,
      resetDoneJob,
    });
  }

  // Disappeared bookings -> cancel, unless fully in the past.
  for (const existing of existingBookings) {
    if (existing.status === "cancelled") continue;
    if (eventsByUid.has(existing.icalUid)) continue;

    const isFullyPast = existing.checkoutDate < todayStr;
    if (isFullyPast) continue; // never touch bookings fully in the past

    if (!existing.job) continue;
    if (existing.job.status === "cancelled") continue;

    cancels.push({
      bookingId: existing.id,
      jobId: existing.job.id,
      hadAssignedCleaner: existing.job.cleanerId != null,
    });
  }

  return {
    creates,
    moves,
    cancels,
  };
}

/**
 * Circuit breaker for broken feeds. A cancellation is inferred from a UID
 * *disappearing* from the feed, so a feed that comes back empty or gutted
 * (HTTP 200 with an error page, truncated body, changed SUMMARY wording) is
 * indistinguishable from "everything got cancelled" — and once applied,
 * cancellations are permanent (reconcile never reinstates a cancelled UID).
 * Refuse to reconcile when the feed looks broken; the caller records it as a
 * feed error so the existing 6h admin alert path picks it up.
 *
 * Returns a human-readable reason, or null when the reconcile looks safe.
 */
export function feedSafetyError(
  existingBookings: ExistingBooking[],
  parsedEventCount: number,
  cancelCount: number,
  todayStr: string
): string | null {
  const futureActive = existingBookings.filter(
    (b) =>
      b.status === "active" &&
      b.checkoutDate >= todayStr &&
      b.job !== null &&
      b.job.status !== "cancelled"
  ).length;

  if (futureActive === 0) return null;

  if (parsedEventCount === 0) {
    return `feed returned 0 events while ${futureActive} future booking(s) are active; refusing to reconcile`;
  }

  // Guests cancel one at a time; a single run wiping out most of a calendar
  // is far more likely a broken feed than a mass exodus. Threshold of 3 keeps
  // small properties (1-2 future bookings) able to cancel legitimately.
  if (cancelCount >= 3 && cancelCount * 2 > futureActive) {
    return `feed would cancel ${cancelCount} of ${futureActive} future booking(s) in one run; refusing to reconcile`;
  }

  return null;
}

/**
 * Coalesce concurrent invocations of an async task: while one run is in
 * flight, further calls join it (receiving the same promise) instead of
 * starting a second run. Once settled, the next call starts fresh.
 */
export function createCoalescer<T>(): (fn: () => Promise<T>) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (fn) => {
    if (inFlight) return inFlight;
    const run = Promise.resolve()
      .then(fn)
      .finally(() => {
        inFlight = null;
      });
    inFlight = run;
    return run;
  };
}

/**
 * Minimal job shape needed for same-day-turnover computation.
 */
export type SameDayJobInput = {
  id: string;
  propertyId: string;
  date: string; // YYYY-MM-DD, == booking checkout
};

export type SameDayBookingInput = {
  propertyId: string;
  checkinDate: string; // YYYY-MM-DD
  status: "active" | "cancelled";
};

export type SameDayResult = {
  jobId: string;
  sameDayTurnover: boolean;
  nextCheckinNote: string | null;
};

/**
 * Compute the same-day-turnover flag for a set of jobs against the set of
 * currently-active bookings for the same properties. same-day = another
 * active booking at the same property has checkin == job.date.
 */
export function computeSameDay(
  jobs: SameDayJobInput[],
  activeBookings: SameDayBookingInput[]
): SameDayResult[] {
  // Map propertyId -> set of checkin dates for active bookings.
  const checkinsByProperty = new Map<string, Set<string>>();
  for (const b of activeBookings) {
    if (b.status !== "active") continue;
    let set = checkinsByProperty.get(b.propertyId);
    if (!set) {
      set = new Set();
      checkinsByProperty.set(b.propertyId, set);
    }
    set.add(b.checkinDate);
  }

  return jobs.map((job) => {
    const checkins = checkinsByProperty.get(job.propertyId);
    const sameDayTurnover = checkins ? checkins.has(job.date) : false;
    return {
      jobId: job.id,
      sameDayTurnover,
      // Airbnb date-only feeds carry no check-in time, so there is nothing
      // useful to add beyond the same-day flag itself; UI renders the flag
      // alone when the note is null.
      nextCheckinNote: null,
    };
  });
}
