import { describe, it, expect } from "vitest";
import { parseIcs } from "../lib/ical";
import {
  reconcile,
  computeSameDay,
  feedSafetyError,
  createCoalescer,
  type ExistingBooking,
} from "../lib/sync-core";

const TODAY = "2026-07-06";

function icsWith(events: { uid: string; start: string; end: string; summary: string }[]): string {
  const toIcsDate = (d: string) => d.replace(/-/g, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTART;VALUE=DATE:${toIcsDate(e.start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(e.end)}`,
      `SUMMARY:${e.summary}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

describe("parseIcs", () => {
  it("parses Reserved events into {uid, checkin, checkout}", () => {
    const ics = icsWith([
      { uid: "abc-1@cleanturn.demo", start: "2026-07-01", end: "2026-07-05", summary: "Reserved" },
    ]);
    const events = parseIcs(ics);
    expect(events).toEqual([
      { uid: "abc-1@cleanturn.demo", checkin: "2026-07-01", checkout: "2026-07-05" },
    ]);
  });

  it("ignores 'Airbnb (Not available)' blocks", () => {
    const ics = icsWith([
      { uid: "abc-1@cleanturn.demo", start: "2026-07-01", end: "2026-07-05", summary: "Reserved" },
      { uid: "blocked-1@cleanturn.demo", start: "2026-07-05", end: "2026-07-06", summary: "Airbnb (Not available)" },
    ]);
    const events = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("abc-1@cleanturn.demo");
  });

  it("returns an empty array when there are no Reserved events", () => {
    const ics = icsWith([
      { uid: "blocked-1@cleanturn.demo", start: "2026-07-05", end: "2026-07-06", summary: "Airbnb (Not available)" },
    ]);
    expect(parseIcs(ics)).toEqual([]);
  });

  it("parses multiple Reserved events, preserving order", () => {
    const ics = icsWith([
      { uid: "a@cleanturn.demo", start: "2026-07-01", end: "2026-07-03", summary: "Reserved" },
      { uid: "b@cleanturn.demo", start: "2026-07-03", end: "2026-07-06", summary: "Reserved" },
    ]);
    const events = parseIcs(ics);
    expect(events.map((e) => e.uid)).toEqual(["a@cleanturn.demo", "b@cleanturn.demo"]);
  });
});

function booking(overrides: Partial<ExistingBooking>): ExistingBooking {
  return {
    id: "booking-1",
    icalUid: "uid-1",
    checkinDate: "2026-07-01",
    checkoutDate: "2026-07-05",
    status: "active",
    job: { id: "job-1", status: "assigned", cleanerId: "cleaner-1" },
    ...overrides,
  };
}

describe("reconcile — new bookings", () => {
  it("creates a booking for a brand-new UID", () => {
    const result = reconcile([], [{ uid: "new-1", checkin: "2026-07-10", checkout: "2026-07-14" }], TODAY);
    expect(result.creates).toEqual([
      { icalUid: "new-1", checkinDate: "2026-07-10", checkoutDate: "2026-07-14" },
    ]);
    expect(result.moves).toEqual([]);
    expect(result.cancels).toEqual([]);
  });
});

describe("reconcile — moved bookings", () => {
  it("detects a checkout date change and keeps cleaner/status (non-completed job)", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-01",
        checkoutDate: "2026-07-05",
        job: { id: "job-1", status: "assigned", cleanerId: "cleaner-1" },
      }),
    ];
    const events = [{ uid: "uid-1", checkin: "2026-07-01", checkout: "2026-07-07" }];
    const result = reconcile(existing, events, TODAY);

    expect(result.creates).toEqual([]);
    expect(result.cancels).toEqual([]);
    expect(result.moves).toEqual([
      {
        bookingId: "booking-1",
        jobId: "job-1",
        newCheckinDate: "2026-07-01",
        newCheckoutDate: "2026-07-07",
        resetCompletedJob: false,
      },
    ]);
  });

  it("flags resetCompletedJob when a completed job's checkout moves into the future", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-01",
        checkoutDate: "2026-07-03",
        job: { id: "job-1", status: "completed", cleanerId: "cleaner-1" },
      }),
    ];
    // Moves to a date in the future relative to TODAY.
    const events = [{ uid: "uid-1", checkin: "2026-07-01", checkout: "2026-07-20" }];
    const result = reconcile(existing, events, TODAY);

    expect(result.moves).toEqual([
      {
        bookingId: "booking-1",
        jobId: "job-1",
        newCheckinDate: "2026-07-01",
        newCheckoutDate: "2026-07-20",
        resetCompletedJob: true,
      },
    ]);
  });

  it("does not flag resetCompletedJob when a completed job's checkout changes but stays in the past", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-06-01",
        checkoutDate: "2026-06-03",
        job: { id: "job-1", status: "completed", cleanerId: "cleaner-1" },
      }),
    ];
    const events = [{ uid: "uid-1", checkin: "2026-06-01", checkout: "2026-06-04" }];
    const result = reconcile(existing, events, TODAY);

    expect(result.moves).toEqual([
      {
        bookingId: "booking-1",
        jobId: "job-1",
        newCheckinDate: "2026-06-01",
        newCheckoutDate: "2026-06-04",
        resetCompletedJob: false,
      },
    ]);
  });

  it("detects a checkin-only change too", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-01",
        checkoutDate: "2026-07-05",
        job: { id: "job-1", status: "assigned", cleanerId: null },
      }),
    ];
    const events = [{ uid: "uid-1", checkin: "2026-07-02", checkout: "2026-07-05" }];
    const result = reconcile(existing, events, TODAY);
    expect(result.moves).toHaveLength(1);
    expect(result.moves[0].newCheckinDate).toBe("2026-07-02");
  });
});

