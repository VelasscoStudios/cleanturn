import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { todayStr, addDays, fmtDay } from "@/lib/dates";
import ScheduleFilters from "./_components/ScheduleFilters";
import AssignSelect from "./_components/AssignSelect";
import SyncNowButton from "./_components/SyncNowButton";
import AutoRefresh from "./_components/AutoRefresh";
import { formatCents } from "./_components/format";

const STATUS_LABEL: Record<string, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  in_progress: "In progress",
  awaiting_confirm: "Left · awaiting confirm",
  done: "Done ✅",
  cancelled: "Cancelled",
};

const STATUS_CHIP_CLASS: Record<string, string> = {
  unassigned: "unassigned",
  assigned: "assigned",
  in_progress: "in_progress",
  awaiting_confirm: "awaiting",
  done: "done",
  cancelled: "cancelled",
};

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

  const today = todayStr();
  const from = today;
  // "all" = every upcoming job; otherwise a bounded window from today.
  const windowDays = daysParam === "all" ? null : Math.max(1, parseInt(daysParam, 10) || 7);
  const to = windowDays === null ? null : addDays(today, windowDays);

  const [jobs, properties, cleaners, lastSync] = await Promise.all([
    prisma.job.findMany({
      where: {
        date: to ? { gte: from, lte: to } : { gte: from },
        ...(propertyId ? { propertyId } : {}),
        ...(cleanerId ? { cleanerId } : {}),
        ...(unassignedOnly ? { cleanerId: null } : {}),
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
          },
        },
        cleaner: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.property.findMany({
      where: { active: true },
      select: { id: true, nickname: true },
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
          return (
            <div className="day-group" key={date}>
              <div className="day-head">
                {fmtDay(date)}
                {isToday && <span className="today-tag">TODAY</span>}
              </div>
              {(groups.get(date) ?? []).map((job) => {
                return (
                  <div
                    className={`job ${!job.cleanerId ? "unassigned" : ""}`}
                    key={job.id}
                  >
                    <div>
                      <div className="prop">
                        {job.property.nickname}{" "}
                        {job.sameDayTurnover && (
                          <span className="flag">
                            ⚡ SAME-DAY
                            {job.nextCheckinNote ? ` · ${job.nextCheckinNote}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="addr">{job.property.address}</div>
                      <div className="meta">
                        <span>
                          ⏰ {job.property.arriveTime} → out by {job.property.outByTime}
                        </span>
                        <span>💵 {formatCents(job.costCents)}</span>
                        <span>🔑 {job.property.accessCode || "—"}</span>
                      </div>
                    </div>
                    <AssignSelect
                      jobId={job.id}
                      cleanerId={job.cleanerId}
                      cleanerName={job.cleaner?.name}
                      cleaners={cleaners}
                    />
                    <span className={`chip ${STATUS_CHIP_CLASS[job.status] ?? job.status}`}>
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}
