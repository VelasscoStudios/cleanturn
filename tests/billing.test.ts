import { describe, it, expect } from "vitest";
import {
  filterCompletedJobs,
  groupJobsByOwner,
  groupJobsByCleaner,
  unpaidTotalCents,
  filterByPaidStatus,
  filterCleanerGroupsByPaidStatus,
  jobsToMarkPaid,
  rangeSummary,
  weekTallies,
  type BillingJob,
  type BillingProperty,
  type CleanerGroup,
} from "../lib/billing";
import { markPaidSchema } from "../lib/validation";

const properties: Record<string, BillingProperty> = {
  p1: { id: "p1", nickname: "Sunset Loft", ownerId: "owner-1" },
  p2: { id: "p2", nickname: "Palm Villa", ownerId: "owner-1" },
  p3: { id: "p3", nickname: "Marina Studio", ownerId: "owner-2" },
};

function job(overrides: Partial<BillingJob>): BillingJob {
  return {
    id: "j1",
    propertyId: "p1",
    date: "2026-07-01",
    costCents: 6500,
    status: "completed",
    paid: false,
    paidAt: null,
    cleanerId: "c1",
    ...overrides,
  };
}

describe("filterCompletedJobs", () => {
  it("keeps only completed jobs", () => {
    const jobs = [
      job({ id: "a", status: "completed" }),
      job({ id: "b", status: "assigned" }),
      job({ id: "c", status: "cancelled" }),
    ];
    const result = filterCompletedJobs(jobs);
    expect(result.map((j) => j.id)).toEqual(["a"]);
  });

  it("includes the from boundary date", () => {
    const jobs = [
      job({ id: "a", status: "completed", date: "2026-07-06" }),
      job({ id: "b", status: "completed", date: "2026-07-07" }),
    ];
    const result = filterCompletedJobs(jobs, { from: "2026-07-07" });
    expect(result.map((j) => j.id)).toEqual(["b"]);
  });

  it("includes the to boundary date", () => {
    const jobs = [
      job({ id: "a", status: "completed", date: "2026-07-13" }),
      job({ id: "b", status: "completed", date: "2026-07-14" }),
    ];
    const result = filterCompletedJobs(jobs, { to: "2026-07-13" });
    expect(result.map((j) => j.id)).toEqual(["a"]);
  });

  it("filters with from only", () => {
    const jobs = [
      job({ id: "a", status: "completed", date: "2026-06-30" }),
      job({ id: "b", status: "completed", date: "2026-07-01" }),
    ];
    const result = filterCompletedJobs(jobs, { from: "2026-07-01" });
    expect(result.map((j) => j.id)).toEqual(["b"]);
  });

  it("filters with to only", () => {
    const jobs = [
      job({ id: "a", status: "completed", date: "2026-07-01" }),
      job({ id: "b", status: "completed", date: "2026-07-15" }),
    ];
    const result = filterCompletedJobs(jobs, { to: "2026-07-01" });
    expect(result.map((j) => j.id)).toEqual(["a"]);
  });

  it("filters with both from and to", () => {
    const jobs = [
      job({ id: "a", status: "completed", date: "2026-06-30" }),
      job({ id: "b", status: "completed", date: "2026-07-01" }),
      job({ id: "c", status: "completed", date: "2026-07-15" }),
      job({ id: "d", status: "completed", date: "2026-07-31" }),
    ];
    const result = filterCompletedJobs(jobs, { from: "2026-07-01", to: "2026-07-15" });
    expect(result.map((j) => j.id).sort()).toEqual(["b", "c"]);
  });
});

