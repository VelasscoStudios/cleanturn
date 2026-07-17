import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { fmtDay, todayStr, addDays, saturdayOf } from "@/lib/dates";
import {
  filterCompletedJobs,
  groupJobsByCleaner,
  filterCleanerGroupsByPaidStatus,
  rangeSummary,
  weekTallies,
  type BillingJob,
  type BillingProperty,
} from "@/lib/billing";
import BillingFilters from "../_components/BillingFilters";
import MarkAllPaidButton from "../_components/MarkAllPaidButton";
import OwnerCard from "../_components/OwnerCard";
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

  // Resolve the date range server-side. Pay weeks run Saturday→Friday (the
  // admin pays each Friday for last-Sat-through-Fri), so missing/invalid `to`
  // -> the Friday ending the current pay week; missing/invalid `from` -> the
  // Saturday starting `to`'s pay week. With no params the page therefore opens
  // on the current pay week. Swap if inverted, so from/to are always valid.
  const rawTo = typeof params.to === "string" && DATE_RE.test(params.to) ? params.to : undefined;
  const rawFrom = typeof params.from === "string" && DATE_RE.test(params.from) ? params.from : undefined;
  const resolvedTo = rawTo ?? addDays(saturdayOf(today), 6);
  const resolvedFrom = rawFrom ?? saturdayOf(resolvedTo);
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

  // 26 pay-week Saturdays descending (current week's first) for the billing
  // header's week-picker popover.
  const thisSaturday = saturdayOf(today);
  const weekStarts = Array.from({ length: 26 }, (_, i) => addDays(thisSaturday, -7 * i));

  const [jobs, olderUnpaid, tallyJobs] = await Promise.all([
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
    // Covers the whole 26-week popover span, scoped to the current
    // cleaner/owner filters but never the paid-status filter — the popover
    // must show every week's true state regardless of the Owing/Settled dropdown.
    prisma.job.findMany({
      where: {
        propertyId: { in: propertyIds },
        ...(cleanerIdFilter ? { cleanerId: cleanerIdFilter } : {}),
        status: "completed",
        date: { gte: weekStarts[weekStarts.length - 1] },
      },
      select: { date: true, paid: true, costCents: true },
    }),
  ]);

  const tallies = weekTallies(tallyJobs, weekStarts);

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
  // From allGroups, before the paid-status filter below, so the summary strip's
  // totals always cover the whole range regardless of the Owing/Settled dropdown.
  const summary = rangeSummary(allGroups);
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

  // Href for the history-aware empty state's "Show settled" link: keep
  // whichever cleaner/owner filters are active, but switch status to "" (the
  // "All" option) so the settled cleans the "unpaid" filter hid come back.
  const settledParams = new URLSearchParams();
  if (cleanerIdFilter) settledParams.set("cleanerId", cleanerIdFilter);
  if (ownerIdFilter) settledParams.set("ownerId", ownerIdFilter);
  settledParams.set("status", "");
  settledParams.set("from", from);
  settledParams.set("to", to);

  return (
    <div className="admin">
      <Suspense fallback={<div className="bill-head" />}>
        <BillingFilters
          cleaners={allCleaners}
          owners={allOwners}
          from={from}
          to={to}
          today={today}
          summary={summary}
          weekTallies={tallies}
        />
      </Suspense>

      {olderUnpaid._count > 0 && (
        <div className="older-unpaid-note">
          ⚠ {formatCents(olderUnpaid._sum.costCents ?? 0)} unpaid from {olderUnpaid._count} clean
          {olderUnpaid._count === 1 ? "" : "s"} before {fmtDay(from)}{" "}
          <a href={`/admin/billing?${olderUnpaidParams.toString()}`}>Show them</a>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">
          {allGroups.length > 0 && statusFilter === "unpaid" ? (
            <>
              All {summary.paidCount} clean{summary.paidCount === 1 ? "" : "s"} in this range{" "}
              {summary.paidCount === 1 ? "is" : "are"} settled ({formatCents(summary.paidCents)}).{" "}
              <a href={`/admin/billing?${settledParams.toString()}`}>Show settled</a>
            </>
          ) : (
            "Nothing here — adjust the dates or complete some cleans."
          )}
        </div>
      ) : (
        <Suspense fallback={null}>
          {groups.map((cleaner) => {
            const cleanerKey = cleaner.cleanerId ?? "unassigned";
            const cleanerName = cleaner.cleanerName ?? "Unassigned";
            // Per-cleaner range tallies for the group header; paid = total − unpaid.
            const cleanerJobCount = cleaner.owners.reduce(
              (n, o) => n + o.properties.reduce((m, p) => m + p.jobs.length, 0),
              0
            );
            const cleanerPaidCents = cleaner.totalCents - cleaner.unpaidCents;
            const cleanerPaidCount = cleanerJobCount - cleaner.unpaidCount;
            return (
              <div className="cleaner-group ocards" key={cleanerKey}>
                <div className="cleaner-head">
                  <div>
                    <b>{cleanerName}</b>{" "}
                    <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                      · {cleaner.owners.length} owner{cleaner.owners.length > 1 ? "s" : ""} ·{" "}
                      {cleanerJobCount} clean{cleanerJobCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    {cleanerPaidCount > 0 && (
                      <span className="paid-tally">✓ {formatCents(cleanerPaidCents)} paid</span>
                    )}
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
                  const ownerJobCount = owner.properties.reduce((n, p) => n + p.jobs.length, 0);
                  const ownerPaidCents = owner.totalCents - owner.unpaidCents;
                  const initials = ownerName
                    .split(/\s+/)
                    .map((w) => w[0] ?? "")
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <OwnerCard
                      key={owner.ownerId}
                      ownerName={ownerName}
                      initials={initials}
                      propertyCount={owner.properties.length}
                      cleanCount={ownerJobCount}
                      paidNote={
                        owner.unpaidCount > 0 && ownerPaidCents > 0
                          ? `✓ ${formatCents(ownerPaidCents)} paid`
                          : undefined
                      }
                      oweNote={owner.unpaidCount > 0 ? formatCents(owner.unpaidCents) : undefined}
                      settledNote={
                        owner.unpaidCount === 0
                          ? `Paid ✓${latestPaidAt ? ` · ${paidAtFmt.format(latestPaidAt)}` : ""}`
                          : undefined
                      }
                      payButton={
                        owner.unpaidCount > 0 && cleaner.cleanerId !== null ? (
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
                        ) : undefined
                      }
                    >
                      {owner.properties.map((prop) => (
                        <div className="prop-sub" key={prop.propertyId}>
                          <div className="prop-subhead">
                            <div>
                              <b>{prop.propertyNickname}</b>{" "}
                              <span className="count">
                                · {prop.jobs.length} clean{prop.jobs.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            <b className="prop-total">{formatCents(prop.totalCents)}</b>
                          </div>
                          {prop.jobs.map((job) => (
                            <div className="bill-row" key={job.id}>
                              <div>{fmtDay(job.date)}</div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                                <b>{formatCents(job.costCents)}</b>
                                {job.paid && (
                                  <span className="chip completed">
                                    Paid{job.paidAt ? ` · ${paidAtFmt.format(job.paidAt)}` : ""}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </OwnerCard>
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
