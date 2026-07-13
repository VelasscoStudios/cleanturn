import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { fmtDay } from "@/lib/dates";
import {
  filterCompletedJobs,
  filterByPaidStatus,
  groupJobsByOwner,
  type BillingJob,
  type BillingProperty,
} from "@/lib/billing";
import BillingFilters from "../_components/BillingFilters";
import MarkPaidButton from "../_components/MarkPaidButton";
import MarkAllPaidButton from "../_components/MarkAllPaidButton";
import { formatCents } from "../_components/format";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireRolePage("admin");

  const params = await searchParams;
  const ownerIdFilter = typeof params.ownerId === "string" ? params.ownerId : "";
  // Missing param -> default "unpaid"; explicit empty string ("All") -> undefined (no filter).
  const rawStatus = params.status;
  const statusFilter: "paid" | "unpaid" | undefined =
    rawStatus === undefined ? "unpaid" : rawStatus === "paid" || rawStatus === "unpaid" ? rawStatus : undefined;
  const monthFilter =
    typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : undefined;

  const [allOwners, properties] = await Promise.all([
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

  const jobs = await prisma.job.findMany({
    where: { propertyId: { in: propertyIds } },
    include: { cleaner: { select: { id: true, name: true } } },
  });

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

  const completed = filterCompletedJobs(billingJobs, monthFilter);
  const filtered = filterByPaidStatus(completed, statusFilter);
  const groups = groupJobsByOwner(filtered, propertiesById);

  const ownerIds = groups.map((g) => g.ownerId);
  const owners = await prisma.owner.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, billingNotes: true },
  });
  const ownersById = Object.fromEntries(owners.map((o) => [o.id, o]));

  return (
    <div className="admin">
      <Suspense fallback={<div className="filters" />}>
        <BillingFilters owners={allOwners} />
      </Suspense>

      {groups.length === 0 ? (
        <div className="empty-state">Nothing here — adjust the filters or complete some cleans.</div>
      ) : (
        <Suspense fallback={null}>
          {groups.map((group) => {
            const owner = ownersById[group.ownerId] ?? {
              id: group.ownerId,
              name: "Unknown",
              billingNotes: "",
            };
            return (
              <div className="owner-group" key={group.ownerId}>
                <div className="owner-head">
                  <div>
                    <b>{owner.name}</b>{" "}
                    <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                      · {owner.billingNotes || "No billing notes"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    {group.unpaidCount > 0 ? (
                      <>
                        <span className="owe">
                          Owes {formatCents(group.unpaidCents)} ({group.unpaidCount} clean
                          {group.unpaidCount > 1 ? "s" : ""})
                        </span>
                        <MarkAllPaidButton ownerId={group.ownerId} />
                      </>
                    ) : (
                      <span className="chip completed">All settled ✅</span>
                    )}
                  </div>
                </div>
                {group.jobs.map((job) => (
                  <div className="bill-row" key={job.id}>
                    <div>
                      <b>{job.propertyNickname}</b>{" "}
                      <span style={{ color: "var(--muted)" }}>
                        · {fmtDay(job.date)} · cleaned by {job.cleanerName ?? "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <b>{formatCents(job.costCents)}</b>
                      {job.paid ? (
                        <span className="chip completed">Paid</span>
                      ) : (
                        <MarkPaidButton jobId={job.id} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </Suspense>
      )}
      <p className="muted-note">
        Only <b>completed</b> cleans are billable. Mark cleans paid one by one, or a whole owner at
        once when their transfer arrives.
      </p>
    </div>
  );
}