describe("groupJobsByOwner", () => {
  it("groups completed jobs by the owner of their property", () => {
    const jobs = [
      job({ id: "a", propertyId: "p1", costCents: 6500, paid: false }),
      job({ id: "b", propertyId: "p2", costCents: 9000, paid: true }),
      job({ id: "c", propertyId: "p3", costCents: 5000, paid: false }),
    ];
    const groups = groupJobsByOwner(jobs, properties);
    const byOwner = Object.fromEntries(groups.map((g) => [g.ownerId, g]));

    expect(byOwner["owner-1"].jobs).toHaveLength(2);
    expect(byOwner["owner-1"].totalCents).toBe(6500 + 9000);
    expect(byOwner["owner-1"].unpaidCents).toBe(6500);
    expect(byOwner["owner-1"].unpaidCount).toBe(1);

    expect(byOwner["owner-2"].jobs).toHaveLength(1);
    expect(byOwner["owner-2"].unpaidCents).toBe(5000);
  });

  it("skips jobs whose property is missing from the map", () => {
    const jobs = [job({ id: "a", propertyId: "missing-prop" })];
    const groups = groupJobsByOwner(jobs, properties);
    expect(groups).toHaveLength(0);
  });

  it("sorts each owner's jobs by date ascending", () => {
    const jobs = [
      job({ id: "a", propertyId: "p1", date: "2026-07-20" }),
      job({ id: "b", propertyId: "p1", date: "2026-07-05" }),
    ];
    const groups = groupJobsByOwner(jobs, properties);
    expect(groups[0].jobs.map((j) => j.id)).toEqual(["b", "a"]);
  });
});

describe("unpaidTotalCents", () => {
  it("sums only completed + unpaid jobs", () => {
    const jobs = [
      job({ id: "a", status: "completed", paid: false, costCents: 1000 }),
      job({ id: "b", status: "completed", paid: true, costCents: 2000 }),
      job({ id: "c", status: "assigned", paid: false, costCents: 3000 }),
    ];
    expect(unpaidTotalCents(jobs)).toBe(1000);
  });

  it("returns 0 for an empty list", () => {
    expect(unpaidTotalCents([])).toBe(0);
  });
});

describe("filterByPaidStatus", () => {
  const jobs = [
    job({ id: "a", paid: true }),
    job({ id: "b", paid: false }),
  ];

  it("returns all jobs when status is undefined", () => {
    expect(filterByPaidStatus(jobs)).toHaveLength(2);
  });

  it("filters to paid only", () => {
    expect(filterByPaidStatus(jobs, "paid").map((j) => j.id)).toEqual(["a"]);
  });

  it("filters to unpaid only", () => {
    expect(filterByPaidStatus(jobs, "unpaid").map((j) => j.id)).toEqual(["b"]);
  });
});

describe("groupJobsByCleaner", () => {
  it("nests owners then properties under each cleaner with rolled-up tallies", () => {
    const jobs = [
      // Karen (c1): owner-1/p1 unpaid 6500, owner-1/p2 paid 9000, owner-2/p3 unpaid 5000
      job({ id: "a", cleanerId: "c1", cleanerName: "Karen", propertyId: "p1", costCents: 6500, paid: false }),
      job({ id: "b", cleanerId: "c1", cleanerName: "Karen", propertyId: "p2", costCents: 9000, paid: true }),
      job({ id: "c", cleanerId: "c1", cleanerName: "Karen", propertyId: "p3", costCents: 5000, paid: false }),
      // Bob (c2): owner-1/p1 unpaid 4000
      job({ id: "d", cleanerId: "c2", cleanerName: "Bob", propertyId: "p1", costCents: 4000, paid: false }),
    ];
    const groups = groupJobsByCleaner(jobs, properties);
    const byCleaner: Record<string, (typeof groups)[number]> = Object.fromEntries(
      groups.map((g) => [g.cleanerId, g])
    );

    const karen = byCleaner["c1"];
    expect(karen.cleanerName).toBe("Karen");
    expect(karen.totalCents).toBe(6500 + 9000 + 5000);
    expect(karen.unpaidCents).toBe(6500 + 5000);
    expect(karen.unpaidCount).toBe(2);
    // Two owners under Karen, sorted by total owed descending (owner-1 = 15500).
    expect(karen.owners.map((o) => o.ownerId)).toEqual(["owner-1", "owner-2"]);

    const owner1 = karen.owners.find((o) => o.ownerId === "owner-1")!;
    expect(owner1.totalCents).toBe(6500 + 9000);
    expect(owner1.unpaidCents).toBe(6500);
    // Two properties under owner-1, sorted by nickname (Palm < Sunset).
    expect(owner1.properties.map((p) => p.propertyNickname)).toEqual(["Palm Villa", "Sunset Loft"]);

    expect(byCleaner["c2"].totalCents).toBe(4000);
  });

  it("buckets unassigned cleans under a null cleaner sorted last", () => {
    const jobs = [
      job({ id: "a", cleanerId: null, cleanerName: null, propertyId: "p1" }),
      job({ id: "b", cleanerId: "c1", cleanerName: "Zoe", propertyId: "p1" }),
    ];
    const groups = groupJobsByCleaner(jobs, properties);
    expect(groups.map((g) => g.cleanerId)).toEqual(["c1", null]);
    expect(groups[groups.length - 1].cleanerName).toBeNull();
  });

  it("skips jobs whose property is missing from the map", () => {
    const jobs = [job({ id: "a", cleanerId: "c1", propertyId: "missing-prop" })];
    expect(groupJobsByCleaner(jobs, properties)).toHaveLength(0);
  });
});

