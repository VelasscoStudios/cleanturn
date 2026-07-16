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

/** Running unpaid/total tallies shared by every level of the cleaner-first tree. */
type Tally = {
  unpaidCents: number;
  unpaidCount: number;
  totalCents: number;
};

/** One property's cleans within an owner, within a cleaner. */
export type PropertySubGroup = Tally & {
  propertyId: string;
  propertyNickname: string;
  jobs: BillingJob[];
};

/** One owner's cleans within a cleaner. */
export type OwnerSubGroup = Tally & {
  ownerId: string;
  properties: PropertySubGroup[];
};

/**
 * All cleans a single cleaner performed, sub-grouped by owner then property.
 * `cleanerId` is null for the bucket of completed-but-unassigned cleans.
 */
export type CleanerGroup = Tally & {
  cleanerId: string | null;
  cleanerName: string | null;
  owners: OwnerSubGroup[];
};

/**
 * Filter jobs to those with status "completed", optionally bounded to a
 * date range (both ends inclusive, plain string compare on YYYY-MM-DD).
 */
export function filterCompletedJobs(
  jobs: BillingJob[],
  range?: { from?: string; to?: string }
): BillingJob[] {
  const { from, to } = range ?? {};
  return jobs.filter((j) => {
    if (j.status !== "completed") return false;
    if (from && j.date < from) return false;
    if (to && j.date > to) return false;
    return true;
  });
}

/**
 * Group completed jobs by the owner of their property, computing unpaid
 * totals in cents. `propertiesById` maps propertyId -> { id, nickname, ownerId }.
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

/**
 * Group completed jobs into a Cleaner → Owner → Property tree, the layout the
 * billing page renders: "we owe cleaner X, of which owner Y accounts for Z,
 * broken down by property." Unpaid/total tallies roll up at every level.
 *
 * Jobs with no cleaner (cleanerId null) collect under a single group with a
 * null id/name so completed work still shows even before it's assigned.
 * `propertiesById` maps propertyId -> { id, nickname, ownerId }.
 */
export function groupJobsByCleaner(
  jobs: BillingJob[],
  propertiesById: Record<string, BillingProperty>
): CleanerGroup[] {
  // Keyed by cleanerId; the null-cleaner bucket uses the literal "" key.
  const cleaners: Record<string, CleanerGroup> = {};

  const addTally = (t: Tally, job: BillingJob) => {
    t.totalCents += job.costCents;
    if (!job.paid) {
      t.unpaidCents += job.costCents;
      t.unpaidCount += 1;
    }
  };

  for (const job of jobs) {
    const property = propertiesById[job.propertyId];
    if (!property) continue;

    const cleanerKey = job.cleanerId ?? "";
    let cleaner = cleaners[cleanerKey];
    if (!cleaner) {
      cleaner = cleaners[cleanerKey] = {
        cleanerId: job.cleanerId ?? null,
        cleanerName: job.cleanerName ?? null,
        owners: [],
        unpaidCents: 0,
        unpaidCount: 0,
        totalCents: 0,
      };
    }

    let owner = cleaner.owners.find((o) => o.ownerId === property.ownerId);
    if (!owner) {
      owner = {
        ownerId: property.ownerId,
        properties: [],
        unpaidCents: 0,
        unpaidCount: 0,
        totalCents: 0,
      };
      cleaner.owners.push(owner);
    }

    let prop = owner.properties.find((p) => p.propertyId === property.id);
    if (!prop) {
      prop = {
        propertyId: property.id,
        propertyNickname: property.nickname,
        jobs: [],
        unpaidCents: 0,
        unpaidCount: 0,
        totalCents: 0,
      };
      owner.properties.push(prop);
    }

    prop.jobs.push(job);
    addTally(prop, job);
    addTally(owner, job);
    addTally(cleaner, job);
  }

  // Stable display order: cleaners by name (unassigned bucket last), owners by
  // total owed descending, properties by nickname, jobs by date ascending.
  const list = Object.values(cleaners);
  for (const cleaner of list) {
    cleaner.owners.sort((a, b) => b.totalCents - a.totalCents);
    for (const owner of cleaner.owners) {
      owner.properties.sort((a, b) => a.propertyNickname.localeCompare(b.propertyNickname));
      for (const prop of owner.properties) {
        prop.jobs.sort((a, b) => a.date.localeCompare(b.date));
      }
    }
  }
  list.sort((a, b) => {
    if (a.cleanerId === null) return 1;
    if (b.cleanerId === null) return -1;
    return (a.cleanerName ?? "").localeCompare(b.cleanerName ?? "");
  });

  return list;
}

/** Sum unpaid (completed, !paid) job costs in cents, optionally scoped to one owner's jobs. */
export function unpaidTotalCents(jobs: BillingJob[]): number {
  return jobs
    .filter((j) => j.status === "completed" && !j.paid)
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

/**
 * Apply the status filter used by the billing page at the cleaner-group
 * level: "unpaid" keeps a cleaner as long as they have any unpaid clean left
 * (their already-paid owner sub-groups stay visible so the report is a
 * complete record of the range); "paid" keeps only cleaners fully settled.
 */
export function filterCleanerGroupsByPaidStatus(
  groups: CleanerGroup[],
  status?: "paid" | "unpaid"
): CleanerGroup[] {
  if (!status) return groups;
  return groups.filter((g) => (status === "paid" ? g.unpaidCount === 0 : g.unpaidCount > 0));
}

/**
 * IDs of completed+unpaid jobs matching a bulk "mark paid" scope. Every filter
 * is optional and ANDed:
 *  - cleanerId: `undefined` = any cleaner; a string = that cleaner; `null` =
 *    only unassigned cleans. (This is why null is meaningful, not a no-op.)
 *  - ownerId: restrict to properties belonging to that owner.
 *  - from/to: restrict to a date range on job.date, both ends inclusive.
 * Drives POST /api/billing/mark-paid at the cleaner and owner-within-cleaner
 * levels of the billing tree.
 */
export function jobsToMarkPaid(
  jobs: BillingJob[],
  propertiesById: Record<string, BillingProperty>,
  filters: { cleanerId?: string | null; ownerId?: string; from?: string; to?: string } = {}
): string[] {
  const { cleanerId, ownerId, from, to } = filters;
  return jobs
    .filter((j) => {
      if (j.status !== "completed" || j.paid) return false;
      const property = propertiesById[j.propertyId];
      if (!property) return false;
      if (ownerId !== undefined && property.ownerId !== ownerId) return false;
      if (cleanerId !== undefined && (j.cleanerId ?? null) !== cleanerId) return false;
      if (from && j.date < from) return false;
      if (to && j.date > to) return false;
      return true;
    })
    .map((j) => j.id);
}
