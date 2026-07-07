/**
 * Pure billing aggregation helpers. No I/O — callers fetch jobs from Prisma
 * and pass plain objects in here.
 */

export type BillingJob = {
  id: string;
  propertyId: string;
  date: string; // YYYY-MM-DD
  costCents: number;
  status: string;
  paid: boolean;
  paidAt: Date | null;
  cleanerId: string | null;
  cleanerName?: string | null;
};

export type BillingProperty = {
  id: string;
  nickname: string;
  ownerId: string;
};

export type OwnerGroup = {
  ownerId: string;
  jobs: (BillingJob & { propertyNickname: string })[];
  unpaidCents: number;
  unpaidCount: number;
  totalCents: number;
};

/** Extract the YYYY-MM month prefix of a YYYY-MM-DD date string. */
export function monthPrefix(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Filter jobs to those with status "done", optionally by month (YYYY-MM prefix on job.date). */
export function filterDoneJobs(jobs: BillingJob[], month?: string): BillingJob[] {
  return jobs.filter((j) => {
    if (j.status !== "done") return false;
    if (month && monthPrefix(j.date) !== month) return false;
    return true;
  });
}

/**
 * Group done jobs by the owner of their property, computing unpaid totals in
 * cents. `propertiesById` maps propertyId -> { id, nickname, ownerId }.
 */
export function groupJobsByOwner(
  jobs: BillingJob[],
  propertiesById: Record<string, BillingProperty>
): OwnerGroup[] {
  const groups: Record<string, OwnerGroup> = {};

  for (const job of jobs) {
    const property = propertiesById[job.propertyId];
    if (!property) continue;
    const ownerId = property.ownerId;
    if (!groups[ownerId]) {
      groups[ownerId] = {
        ownerId,
        jobs: [],
        unpaidCents: 0,
        unpaidCount: 0,
        totalCents: 0,
      };
    }
    const group = groups[ownerId];
    group.jobs.push({ ...job, propertyNickname: property.nickname });
    group.totalCents += job.costCents;
    if (!job.paid) {
      group.unpaidCents += job.costCents;
      group.unpaidCount += 1;
    }
  }

  // Sort each owner's jobs by date ascending for stable display.
  for (const group of Object.values(groups)) {
    group.jobs.sort((a, b) => a.date.localeCompare(b.date));
  }

  return Object.values(groups);
}

/** Sum unpaid (done, !paid) job costs in cents, optionally scoped to one owner's jobs. */
export function unpaidTotalCents(jobs: BillingJob[]): number {
  return jobs
    .filter((j) => j.status === "done" && !j.paid)
    .reduce((sum, j) => sum + j.costCents, 0);
}

/** Apply the paid/unpaid status filter used by GET /api/billing. */
export function filterByPaidStatus(
  jobs: BillingJob[],
  status?: "paid" | "unpaid"
): BillingJob[] {
  if (!status) return jobs;
  return jobs.filter((j) => (status === "paid" ? j.paid : !j.paid));
}

/** IDs of done+unpaid jobs for an owner, optionally scoped by month — the set mark-owner-paid should bulk-update. */
export function jobsToMarkPaid(
  jobs: BillingJob[],
  ownerId: string,
  propertiesById: Record<string, BillingProperty>,
  month?: string
): string[] {
  return jobs
    .filter((j) => {
      if (j.status !== "done" || j.paid) return false;
      const property = propertiesById[j.propertyId];
      if (!property || property.ownerId !== ownerId) return false;
      if (month && monthPrefix(j.date) !== month) return false;
      return true;
    })
    .map((j) => j.id);
}