describe("jobsToMarkPaid", () => {
  it("selects only completed+unpaid jobs for the given owner", () => {
    const jobs = [
      job({ id: "a", propertyId: "p1", status: "completed", paid: false }), // owner-1
      job({ id: "b", propertyId: "p2", status: "completed", paid: false }), // owner-1
      job({ id: "c", propertyId: "p1", status: "completed", paid: true }), // already paid
      job({ id: "d", propertyId: "p3", status: "completed", paid: false }), // owner-2
      job({ id: "e", propertyId: "p1", status: "assigned", paid: false }), // not completed
    ];
    const ids = jobsToMarkPaid(jobs, properties, { ownerId: "owner-1" });
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("scopes to a single cleaner across owners", () => {
    const jobs = [
      job({ id: "a", cleanerId: "c1", propertyId: "p1", status: "completed", paid: false }),
      job({ id: "b", cleanerId: "c1", propertyId: "p3", status: "completed", paid: false }),
      job({ id: "c", cleanerId: "c2", propertyId: "p1", status: "completed", paid: false }),
    ];
    const ids = jobsToMarkPaid(jobs, properties, { cleanerId: "c1" });
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("scopes to one owner within one cleaner", () => {
    const jobs = [
      job({ id: "a", cleanerId: "c1", propertyId: "p1", status: "completed", paid: false }), // owner-1
      job({ id: "b", cleanerId: "c1", propertyId: "p3", status: "completed", paid: false }), // owner-2
      job({ id: "c", cleanerId: "c2", propertyId: "p1", status: "completed", paid: false }), // other cleaner
    ];
    const ids = jobsToMarkPaid(jobs, properties, { cleanerId: "c1", ownerId: "owner-1" });
    expect(ids).toEqual(["a"]);
  });

  it("cleanerId null targets only unassigned cleans", () => {
    const jobs = [
      job({ id: "a", cleanerId: null, propertyId: "p1", status: "completed", paid: false }),
      job({ id: "b", cleanerId: "c1", propertyId: "p1", status: "completed", paid: false }),
    ];
    const ids = jobsToMarkPaid(jobs, properties, { cleanerId: null });
    expect(ids).toEqual(["a"]);
  });

  it("scopes to a date range when provided, boundaries inclusive", () => {
    const jobs = [
      job({ id: "a", propertyId: "p1", status: "completed", paid: false, date: "2026-06-15" }),
      job({ id: "b", propertyId: "p1", status: "completed", paid: false, date: "2026-07-07" }),
      job({ id: "c", propertyId: "p1", status: "completed", paid: false, date: "2026-07-13" }),
      job({ id: "d", propertyId: "p1", status: "completed", paid: false, date: "2026-07-14" }),
    ];
    const ids = jobsToMarkPaid(jobs, properties, {
      ownerId: "owner-1",
      from: "2026-07-07",
      to: "2026-07-13",
    });
    expect(ids.sort()).toEqual(["b", "c"]);
  });

  it("returns an empty array when nothing matches", () => {
    const jobs = [job({ id: "a", propertyId: "p1", status: "completed", paid: true })];
    expect(jobsToMarkPaid(jobs, properties, { ownerId: "owner-1" })).toEqual([]);
  });
});

/** Minimal CleanerGroup stand-in — only unpaidCount matters to the filter. */
function cleanerGroup(overrides: Partial<CleanerGroup>): CleanerGroup {
  return {
    cleanerId: "c1",
    cleanerName: "Karen",
    owners: [],
    unpaidCents: 0,
    unpaidCount: 0,
    totalCents: 0,
    ...overrides,
  };
}

describe("filterCleanerGroupsByPaidStatus", () => {
  const groups = [
    cleanerGroup({ cleanerId: "c1", unpaidCount: 2 }), // mixed: still owes
    cleanerGroup({ cleanerId: "c2", unpaidCount: 0 }), // fully settled
  ];

  it("unpaid keeps groups with any unpaid clean left", () => {
    expect(filterCleanerGroupsByPaidStatus(groups, "unpaid").map((g) => g.cleanerId)).toEqual(["c1"]);
  });

  it("paid keeps only fully settled groups", () => {
    expect(filterCleanerGroupsByPaidStatus(groups, "paid").map((g) => g.cleanerId)).toEqual(["c2"]);
  });

  it("undefined status passes everything through", () => {
    expect(filterCleanerGroupsByPaidStatus(groups).map((g) => g.cleanerId)).toEqual(["c1", "c2"]);
  });
});

describe("rangeSummary", () => {
  it("folds mixed paid/unpaid jobs across multiple cleaners and owners into correct totals", () => {
    const jobs = [
      // Karen (c1): owner-1/p1 unpaid 6500, owner-1/p2 paid 9000, owner-2/p3 unpaid 5000
      job({ id: "a", cleanerId: "c1", cleanerName: "Karen", propertyId: "p1", costCents: 6500, paid: false }),
      job({ id: "b", cleanerId: "c1", cleanerName: "Karen", propertyId: "p2", costCents: 9000, paid: true }),
      job({ id: "c", cleanerId: "c1", cleanerName: "Karen", propertyId: "p3", costCents: 5000, paid: false }),
      // Bob (c2): owner-1/p1 paid 4000, owner-2/p3 unpaid 3000
      job({ id: "d", cleanerId: "c2", cleanerName: "Bob", propertyId: "p1", costCents: 4000, paid: true }),
      job({ id: "e", cleanerId: "c2", cleanerName: "Bob", propertyId: "p3", costCents: 3000, paid: false }),
    ];
    const groups = groupJobsByCleaner(jobs, properties);
    const result = rangeSummary(groups);

    // Total: 6500 + 9000 + 5000 + 4000 + 3000 = 27500
    expect(result.totalCents).toBe(27500);
    expect(result.totalCount).toBe(5);

    // Paid: 9000 + 4000 = 13000 (jobs b and d)
    expect(result.paidCents).toBe(13000);
    expect(result.paidCount).toBe(2);

    // Unpaid: 6500 + 5000 + 3000 = 14500 (jobs a, c, e)
    expect(result.unpaidCents).toBe(14500);
    expect(result.unpaidCount).toBe(3);
  });

  it("all jobs paid returns zeros for unpaid fields and paid equals total", () => {
    const jobs = [
      job({ id: "a", cleanerId: "c1", cleanerName: "Karen", propertyId: "p1", costCents: 5000, paid: true }),
      job({ id: "b", cleanerId: "c1", cleanerName: "Karen", propertyId: "p2", costCents: 8000, paid: true }),
      job({ id: "c", cleanerId: "c2", cleanerName: "Bob", propertyId: "p3", costCents: 2000, paid: true }),
    ];
    const groups = groupJobsByCleaner(jobs, properties);
    const result = rangeSummary(groups);

    expect(result.totalCents).toBe(15000);
    expect(result.totalCount).toBe(3);
    expect(result.paidCents).toBe(15000);
    expect(result.paidCount).toBe(3);
    expect(result.unpaidCents).toBe(0);
    expect(result.unpaidCount).toBe(0);
  });

  it("empty groups array returns all zeros", () => {
    const result = rangeSummary([]);

    expect(result.totalCents).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.paidCents).toBe(0);
    expect(result.paidCount).toBe(0);
    expect(result.unpaidCents).toBe(0);
    expect(result.unpaidCount).toBe(0);
  });
});

describe("markPaidSchema", () => {
  it("rejects an empty body (no scope)", () => {
    expect(markPaidSchema.safeParse({}).success).toBe(false);
  });

  it("rejects from/to with no cleanerId or ownerId scope", () => {
    const result = markPaidSchema.safeParse({ from: "2026-07-07", to: "2026-07-13" });
    expect(result.success).toBe(false);
  });

  it("accepts an ownerId-only scope", () => {
    expect(markPaidSchema.safeParse({ ownerId: "o1" }).success).toBe(true);
  });

  it("accepts a null cleanerId scope (unassigned cleans)", () => {
    expect(markPaidSchema.safeParse({ cleanerId: null }).success).toBe(true);
  });

  it("does not carry a cleanerId key when only ownerId was sent", () => {
    const result = markPaidSchema.safeParse({ ownerId: "o1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("cleanerId" in result.data).toBe(false);
    }
  });

  it("rejects from after to", () => {
    const result = markPaidSchema.safeParse({
      ownerId: "o1",
      from: "2026-07-13",
      to: "2026-07-07",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a badly formatted date", () => {
    const result = markPaidSchema.safeParse({ ownerId: "o1", from: "07/07/2026" });
    expect(result.success).toBe(false);
  });
});

describe("weekTallies", () => {
  it("tallies two weeks with mixed paid/unpaid jobs, preserving order", () => {
    // weekTallies is week-convention-agnostic (billing passes Sat→Fri pay
    // weeks); these tests just use arbitrary 7-day windows.
    // Week 1: 2026-07-13 through 2026-07-19
    // Week 2: 2026-07-20 through 2026-07-26
    const jobs = [
      // Week 1: 2 jobs, 1 paid (3000), 1 unpaid (2000)
      { date: "2026-07-15", paid: true, costCents: 3000 },
      { date: "2026-07-17", paid: false, costCents: 2000 },
      // Week 2: 3 jobs, 1 paid (4000), 2 unpaid (1500 + 2500)
      { date: "2026-07-21", paid: true, costCents: 4000 },
      { date: "2026-07-22", paid: false, costCents: 1500 },
      { date: "2026-07-24", paid: false, costCents: 2500 },
    ];
    const weekStarts = ["2026-07-13", "2026-07-20"];
    const result = weekTallies(jobs, weekStarts);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ weekStart: "2026-07-13", count: 2, dueCents: 2000 });
    expect(result[1]).toEqual({ weekStart: "2026-07-20", count: 3, dueCents: 4000 });
  });

  it("returns count 0 and dueCents 0 for a week with no jobs", () => {
    const jobs = [
      { date: "2026-07-15", paid: false, costCents: 1000 },
    ];
    const weekStarts = ["2026-07-13", "2026-07-20"];
    const result = weekTallies(jobs, weekStarts);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ weekStart: "2026-07-13", count: 1, dueCents: 1000 });
    expect(result[1]).toEqual({ weekStart: "2026-07-20", count: 0, dueCents: 0 });
  });

  it("counts jobs on the first and last day of a week, but not the day after", () => {
    // Week of 2026-07-13 through 2026-07-19 (7 days inclusive)
    const jobs = [
      { date: "2026-07-13", paid: false, costCents: 1000 }, // first day of the week
      { date: "2026-07-19", paid: false, costCents: 2000 }, // last day of the week
      { date: "2026-07-20", paid: false, costCents: 3000 }, // first day of next week
    ];
    const weekStarts = ["2026-07-13"];
    const result = weekTallies(jobs, weekStarts);

    expect(result).toHaveLength(1);
    // Should count the first (1000) + last (2000) day, NOT the day after (3000)
    expect(result[0]).toEqual({ weekStart: "2026-07-13", count: 2, dueCents: 3000 });
  });

  it("only sums dueCents for unpaid jobs, counts all jobs regardless of paid status", () => {
    const jobs = [
      { date: "2026-07-15", paid: true, costCents: 5000 },
      { date: "2026-07-16", paid: false, costCents: 3000 },
      { date: "2026-07-17", paid: true, costCents: 2000 },
      { date: "2026-07-18", paid: false, costCents: 1500 },
    ];
    const weekStarts = ["2026-07-13"];
    const result = weekTallies(jobs, weekStarts);

    expect(result[0]).toEqual({ weekStart: "2026-07-13", count: 4, dueCents: 4500 });
  });

  it("handles empty jobs list", () => {
    const jobs: { date: string; paid: boolean; costCents: number }[] = [];
    const weekStarts = ["2026-07-13", "2026-07-20"];
    const result = weekTallies(jobs, weekStarts);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ weekStart: "2026-07-13", count: 0, dueCents: 0 });
    expect(result[1]).toEqual({ weekStart: "2026-07-20", count: 0, dueCents: 0 });
  });

  it("handles empty weekStarts list", () => {
    const jobs = [
      { date: "2026-07-15", paid: false, costCents: 1000 },
    ];
    const weekStarts: string[] = [];
    const result = weekTallies(jobs, weekStarts);

    expect(result).toHaveLength(0);
  });
});
