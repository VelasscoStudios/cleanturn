import { PrismaClient, type Cleaner } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  demoOwners,
  demoProperties,
  demoEvents,
  type DemoEvent,
} from "../lib/fixtures";

const prisma = new PrismaClient();

function todayStr(): string {
  const tz = process.env.APP_TIMEZONE || "America/Edmonton";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

const CLEANERS = [
  { name: "Maria", phone: "+15550101", pin: "111111" },
  { name: "Sofia", phone: "+15550102", pin: "222222" },
  { name: "Ana", phone: "+15550103", pin: "333333" },
  { name: "Lucia", phone: "+15550104", pin: "444444" },
  { name: "Carmen", phone: "+15550105", pin: "555555" },
];

async function main() {
  const existingAdmin = await prisma.adminUser.findFirst();
  if (existingAdmin) {
    console.log("AdminUser already exists — skipping seed entirely.");
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";

  // The dev fallbacks below are published in this repo, so they are only
  // acceptable on a local machine. In production both values must be set
  // explicitly, and the password must not be a known default.
  if (isProduction && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_INITIAL_PASSWORD)) {
    throw new Error(
      "Refusing to seed in production without explicit ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD env vars.",
    );
  }
  const adminEmail = process.env.ADMIN_EMAIL || "admin@cleanturn.local";
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || "cleanturn-demo";
  if (isProduction && (adminPassword === "cleanturn-demo" || adminPassword.length < 12)) {
    throw new Error(
      "Refusing to seed in production: ADMIN_INITIAL_PASSWORD must be 12+ chars and not the published default.",
    );
  }
  const appUrl = process.env.APP_URL || "http://localhost:3100";

  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.adminUser.create({
    data: { email: adminEmail, passwordHash: adminPasswordHash },
  });
  console.log(`Created admin user: ${adminEmail}`);

  // Demo fixtures (cleaners with published PINs, fake owners/properties/jobs)
  // must never reach a production database unless explicitly forced.
  if (isProduction && process.env.SEED_DEMO !== "true") {
    console.log("Production seed: admin user only (set SEED_DEMO=true to force demo fixtures).");
    return;
  }

  // Cleaners
  const cleanerRecords: Cleaner[] = [];
  for (const c of CLEANERS) {
    const pinHash = await bcrypt.hash(c.pin, 12);
    const cleaner = await prisma.cleaner.create({
      data: { name: c.name, phone: c.phone, pinHash },
    });
    cleanerRecords.push(cleaner);
  }
  console.log(`Created ${cleanerRecords.length} cleaners`);

  // Owners
  const ownerByName: Record<string, Awaited<ReturnType<typeof prisma.owner.create>>> = {};
  for (const o of demoOwners) {
    const owner = await prisma.owner.create({
      data: {
        name: o.name,
        email: o.email,
        phone: o.phone,
        billingNotes: o.billingNotes,
      },
    });
    ownerByName[o.name] = owner;
  }
  console.log(`Created ${Object.keys(ownerByName).length} owners`);

  // Properties
  const propertyByKey: Record<string, Awaited<ReturnType<typeof prisma.property.create>>> = {};
  for (const p of demoProperties) {
    const owner = ownerByName[p.ownerName];
    const property = await prisma.property.create({
      data: {
        ownerId: owner.id,
        nickname: p.nickname,
        address: p.address,
        icalUrl: `${appUrl}/api/dev/ical/${p.key}`,
        cleanCostCents: p.cleanCostCents,
        directions: p.directions,
        accessCode: p.accessCode,
        arriveTime: p.arriveTime,
        outByTime: p.outByTime,
        notes: p.notes,
        syncStatus: "ok",
        lastSyncAt: new Date(),
      },
    });
    propertyByKey[p.key] = property;
  }
  console.log(`Created ${Object.keys(propertyByKey).length} properties`);

  const today = todayStr();

  function isoAt(dateStr: string, hh: number, mm: number): Date {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  }

  let cleanerRoundRobin = 0;
  function nextCleaner() {
    const c = cleanerRecords[cleanerRoundRobin % cleanerRecords.length];
    cleanerRoundRobin++;
    return c;
  }

  let jobCounter = 0;

  for (const p of demoProperties) {
    const property = propertyByKey[p.key];
    const events: DemoEvent[] = demoEvents(p.key, today);

    // Build bookings + jobs
    const createdJobs: {
      event: DemoEvent;
      booking: Awaited<ReturnType<typeof prisma.booking.create>>;
    }[] = [];

    for (const ev of events) {
      const booking = await prisma.booking.create({
        data: {
          propertyId: property.id,
          icalUid: ev.uid,
          checkinDate: ev.checkin,
          checkoutDate: ev.checkout,
          status: "active",
        },
      });
      createdJobs.push({ event: ev, booking });
    }

    // same-day turnover: another active booking of this property has
    // checkin == job.date (checkout)
    const checkinSet = new Set(createdJobs.map((j) => j.event.checkin));

    for (const { event, booking } of createdJobs) {
      const sameDayTurnover = checkinSet.has(event.checkout);
      const isPast = event.checkout < today;
      const isToday = event.checkout === today;
      const isFuture = event.checkout > today;

      let status: string;
      let cleanerId: string | null = null;
      let arrivedAt: Date | null = null;
      let leftAt: Date | null = null;
      let cleanedAt: Date | null = null;
      let paid = false;
      let paidAt: Date | null = null;

      if (isPast) {
        status = "done";
        const cleaner = nextCleaner();
        cleanerId = cleaner.id;
        arrivedAt = isoAt(event.checkout, 11, 0);
        leftAt = isoAt(event.checkout, 11, 20);
        cleanedAt = isoAt(event.checkout, 13, 0);
        // roughly half paid
        paid = jobCounter % 2 === 0;
        if (paid) paidAt = isoAt(event.checkout, 18, 0);
      } else if (isToday) {
        const mix = jobCounter % 3;
        if (mix === 0) {
          status = "unassigned";
        } else if (mix === 1) {
          status = "in_progress";
          const cleaner = nextCleaner();
          cleanerId = cleaner.id;
          arrivedAt = isoAt(event.checkout, 10, 30);
        } else {
          status = "assigned";
          const cleaner = nextCleaner();
          cleanerId = cleaner.id;
        }
      } else {
        // future
        const mix = jobCounter % 2;
        if (mix === 0) {
          status = "unassigned";
        } else {
          status = "assigned";
          const cleaner = nextCleaner();
          cleanerId = cleaner.id;
        }
      }

      void isFuture;

      await prisma.job.create({
        data: {
          bookingId: booking.id,
          propertyId: property.id,
          date: event.checkout,
          costCents: property.cleanCostCents,
          cleanerId,
          status,
          sameDayTurnover,
          nextCheckinNote: null,
          arrivedAt,
          leftAt,
          cleanedAt,
          paid,
          paidAt,
        },
      });

      jobCounter++;
    }
  }

  // Ensure at least one unassigned job exists today across the whole
  // portfolio (per brief: "at least one unassigned" among today's jobs).
  const unassignedToday = await prisma.job.count({
    where: { date: today, status: "unassigned" },
  });
  if (unassignedToday === 0) {
    const anyTodayJob = await prisma.job.findFirst({ where: { date: today } });
    if (anyTodayJob) {
      await prisma.job.update({
        where: { id: anyTodayJob.id },
        data: { status: "unassigned", cleanerId: null, arrivedAt: null },
      });
    }
  }

  // Ensure at least one in_progress job exists today.
  const inProgressToday = await prisma.job.count({
    where: { date: today, status: "in_progress" },
  });
  if (inProgressToday === 0) {
    const anyAssignedToday = await prisma.job.findFirst({
      where: { date: today, status: "assigned" },
    });
    if (anyAssignedToday) {
      await prisma.job.update({
        where: { id: anyAssignedToday.id },
        data: { status: "in_progress", arrivedAt: isoAt(today, 10, 30) },
      });
    }
  }

  console.log(`Created ${jobCounter} bookings + jobs`);
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
