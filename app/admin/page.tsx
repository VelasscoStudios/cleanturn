import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { todayStr, addDays, fmtDay } from "@/lib/dates";
import ScheduleFilters from "./_components/ScheduleFilters";
import SyncNowButton from "./_components/SyncNowButton";
import AutoRefresh from "./_components/AutoRefresh";
import JobRow from "./_components/JobRow";
import AddCleanButton from "./_components/AddCleanButton";

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

  const [jobs, properties, cleaners, lastSync] = await Promise.all([
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
        cleaner: { select: { id: true, name: true } },
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.property.aggregate({ _max: { lastSyncAt: true } }),
  ]);

  // Unassigned-in-next-48h banner: computed across the full 48h window
  // regardless of the current filters (matches prototype behavior).
  const unassignedSoon = await prisma.job.count({
    where: {
      cleanerId: null,
      status: { not: "cancelled" },
      date: { gte: today, lte: addDays(today, 2) },
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

      {unassignedSoon > 0 ? (
        <div className="alert">
          ⚠️ {unassignedSoon} unassigned clean{unassignedSoon > 1 ? "s" : ""} in the next 48 hours
        </div>
      ) : (
        <div className="alert ok">✅ All cleans in the next 48h are assigned</div>
      )}

      <AddCleanButton
        properties={properties.map((p) => ({
          id: p.id,
          name: p.nickname,
          cleanCostCents: p.cleanCostCents,
        }))}
        cleaners={cleaners}
      />

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
