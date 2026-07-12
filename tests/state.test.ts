import { describe, it, expect } from "vitest";
import {
  cleanerTransition,
  adminTransition,
  isJobStatus,
  JOB_STATUSES,
} from "../lib/state";

describe("isJobStatus", () => {
  it("accepts all known statuses", () => {
    for (const s of JOB_STATUSES) {
      expect(isJobStatus(s)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isJobStatus("bogus")).toBe(false);
    expect(isJobStatus("")).toBe(false);
  });

  it("rejects retired legacy statuses", () => {
    expect(isJobStatus("unassigned")).toBe(false);
    expect(isJobStatus("awaiting_confirm")).toBe(false);
    expect(isJobStatus("done")).toBe(false);
  });
});

describe("cleanerTransition — legal forward transitions", () => {
  it("assigned -> in_progress stamps arrivedAt", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "in_progress");
    expect(result).toEqual({ ok: true, nextStatus: "in_progress", stamp: "arrivedAt" });
  });

  it("in_progress -> completed stamps cleanedAt", () => {
    const job = { id: "j1", status: "in_progress", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "completed");
    expect(result).toEqual({ ok: true, nextStatus: "completed", stamp: "cleanedAt" });
  });
});

describe("cleanerTransition — illegal transitions", () => {
  it("rejects skipping straight to completed", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "completed");
    expect(result.ok).toBe(false);
  });

  it("rejects backward transitions", () => {
    const job = { id: "j1", status: "in_progress", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "assigned");
    expect(result.ok).toBe(false);
  });

  it("rejects moving from completed anywhere", () => {
    const job = { id: "j1", status: "completed", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "in_progress");
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid target status", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "not_a_status");
    expect(result.ok).toBe(false);
  });

  it("rejects cancelling via the cleaner path from every status", () => {
    for (const status of JOB_STATUSES) {
      const job = { id: "j1", status, cleanerId: "c1" };
      const result = cleanerTransition(job, "c1", "cancelled");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a cleaner reactivating a cancelled job", () => {
    const job = { id: "j1", status: "cancelled", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "in_progress");
    expect(result.ok).toBe(false);
  });
});

describe("cleanerTransition — cross-cleaner denial", () => {
  it("rejects when job.cleanerId does not match requesting cleaner", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "cleaner-A" };
    const result = cleanerTransition(job, "cleaner-B", "in_progress");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not assigned to you/i);
    }
  });

  it("rejects when job has no cleaner (unassigned) regardless of requester", () => {
    const job = { id: "j1", status: "assigned", cleanerId: null };
    const result = cleanerTransition(job, "cleaner-B", "in_progress");
    expect(result.ok).toBe(false);
  });

  it("does not leak which status would have been valid for another cleaner's job", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "cleaner-A" };
    const result = cleanerTransition(job, "cleaner-B", "in_progress");
    expect(result.ok).toBe(false);
  });
});

describe("adminTransition — admin may set any status", () => {
  it("allows normal forward step and stamps the timestamp", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "in_progress");
    expect(result).toEqual({ ok: true, nextStatus: "in_progress", stamp: "arrivedAt" });
  });

  it("allows arbitrary jump (assigned -> completed) without stamping bonus timestamps", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "completed");
    expect(result).toEqual({ ok: true, nextStatus: "completed", stamp: null });
  });

  it("allows moving backwards (completed -> assigned) as a correction", () => {
    const job = { id: "j1", status: "completed", cleanerId: "c1" };
    const result = adminTransition(job, "assigned");
    expect(result).toEqual({ ok: true, nextStatus: "assigned", stamp: null });
  });

  it("allows setting cancelled from any state", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "cancelled");
    expect(result).toEqual({ ok: true, nextStatus: "cancelled", stamp: null });
  });

  it("still rejects an invalid target status", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "bogus");
    expect(result.ok).toBe(false);
  });

  it("rejects retired legacy statuses as targets", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    expect(adminTransition(job, "done").ok).toBe(false);
    expect(adminTransition(job, "awaiting_confirm").ok).toBe(false);
    expect(adminTransition(job, "unassigned").ok).toBe(false);
  });
});
