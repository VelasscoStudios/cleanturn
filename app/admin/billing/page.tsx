import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { fmtDay, todayStr, addDays } from "@/lib/dates";
import {
  filterCompletedJobs,
  groupJobsByCleaner,
  filterCleanerGroupsByPaidStatus,
  type BillingJob,
  type BillingProperty,
} from "@/lib/billing";
import BillingFilters from "../_components/BillingFilters";
import MarkAllPaidButton from "../_components/MarkAllPaidButton";
import { formatCents } from "../_components/format";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const paidAtFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireRolePage("admin");

  const params = await searchParams;
  const cleanerIdFilter = typeof params.cleanerId === "string" ? params.cleanerId : "";
  const ownerIdFilter = typeof params.ownerId === "string" ? params.ownerId : "";
  // Missing param -> default "unpaid"; explicit empty string ("All") -> undefined (no filter).
  const rawStatus = params.status;
  const statusFilter: "paid" | "unpaid" | undefined =
    rawStatus === undefined ? "unpaid" : rawStatus === "paid" || rawStatus === "unpaid" ? rawStatus : undefined;

  // Computed once, server-side, so both the default range and the filter
  // bar's presets agree on "today" in the business timezone (APP_TIMEZONE),
  // not whatever timezone the client happens to be in.
  const today = todayStr();

  // Resolve the date range server-side: missing/invalid `to` -> today;
  // missing/invalid `from` -> 6 days before the resolved `to`. Swap if the
  // result is inverted, so from/to are always a valid, defined range.
  const rawTo = typeof params.to === "string" && DATE_RE.test(params.to) ? params.to : undefined;
  const rawFrom = typeof params.from === "string" && DATE_RE.test(params.from) ? params.from : undefined;
  const resolvedTo = rawTo ?? today;
  const resolvedFrom = rawFrom ?? addDays(resolvedTo, -6);
  const [from, to] =
    resolvedFrom > resolvedTo ? [resolvedTo, resolvedFrom] : [resolvedFrom, resolvedTo];

  const [allCleaners, allOwners, properties] = await Promise.all([
    prisma.cleaner.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.owner.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.property.findMany({
      select: { id: true, nickname: true, ownerId: true },
      ...(ownerIdFilter ? { where: { ownerId: ownerIdFilter } } : {}),
    }),
  ]);

  const propertiesById: Record<string, BillingProperty> = Object.fromEntries(
    properties.map((p) => [p.id, p])
  );
  const propertyIds = properties.map((p) => p.id);

  const [jobs, olderUnpaid] = await Promise.all([
    prisma.job.findMany({
      where: {
        propertyId: { in: propertyIds },
        date: { gte: from, lte: to },
        ...(cleanerIdFilter ? { cleanerId: cleanerIdFilter } : {}),
      },
      include: { cleaner: { select: { id: true, name: true } } },
    }),
    // The default last-7-days window can silently hide old unpaid cleans
    // (e.g. one entered late, after its week was already settled) — surface
    // them as a separate notice rather than letting them go unnoticed.
    prisma.job.aggregate({
      where: {
        propertyId: { in: propertyIds },
        ...(cleanerIdFilter ? { cleanerId: cleanerIdFilter } : {}),
        status: "completed",
        paid: false,
        date: { lt: from },
      },
      _sum: { costCents: true },
      _count: true,
      _min: { date: true },
    }),
  ]);

  const billingJobs: BillingJob[] = jobs.map((j) => ({
    id: j.id,
    propertyId: j.propertyId,
    date: j.date,
    costCents: j.costCents,
    status: j.status,
    paid: j.paid,
    paidAt: j.paidAt,
    cleanerId: j.cleanerId,
    cleanerName: j.cleaner?.name ?? null,
  }));

  const completed = filterCompletedJobs(billingJobs, { from, to });
  const allGroups = groupJobsByCleaner(completed, propertiesById);
  const groups = filterCleanerGroupsByPaidStatus(allGroups, statusFilter);

  const ownersById = Object.fromEntries(allOwners.map((o) => [o.id, o.name]));

  // Href for the older-unpaid notice's "Show them" link: keep whichever
  // cleaner/owner/status filters are already active, but widen the range
  // back to the oldest unpaid clean found.
  const olderUnpaidParams = new URLSearchParams();
  if (cleanerIdFilter) olderUnpaidParams.set("cleanerId", cleanerIdFilter);
  if (ownerIdFilter) olderUnpaidParams.set("ownerId", ownerIdFilter);
  if (typeof rawStatus === "string") olderUnpaidParams.set("status", rawStatus);
  olderUnpaidParams.set("from", olderUnpaid._min.date ?? from);
  olderUnpaidParams.set("to", to);

  return (
    <div className="admin">
      <Suspense fallback={<div className="filters" />}>
        <BillingFilters cleaners={allCleaners} owners={allOwners} from={from} to={to} today={today} />
      </Suspense>

      {olderUnpaid._count > 0 && (
        <div className="older-unpaid-note">
          ⚠ {formatCents(olderUnpaid._sum.costCents ?? 0)} unpaid from {olderUnpaid._count} clean
          {olderUnpaid._count === 1 ? "" : "s"} before {fmtDay(from)}{" "}
          <a href={`/admin/billing?${olderUnpaidParams.toString()}`}>Show them</a>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">Nothing here — adjust the dates or complete some cleans.</div>
      ) : (
        <Suspense fallback={null}>
          {groups.map((cleaner) => {
            const cleanerKey = cleaner.cleanerId ?? "unassigned";
            const cleanerName = cleaner.cleanerName ?? "Unassigned";
            return (
              <div className="cleaner-group" key={cleanerKey}>
                <div className="cleaner-head">
                  <div>
                    <b>{cleanerName}</b>{" "}
                    <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                      · {cleaner.owners.length} owner{cleaner.owners.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    {cleaner.unpaidCount > 0 ? (
                      <>
                        <span className="owe">
                          We owe {formatCents(cleaner.unpaidCents)} ({cleaner.unpaidCount} clean
                          {cleaner.unpaidCount > 1 ? "s" : ""})
                        </span>
                        {/* Unassigned cleans can't be settled to a person — skip the button. */}
                        {cleaner.cleanerId !== null && (
                          // The button's scope must always match the displayed tallies: when
                          // an owner filter is active the numbers above are that owner's
                          // only, so the button must carry the same ownerId or it would pay
                          // this cleaner's cleans across every owner.
                          <MarkAllPaidButton
                            cleanerId={cleaner.cleanerId}
                            ownerId={ownerIdFilter || undefined}
                            from={from}
                            to={to}
                            amountCents={cleaner.unpaidCents}
                            cleanCount={cleaner.unpaidCount}
                            confirmName={
                              ownerIdFilter
                                ? `${cleanerName} — ${ownersById[ownerIdFilter] ?? "Unknown owner"}`
                                : cleanerName
                            }
                            label="Pay all remaining"
                            ghost
                          />
                        )}
                      </>
                    ) : (
                      <span className="chip completed">All settled ✅</span>
                    )}
                  </div>
                </div>

                {cleaner.owners.map((owner) => {
                  const ownerName = ownersById[owner.ownerId] ?? "Unknown owner";
                  const latestPaidAt = owner.properties
                    .flatMap((p) => p.jobs)
                    .map((j) => j.paidAt)
                    .filter((d): d is Date => d !== null)
                    .sort((a, b) => b.getTime() - a.getTime())[0];

                  return (
                    <div className="owner-sub" key={owner.ownerId}>
                      <div className="owner-subhead">
                        <div>
                          <b>👤 {ownerName}</b>
                        </div>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          {owner.unpaidCount > 0 ? (
                            <>
                              <span className="owe-sub">{formatCents(owner.unpaidCents)}</span>
                              {cleaner.cleanerId !== null && (
                                <MarkAllPaidButton
                                  cleanerId={cleaner.cleanerId}
                                  ownerId={owner.ownerId}
                                  from={from}
                                  to={to}
                                  amountCents={owner.unpaidCents}
                                  cleanCount={owner.unpaidCount}
                                  confirmName={`${cleanerName} — ${ownerName}`}
                                  label="Mark paid"
                                />
                              )}
                            </>
                          ) : (
                            <span className="chip completed">
                              Paid ✓{latestPaidAt ? ` · ${paidAtFmt.format(latestPaidAt)}` : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {owner.properties.flatMap((prop) =>
                        prop.jobs.map((job) => (
                          <div className="bill-row" key={job.id}>
                            <div>
                              <b>{prop.propertyNickname}</b>{" "}
                              <span style={{ color: "var(--muted)" }}>({fmtDay(job.date)})</span>
                            </div>
                            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                              <b>{formatCents(job.costCents)}</b>
                              {job.paid && <span className="chip completed">Paid</span>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Suspense>
      )}
      <p className="muted-note">
        Amounts are what <b>we owe each cleaner</b> for <b>completed</b> cleans between the selected
        dates. Mark each owner&apos;s cleans paid as their transfer arrives, or settle a whole cleaner
        with Pay all remaining.
      </p>
    </div>
  );
}