describe("reconcile — cancelled bookings", () => {
  it("cancels a booking whose UID disappeared and checkout is today or future", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-03",
        checkoutDate: "2026-07-08",
        job: { id: "job-1", status: "assigned", cleanerId: "cleaner-1" },
      }),
    ];
    const result = reconcile(existing, [], TODAY);
    expect(result.cancels).toEqual([
      { bookingId: "booking-1", jobId: "job-1", hadAssignedCleaner: true },
    ]);
  });

  it("reports hadAssignedCleaner: false when no cleaner was assigned", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-03",
        checkoutDate: "2026-07-08",
        job: { id: "job-1", status: "assigned", cleanerId: null },
      }),
    ];
    const result = reconcile(existing, [], TODAY);
    expect(result.cancels).toEqual([
      { bookingId: "booking-1", jobId: "job-1", hadAssignedCleaner: false },
    ]);
  });

  it("never touches a booking that is fully in the past, even if its UID disappeared", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-06-01",
        checkoutDate: "2026-06-05", // < TODAY
        job: { id: "job-1", status: "completed", cleanerId: "cleaner-1" },
      }),
    ];
    const result = reconcile(existing, [], TODAY);
    expect(result.cancels).toEqual([]);
    expect(result.moves).toEqual([]);
    expect(result.creates).toEqual([]);
  });

  it("does not cancel a booking that is already cancelled", () => {
    const existing = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-03",
        checkoutDate: "2026-07-08",
        status: "cancelled",
        job: { id: "job-1", status: "cancelled", cleanerId: null },
      }),
    ];
    const result = reconcile(existing, [], TODAY);
    expect(result.cancels).toEqual([]);
  });
});

describe("reconcile — idempotency", () => {
  it("running reconcile a second time with the resulting state as 'existing' yields zero actions", () => {
    // First run: new booking appears.
    const events = [{ uid: "uid-1", checkin: "2026-07-10", checkout: "2026-07-14" }];
    const first = reconcile([], events, TODAY);
    expect(first.creates).toHaveLength(1);

    // Simulate applying the create, then reconciling again against the
    // same events (as a real duplicate-run would).
    const existingAfterFirstRun: ExistingBooking[] = [
      booking({
        icalUid: "uid-1",
        checkinDate: "2026-07-10",
        checkoutDate: "2026-07-14",
        job: { id: "job-1", status: "assigned", cleanerId: null },
      }),
    ];

    const second = reconcile(existingAfterFirstRun, events, TODAY);
    expect(second.creates).toEqual([]);
    expect(second.moves).toEqual([]);
    expect(second.cancels).toEqual([]);
  });

  it("a full duplicate run (same bookings + same events) is a total no-op across multiple bookings", () => {
    const existing: ExistingBooking[] = [
      booking({
        id: "b1",
        icalUid: "uid-1",
        checkinDate: "2026-07-01",
        checkoutDate: "2026-07-05",
        job: { id: "job-1", status: "completed", cleanerId: "cleaner-1" },
      }),
      booking({
        id: "b2",
        icalUid: "uid-2",
        checkinDate: "2026-07-10",
        checkoutDate: "2026-07-14",
        job: { id: "job-2", status: "assigned", cleanerId: "cleaner-2" },
      }),
    ];
    const events = [
      { uid: "uid-1", checkin: "2026-07-01", checkout: "2026-07-05" },
      { uid: "uid-2", checkin: "2026-07-10", checkout: "2026-07-14" },
    ];
    const result = reconcile(existing, events, TODAY);
    expect(result).toEqual({ creates: [], moves: [], cancels: [] });
  });
});

