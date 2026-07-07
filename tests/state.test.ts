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
});

describe("cleanerTransition — legal forward transitions", () => {
  it("assigned -> in_progress stamps arrivedAt", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "in_progress");
    expect(result).toEqual({ ok: true, nextStatus: "in_progress", stamp: "arrivedAt" });
  });

  it("in_progress -> awaiting_confirm stamps leftAt", () => {
    const job = { id: "j1", status: "in_progress", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "awaiting_confirm");
    expect(result).toEqual({ ok: true, nextStatus: "awaiting_confirm", stamp: "leftAt" });
  });

  it("awaiting_confirm -> done stamps cleanedAt", () => {
    const job = { id: "j1", status: "awaiting_confirm", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "done");
    expect(result).toEqual({ ok: true, nextStatus: "done", stamp: "cleanedAt" });
  });
});

describe("cleanerTransition — illegal transitions", () => {
  it("rejects skipping a step (assigned -> awaiting_confirm)", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "awaiting_confirm");
    expect(result.ok).toBe(false);
  });

  it("rejects skipping straight to done", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "done");
    expect(result.ok).toBe(false);
  });

  it("rejects backward transitions", () => {
    const job = { id: "j1", status: "in_progress", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "assigned");
    expect(result.ok).toBe(false);
  });

  it("rejects moving from done anywhere", () => {
    const job = { id: "j1", status: "done", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "in_progress");
    expect(result.ok).toBe(false);
  });

  it("rejects moving from unassigned (cleaner cannot self-assign via status)", () => {
    const job = { id: "j1", status: "unassigned", cleanerId: null };
    const result = cleanerTransition(job, "c1", "in_progress");
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid target status", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "not_a_status");
    expect(result.ok).toBe(false);
  });

  it("rejects transitioning to cancelled via cleaner path", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = cleanerTransition(job, "c1", "cancelled");
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

  it("rejects when job is unassigned (cleanerId null) regardless of requester", () => {
    const job = { id: "j1", status: "unassigned", cleanerId: null };
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

  it("allows arbitrary jump (assigned -> done) without stamping bonus timestamps", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "done");
    expect(result).toEqual({ ok: true, nextStatus: "done", stamp: null });
  });

  it("allows moving backwards (done -> assigned) as a correction", () => {
    const job = { id: "j1", status: "done", cleanerId: "c1" };
    const result = adminTransition(job, "assigned");
    expect(result).toEqual({ ok: true, nextStatus: "assigned", stamp: null });
  });

  it("allows setting cancelled from any state", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "cancelled");
    expect(result).toEqual({ ok: true, nextStatus: "cancelled", stamp: null });
  });

  it("allows admin to assign unassigned -> assigned with no stamp", () => {
    const job = { id: "j1", status: "unassigned", cleanerId: null };
    const result = adminTransition(job, "assigned");
    expect(result).toEqual({ ok: true, nextStatus: "assigned", stamp: null });
  });

  it("still rejects an invalid target status", () => {
    const job = { id: "j1", status: "assigned", cleanerId: "c1" };
    const result = adminTransition(job, "bogus");
    expect(result.ok).toBe(false);
  });
});
