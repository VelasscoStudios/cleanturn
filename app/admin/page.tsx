import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { todayStr, addDays, fmtDay } from "@/lib/dates";
import ScheduleFilters from "./_components/ScheduleFilters";
import SyncNowButton from "./_components/SyncNowButton";
import AutoRefresh from "./_components/AutoRefresh";
import JobRow from "./_components/JobRow";
import AddCleanButton from "./_components/AddCleanButton";
import AddNoteButton from "./_components/AddNoteButton";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireRolePage("admin");

  const params = await searchParams;
  const propertyId = typeof params.propertyId === "string" ? params.propertyId : "";
  const cleanerId = typeof params.cleanerId === "string" ? params.cleanerId : "";
  const unassignedOnly = params.unassigned === "true";
  const daysParam = typeof params.days === "string" ? params.days : "7";
  const statusParam = typeof params.status === "string" ? params.status : "";
  // Whitelist so an arbitrary query string can't become a filter value.
  const VALID_STATUSES = ["assigned", "in_progress", "completed", "cancelled"];
  const status = VALID_STATUSES.includes(statusParam) ? statusParam : "";

  const today = todayStr();
  // Date window: positive days look forward from today, negative days look
  // back (ending today, so a past view includes today's finished cleans),
  // "all" = every upcoming, "past" = everything up to today.
  let from: string | null = today;
  let to: string | null = null;
  let isPastView = false;
  if (daysParam === "all") {
    // from = today, unbounded end
  } else if (daysParam === "past") {
    isPastView = true;
    from = null;
    to = today;
  } else {
    const n = parseInt(daysParam, 10) || 7;
    if (n < 0) {
      isPastView = true;
      from = addDays(today, n);
      to = today;
    } else {
      to = addDays(today, Math.max(1, n));
    }
  }

  const [jobs, properties, cleanersRaw, lastSync, noteJobOptions] = await Promise.all([
    prisma.job.findMany({
      where: {
        date: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
        ...(propertyId ? { propertyId } : {}),
        ...(cleanerId ? { cleanerId } : {}),
        ...(unassignedOnly ? { cleanerId: null } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        property: {
          select: {
            id: true,
            nickname: true,
            address: true,
            arriveTime: true,
            outByTime: true,
            accessCode: true,
            directions: true,
          },
        },
        cleaner: {
          select: {
            id: true,
            name: true,
            notes: {
              select: { id: true, body: true, date: true },
              orderBy: { createdAt: "desc" },
            },
          },
        },
        notes: {
          select: { id: true, body: true, date: true },
          orderBy: { createdAt: "desc" },
        },
      },
      // Past views read newest-first (most recent clean on top).
      orderBy: [{ date: isPastView ? "desc" : "asc" }, { createdAt: "asc" }],
    }),
    prisma.property.findMany({
      where: { active: true },
      select: { id: true, nickname: true, cleanCostCents: true },
      orderBy: { nickname: "asc" },
    }),
    prisma.cleaner.findMany({
      where: { active: true },
      select: { id: true, name: true, _count: { select: { notes: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.property.aggregate({ _max: { lastSyncAt: true } }),
    // Recent jobs for the "Add note" modal's job picker (matches app/admin/notes/page.tsx).
    prisma.job.findMany({
      select: { id: true, date: true, property: { select: { nickname: true } } },
      orderBy: { date: "desc" },
      take: 60,
    }),
  ]);

  // Flag cleaners who have linked notes (e.g. "cannot clean houses larger
  // than 3 beds") so the admin sees a marker while assigning.
  const cleaners = cleanersRaw.map((c) => ({
    id: c.id,
    name: c.name,
    hasNotes: c._count.notes > 0,
  }));

  // Unassigned-in-next-7-days banner: computed across the full 7-day window
  // regardless of the current filters.
  const unassignedSoon = await prisma.job.count({
    where: {
      cleanerId: null,
      status: { not: "cancelled" },
      date: { gte: today, lte: addDays(today, 7) },
    },
  });

  const groups = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const list = groups.get(job.date) ?? [];
    list.push(job);
    groups.set(job.date, list);
  }
  const sortedDates = Array.from(groups.keys()).sort();
  if (isPastView) sortedDates.reverse();

  const lastSyncedLabel = lastSync._max.lastSyncAt
    ? lastSync._max.lastSyncAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";

  return (
    <div className="admin">
      <AutoRefresh />
      <SyncNowButton lastSyncedLabel={lastSyncedLabel} />

      {unassignedSoon > 0 && (
        <div className="alert">
          ⚠️ {unassignedSoon} unassigned clean{unassignedSoon > 1 ? "s" : ""} in the next 7 days
        </div>
      )}

      <div className="btn-row">
        <AddCleanButton
          properties={properties.map((p) => ({
            id: p.id,
            name: p.nickname,
            cleanCostCents: p.cleanCostCents,
          }))}
          cleaners={cleaners}
        />
        <AddNoteButton
          cleaners={cleaners}
          jobs={noteJobOptions.map((j) => ({
            id: j.id,
            label: `${j.property.nickname} - ${j.date}`,
          }))}
        />
      </div>

      <Suspense fallback={<div className="filters" />}>
        <ScheduleFilters
          properties={properties.map((p) => ({ id: p.id, name: p.nickname }))}
          cleaners={cleaners}
        />
      </Suspense>

      {sortedDates.length === 0 ? (
        <div className="empty-state">No cleans match these filters.</div>
      ) : (
        sortedDates.map((date) => {
          const isToday = date === today;
          const list = groups.get(date) ?? [];
          const unassignedInDay = list.filter(
            (j) => !j.cleanerId && j.status !== "cancelled"
          ).length;
          return (
            <div className="day-group" key={date}>
              <div className="day-head">
                {fmtDay(date)}
                {isToday && <span className="today-tag">TODAY</span>}
                <span className="day-count">
                  {list.length} clean{list.length === 1 ? "" : "s"}
                  {unassignedInDay > 0 ? ` · ${unassignedInDay} unassigned` : ""}
                </span>
              </div>
              <div className="sched-wrap">
                <table className="sched">
                  <tbody>
                    {list.map((job) => (
                      <JobRow
                        key={job.id}
                        cleaners={cleaners}
                        job={{
                          id: job.id,
                          arriveTime: job.property.arriveTime,
                          outByTime: job.property.outByTime,
                          nickname: job.property.nickname,
                          address: job.property.address,
                          accessCode: job.property.accessCode,
                          directions: job.property.directions,
                          costCents: job.costCents,
                          status: job.status,
                          cleanerId: job.cleanerId,
                          cleanerName: job.cleaner?.name ?? null,
                          sameDayTurnover: job.sameDayTurnover,
                          nextCheckinNote: job.nextCheckinNote,
                          manual: job.bookingId === null,
                          notes: job.notes,
                          cleanerNotes: job.cleaner?.notes ?? [],
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