describe("computeSameDay", () => {
  it("flags a job whose date matches another active booking's checkin at the same property", () => {
    const jobs = [{ id: "job-1", propertyId: "prop-1", date: "2026-07-05" }];
    const activeBookings = [
      { propertyId: "prop-1", checkinDate: "2026-07-05", status: "active" as const },
    ];
    const result = computeSameDay(jobs, activeBookings);
    expect(result).toEqual([
      { jobId: "job-1", sameDayTurnover: true, nextCheckinNote: null },
    ]);
  });

  it("does not flag when no booking checks in on that date", () => {
    const jobs = [{ id: "job-1", propertyId: "prop-1", date: "2026-07-05" }];
    const activeBookings = [
      { propertyId: "prop-1", checkinDate: "2026-07-06", status: "active" as const },
    ];
    const result = computeSameDay(jobs, activeBookings);
    expect(result).toEqual([
      { jobId: "job-1", sameDayTurnover: false, nextCheckinNote: null },
    ]);
  });

  it("does not flag same-day using a booking at a different property", () => {
    const jobs = [{ id: "job-1", propertyId: "prop-1", date: "2026-07-05" }];
    const activeBookings = [
      { propertyId: "prop-2", checkinDate: "2026-07-05", status: "active" as const },
    ];
    const result = computeSameDay(jobs, activeBookings);
    expect(result[0].sameDayTurnover).toBe(false);
  });

  it("ignores cancelled bookings when computing same-day turnover", () => {
    const jobs = [{ id: "job-1", propertyId: "prop-1", date: "2026-07-05" }];
    const activeBookings = [
      { propertyId: "prop-1", checkinDate: "2026-07-05", status: "cancelled" as const },
    ];
    const result = computeSameDay(jobs, activeBookings);
    expect(result[0].sameDayTurnover).toBe(false);
  });
});

describe("feedSafetyError (mass-cancel circuit breaker)", () => {
  function activeBooking(uid: string, checkout: string, jobStatus = "assigned"): ExistingBooking {
    return {
      id: `b-${uid}`,
      icalUid: uid,
      checkinDate: "2026-07-01",
      checkoutDate: checkout,
      status: "active",
      job: { id: `j-${uid}`, status: jobStatus, cleanerId: null },
    };
  }

  it("refuses an empty feed when future active bookings exist", () => {
    const existing = [activeBooking("u1", "2026-07-10")];
    const reason = feedSafetyError(existing, 0, 1, TODAY);
    expect(reason).toMatch(/0 events/);
  });

  it("allows an empty feed when there is nothing future to protect", () => {
    // Only past bookings — a genuinely empty calendar must still sync ok.
    const existing = [activeBooking("u1", "2026-06-01")];
    expect(feedSafetyError(existing, 0, 0, TODAY)).toBeNull();
  });

  it("allows an empty feed on a property with no bookings at all", () => {
    expect(feedSafetyError([], 0, 0, TODAY)).toBeNull();
  });

  it("refuses a run that would cancel most of the future calendar", () => {
    const existing = [
      activeBooking("u1", "2026-07-10"),
      activeBooking("u2", "2026-07-15"),
      activeBooking("u3", "2026-07-20"),
      activeBooking("u4", "2026-07-25"),
    ];
    // 3 of 4 cancelled in one run — feed almost certainly broken.
    const reason = feedSafetyError(existing, 1, 3, TODAY);
    expect(reason).toMatch(/cancel 3 of 4/);
  });

  it("allows small legitimate cancellations (1-2 in a run)", () => {
    const existing = [
      activeBooking("u1", "2026-07-10"),
      activeBooking("u2", "2026-07-15"),
    ];
    expect(feedSafetyError(existing, 1, 1, TODAY)).toBeNull();
    // Even both bookings of a tiny calendar: below the >=3 threshold.
    expect(feedSafetyError(existing, 0, 2, TODAY)).toMatch(/0 events/); // empty feed still refused
    expect(feedSafetyError(existing, 1, 2, TODAY)).toBeNull();
  });

  it("allows many cancels when they are a minority of a big calendar", () => {
    const existing = Array.from({ length: 10 }, (_, i) =>
      activeBooking(`u${i}`, "2026-07-20")
    );
    expect(feedSafetyError(existing, 7, 3, TODAY)).toBeNull();
  });

  it("does not count cancelled or past bookings toward the future-active base", () => {
    const cancelled: ExistingBooking = {
      ...activeBooking("u1", "2026-07-10"),
      status: "cancelled",
    };
    const past = activeBooking("u2", "2026-06-01");
    // No future-active bookings -> nothing to protect, empty feed fine.
    expect(feedSafetyError([cancelled, past], 0, 0, TODAY)).toBeNull();
  });
});

describe("createCoalescer", () => {
  it("coalesces concurrent calls into one run", async () => {
    const coalesce = createCoalescer<number>();
    let runs = 0;
    let release: (v: number) => void = () => {};
    const gate = new Promise<number>((r) => (release = r));
    const fn = () => {
      runs++;
      return gate;
    };

    const p1 = coalesce(fn);
    const p2 = coalesce(fn);
    release(42);
    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(runs).toBe(1);
  });

  it("runs again after the previous run settles", async () => {
    const coalesce = createCoalescer<number>();
    let runs = 0;
    const fn = async () => ++runs;
    expect(await coalesce(fn)).toBe(1);
    expect(await coalesce(fn)).toBe(2);
    expect(runs).toBe(2);
  });

  it("clears the in-flight slot after a rejection", async () => {
    const coalesce = createCoalescer<number>();
    await expect(coalesce(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await coalesce(async () => 7)).toBe(7);
  });
});
