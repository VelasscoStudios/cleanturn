// Integration tests for the sync circuit breaker, replaying the four prod
// properties that got stuck on 2026-11-10 with "feed would cancel N of M
// future booking(s) in one run; refusing to reconcile" / "feed returned 0
// events ...". Real Prisma against a throwaway SQLite DB; only the network
// (fetch to Airbnb) and the admin session are faked.
import { TEST_DB_PATH } from "./helpers/syncTestEnv";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireAdminApi: vi.fn() };
});

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { runSync } from "@/lib/sync";
import { GET, POST } from "@/app/api/properties/[id]/cancellations/route";

const REPO_ROOT = path.resolve(__dirname, "..");
// 2026-11-10 in America/Edmonton — the day the error was reported.
const NOW = new Date("2026-11-11T05:00:00Z");

type Ev = { uid: string; start: string; end: string; summary?: string };

function ics(events: Ev[]): string {
  const d = (s: string) => s.replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN", "CALSCALE:GREGORIAN", "VERSION:2.0"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `DTEND;VALUE=DATE:${d(e.end)}`,
      `DTSTART;VALUE=DATE:${d(e.start)}`,
      `UID:${e.uid}`,
      `SUMMARY:${e.summary ?? "Reserved"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
const blocked = (uid: string, start: string, end: string): Ev => ({ uid, start, end, summary: "Airbnb (Not available)" });

/** url -> body served by the fake fetch */
const feeds = new Map<string, string>();
let seq = 0;

async function makeProperty(nickname: string) {
  const owner = await prisma.owner.create({ data: { name: "Owner", email: "o@test.local" } });
  const url = `https://www.airbnb.ca/calendar/ical/${Date.now()}${seq++}.ics?s=test`;
  return prisma.property.create({
    data: {
      ownerId: owner.id,
      nickname,
      address: nickname,
      icalUrl: url,
      cleanCostCents: 5000,
      arriveTime: "11:00",
      outByTime: "16:00",
      syncStatus: "ok",
      lastSyncAt: new Date("2026-10-31T00:00:00Z"),
    },
  });
}

async function addBooking(propertyId: string, uid: string, checkin: string, checkout: string, cleanerId: string | null = null) {
  return prisma.booking.create({
    data: {
      propertyId,
      icalUid: uid,
      checkinDate: checkin,
      checkoutDate: checkout,
      status: "active",
      job: { create: { propertyId, date: checkout, costCents: 5000, cleanerId } },
    },
  });
}

async function state(propertyId: string) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const bookings = await prisma.booking.findMany({
    where: { propertyId },
    include: { job: true },
    orderBy: { checkoutDate: "asc" },
  });
  const by = Object.fromEntries(bookings.map((b) => [b.icalUid, { status: b.status, job: b.job?.status, date: b.job?.date }]));
  return { p, by };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(() => {
  execSync("npx prisma migrate deploy", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.mocked(requireAdminApi).mockResolvedValue({ adminId: "a1" } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = feeds.get(String(url));
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
    })
  );
  // Each test owns the whole DB: runSync iterates every active property.
  await prisma.job.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.property.deleteMany();
  await prisma.owner.deleteMany();
  feeds.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prod replay: Bowness / Killarney (last reservation cancelled, feed only has blocks)", () => {
  it("before: tripped '0 events'. now: a feed with only 'Not available' blocks is healthy and the cancel applies", async () => {
    const prop = await makeProperty("8703 34 Ave NW - Unit 3435R (Bowness)");
    await addBooking(prop.id, "e98ca9dd0cfda@airbnb.com", "2026-12-26", "2026-12-29");
    feeds.set(prop.icalUrl, ics([blocked("67d7da4d22e0c@airbnb.com", "2027-08-07", "2027-11-12")]));

    const counts = await runSync();

    const { p, by } = await state(prop.id);
    expect(p.syncStatus).toBe("ok");
    expect(p.syncError).toBeNull();
    expect(by["e98ca9dd0cfda@airbnb.com"]).toMatchObject({ status: "cancelled", job: "cancelled" });
    expect(counts).toMatchObject({ cancelled: 1, errors: 0 });
  });

  it("long stay (Jan 1–Apr 30) disappearing behind blocks also applies", async () => {
    const prop = await makeProperty("3310 21 Ave SW - Unit 3304B (Killarney)");
    await addBooking(prop.id, "264e17ed4126b@airbnb.com", "2027-01-01", "2027-04-30");
    feeds.set(
      prop.icalUrl,
      ics([blocked("f067d3c463d9b@airbnb.com", "2026-11-09", "2027-01-01"), blocked("67d7da4d22e0c@airbnb.com", "2027-08-07", "2027-11-12")])
    );

    await runSync();

    const { p, by } = await state(prop.id);
    expect(p.syncStatus).toBe("ok");
    expect(by["264e17ed4126b@airbnb.com"].status).toBe("cancelled");
  });
});

