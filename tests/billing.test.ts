import { describe, it, expect } from "vitest";
import {
  monthPrefix,
  filterCompletedJobs,
  groupJobsByOwner,
  unpaidTotalCents,
  filterByPaidStatus,
  jobsToMarkPaid,
  type BillingJob,
  type BillingProperty,
} from "../lib/billing";

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

describe("monthPrefix", () => {
  it("extracts YYYY-MM from a YYYY-MM-DD string", () => {
    expect(monthPrefix("2026-07-15")).toBe("2026-07");
  });
});

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

  it("filters additionally by month prefix on job.date", () => {
    const jobs = [
      job({ id: "a", status: "completed", date: "2026-06-30" }),
      job({ id: "b", status: "completed", date: "2026-07-01" }),
      job({ id: "c", status: "completed", date: "2026-07-15" }),
    ];
    const result = filterCompletedJobs(jobs, "2026-07");
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

describe("jobsToMarkPaid", () => {
  it("selects only completed+unpaid jobs for the given owner", () => {
    const jobs = [
      job({ id: "a", propertyId: "p1", status: "completed", paid: false }), // owner-1
      job({ id: "b", propertyId: "p2", status: "completed", paid: false }), // owner-1
      job({ id: "c", propertyId: "p1", status: "completed", paid: true }), // already paid
      job({ id: "d", propertyId: "p3", status: "completed", paid: false }), // owner-2
      job({ id: "e", propertyId: "p1", status: "assigned", paid: false }), // not completed
    ];
    const ids = jobsToMarkPaid(jobs, "owner-1", properties);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("scopes to a month when provided", () => {
    const jobs = [
      job({ id: "a", propertyId: "p1", status: "completed", paid: false, date: "2026-06-15" }),
      job({ id: "b", propertyId: "p1", status: "completed", paid: false, date: "2026-07-15" }),
    ];
    const ids = jobsToMarkPaid(jobs, "owner-1", properties, "2026-07");
    expect(ids).toEqual(["b"]);
  });

  it("returns an empty array when nothing matches", () => {
    const jobs = [job({ id: "a", propertyId: "p1", status: "completed", paid: true })];
    expect(jobsToMarkPaid(jobs, "owner-1", properties)).toEqual([]);
  });
});