describe("prod replay: 1836 17 Ave NW Unit 2 (4 of 6 future stays gone in one run)", () => {
  it("holds the 4 cancels (status error, bookings untouched), then the admin applies them via the review endpoint", async () => {
    const prop = await makeProperty("1836 17 Ave NW - Unit 2 (Capitol Hill)");
    const cleaner = await prisma.cleaner.create({ data: { name: "OKSANA", phone: `+1${Date.now()}`, pinHash: "x" } });
    const gone = [
      await addBooking(prop.id, "00b944faddb4f@airbnb.com", "2026-12-10", "2026-12-13", cleaner.id),
      await addBooking(prop.id, "646f7f0187556@airbnb.com", "2026-12-19", "2026-12-20"),
      await addBooking(prop.id, "4fb47ed74a148@airbnb.com", "2026-12-27", "2026-12-29"),
      await addBooking(prop.id, "0643b575eaa57@airbnb.com", "2026-12-29", "2026-12-30"),
    ];
    await addBooking(prop.id, "dfc0305dacb28@airbnb.com", "2027-03-16", "2027-03-21");
    await addBooking(prop.id, "15a02369b6980@airbnb.com", "2027-05-14", "2027-05-15");
    feeds.set(
      prop.icalUrl,
      ics([
        { uid: "dfc0305dacb28@airbnb.com", start: "2027-03-16", end: "2027-03-21" },
        { uid: "15a02369b6980@airbnb.com", start: "2027-05-14", end: "2027-05-15" },
        blocked("f067d3c463d9b@airbnb.com", "2026-11-09", "2027-02-13"),
      ])
    );

    // The exact prod symptom: breaker trips on 4 of 6.
    await runSync();
    let s = await state(prop.id);
    expect(s.p.syncStatus).toBe("error");
    expect(s.p.syncError).toMatch(/feed would cancel 4 of 6 future booking\(s\) in one run; holding cancellations/);
    expect(s.p.lastSyncAt?.toISOString()).toBe("2026-10-31T00:00:00.000Z"); // 6h alert clock not reset
    for (const b of gone) expect(s.by[b.icalUid].status).toBe("active");

    // Admin review: GET lists exactly the 4 vanished stays.
    const preview = await (await GET(new Request("http://localhost/x"), params(prop.id))).json();
    expect(preview.cancellations.map((c: { checkoutDate: string }) => c.checkoutDate)).toEqual([
      "2026-12-13",
      "2026-12-20",
      "2026-12-29",
      "2026-12-30",
    ]);
    expect(preview.cancellations[0].cleanerName).toBe("OKSANA");

    // Admin confirms.
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ bookingIds: preview.cancellations.map((c: { bookingId: string }) => c.bookingId) }),
      }),
      params(prop.id)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cancelled: 4, held: 0 });

    s = await state(prop.id);
    expect(s.p.syncStatus).toBe("ok");
    for (const b of gone) expect(s.by[b.icalUid]).toMatchObject({ status: "cancelled", job: "cancelled" });
    expect(s.by["dfc0305dacb28@airbnb.com"].status).toBe("active");
    expect(s.by["15a02369b6980@airbnb.com"].status).toBe("active");

    // And the next scheduled sync stays green.
    await runSync();
    expect((await state(prop.id)).p.syncStatus).toBe("ok");
  });

  it("approving only some ids keeps the rest held", async () => {
    const prop = await makeProperty("partial");
    const a = await addBooking(prop.id, "a@airbnb.com", "2026-12-01", "2026-12-03");
    await addBooking(prop.id, "b@airbnb.com", "2026-12-05", "2026-12-07");
    await addBooking(prop.id, "c@airbnb.com", "2026-12-09", "2026-12-11");
    feeds.set(prop.icalUrl, ics([blocked("blk@airbnb.com", "2027-08-01", "2027-11-01")]));

    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ bookingIds: [a.id] }),
      }),
      params(prop.id)
    );
    expect(await res.json()).toMatchObject({ cancelled: 1, held: 2 });
    const s = await state(prop.id);
    expect(s.p.syncStatus).toBe("error");
    expect(s.by["a@airbnb.com"].status).toBe("cancelled");
    expect(s.by["b@airbnb.com"].status).toBe("active");
  });
});

describe("prod replay: 4B, 412 12 AVE NE (3 of 3 gone AND 3 new reservations)", () => {
  it("before: the breaker also blocked the new bookings (Nov 16 checkout had no job). now: new bookings are created while cancels are held", async () => {
    const prop = await makeProperty("4B, 412 12 AVE NE");
    await addBooking(prop.id, "3c9b95de48ac0@airbnb.com", "2027-07-07", "2027-07-11");
    await addBooking(prop.id, "32d28951cc28e@airbnb.com", "2027-07-12", "2027-07-14");
    await addBooking(prop.id, "c8305142a5cd0@airbnb.com", "2027-07-15", "2027-07-18");
    feeds.set(
      prop.icalUrl,
      ics([
        { uid: "7c612b4ba1523@airbnb.com", start: "2026-11-09", end: "2026-11-10" },
        { uid: "f71e558345e0b@airbnb.com", start: "2026-11-13", end: "2026-11-16" },
        { uid: "68ed04b0719bb@airbnb.com", start: "2027-03-10", end: "2027-04-07" },
        blocked("40b52ebd863a1@airbnb.com", "2026-11-10", "2026-11-13"),
      ])
    );

    const counts = await runSync();

    const s = await state(prop.id);
    expect(s.p.syncStatus).toBe("error");
    expect(s.p.syncError).toMatch(/feed would cancel 3 of 3/);
    expect(counts.created).toBe(3);
    expect(s.by["f71e558345e0b@airbnb.com"]).toMatchObject({ status: "active", job: "assigned", date: "2026-11-16" });
    expect(s.by["68ed04b0719bb@airbnb.com"]).toMatchObject({ status: "active", date: "2027-04-07" });
    // The July stays are held, not cancelled.
    expect(s.by["3c9b95de48ac0@airbnb.com"].status).toBe("active");
    expect(s.by["c8305142a5cd0@airbnb.com"].status).toBe("active");
  });
});

describe("the breaker still protects against genuinely broken feeds", () => {
  it("an HTML error page served with 200 cancels nothing, and admin apply is refused", async () => {
    const prop = await makeProperty("broken");
    const b1 = await addBooking(prop.id, "x1@airbnb.com", "2026-12-01", "2026-12-03");
    await addBooking(prop.id, "x2@airbnb.com", "2026-12-05", "2026-12-07");
    feeds.set(prop.icalUrl, "<!doctype html><html><body>Something went wrong</body></html>");

    await runSync();
    let s = await state(prop.id);
    expect(s.p.syncStatus).toBe("error");
    expect(s.p.syncError).toMatch(/0 events/);
    expect(s.by["x1@airbnb.com"].status).toBe("active");
    expect(s.by["x2@airbnb.com"].status).toBe("active");

    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ bookingIds: [b1.id] }),
      }),
      params(prop.id)
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/not a complete calendar/);
    s = await state(prop.id);
    expect(s.by["x1@airbnb.com"].status).toBe("active");
  });

  it("a truncated feed (no END:VCALENDAR) with Reserved events gone still holds the cancels", async () => {
    const prop = await makeProperty("truncated");
    for (let i = 0; i < 4; i++) await addBooking(prop.id, `t${i}@airbnb.com`, `2026-12-0${i + 1}`, `2026-12-0${i + 2}`);
    const full = ics([{ uid: "t0@airbnb.com", start: "2026-12-01", end: "2026-12-02" }, blocked("blk@airbnb.com", "2027-08-01", "2027-11-01")]);
    feeds.set(prop.icalUrl, full.slice(0, full.indexOf("END:VCALENDAR")));

    await runSync();
    const s = await state(prop.id);
    expect(s.p.syncStatus).toBe("error");
    for (let i = 1; i < 4; i++) expect(s.by[`t${i}@airbnb.com`].status).toBe("active");
  });

  it("POST requires the fetch header and an admin", async () => {
    const prop = await makeProperty("auth");
    const noHeader = await POST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ bookingIds: ["x"] }) }),
      params(prop.id)
    );
    expect(noHeader.status).toBe(403);
    vi.mocked(requireAdminApi).mockResolvedValue(null as never);
    expect((await GET(new Request("http://localhost/x"), params(prop.id))).status).toBe(401);
  });
});
