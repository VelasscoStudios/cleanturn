import { describe, it, expect } from "vitest";
import { accessCodeVisible, isVisibleOnMyJobs, dayDiff } from "../lib/state";

describe("dayDiff", () => {
  it("is 0 for the same date", () => {
    expect(dayDiff("2026-07-06", "2026-07-06")).toBe(0);
  });

  it("is 1 for adjacent days regardless of order", () => {
    expect(dayDiff("2026-07-06", "2026-07-07")).toBe(1);
    expect(dayDiff("2026-07-07", "2026-07-06")).toBe(1);
  });

  it("handles month boundaries correctly", () => {
    expect(dayDiff("2026-06-30", "2026-07-01")).toBe(1);
  });

  it("is large across a wide gap", () => {
    expect(dayDiff("2026-07-01", "2026-07-10")).toBe(9);
  });
});

describe("accessCodeVisible — access-code ±1-day rule", () => {
  const today = "2026-07-06";

  it("is true when assigned to requester and date is today", () => {
    const job = { status: "assigned", cleanerId: "c1", date: "2026-07-06" };
    expect(accessCodeVisible(job, "c1", today)).toBe(true);
  });

  it("is true when assigned to requester and date is tomorrow (+1)", () => {
    const job = { status: "assigned", cleanerId: "c1", date: "2026-07-07" };
    expect(accessCodeVisible(job, "c1", today)).toBe(true);
  });

  it("is true when assigned to requester and date is yesterday (-1)", () => {
    const job = { status: "in_progress", cleanerId: "c1", date: "2026-07-05" };
    expect(accessCodeVisible(job, "c1", today)).toBe(true);
  });

  it("is false when date is 2 days away", () => {
    const job = { status: "assigned", cleanerId: "c1", date: "2026-07-08" };
    expect(accessCodeVisible(job, "c1", today)).toBe(false);
  });

  it("is false when date is 2 days in the past", () => {
    const job = { status: "completed", cleanerId: "c1", date: "2026-07-04" };
    expect(accessCodeVisible(job, "c1", today)).toBe(false);
  });

  it("is false when job belongs to a different cleaner, even within the date window", () => {
    const job = { status: "assigned", cleanerId: "other-cleaner", date: "2026-07-06" };
    expect(accessCodeVisible(job, "c1", today)).toBe(false);
  });

  it("is false when job has no cleaner (unassigned) even if requester matches somehow", () => {
    const job = { status: "assigned", cleanerId: null, date: "2026-07-06" };
    expect(accessCodeVisible(job, "c1", today)).toBe(false);
  });

  it("is false when job is cancelled, even within the window and assigned", () => {
    const job = { status: "cancelled", cleanerId: "c1", date: "2026-07-06" };
    expect(accessCodeVisible(job, "c1", today)).toBe(false);
  });

  it("is true for a completed job within the window (still same-day/adjacent visibility)", () => {
    const job = { status: "completed", cleanerId: "c1", date: "2026-07-06" };
    expect(accessCodeVisible(job, "c1", today)).toBe(true);
  });
});

describe("isVisibleOnMyJobs — today + future, plus yesterday if not completed", () => {
  const today = "2026-07-06";

  it("today's job is visible", () => {
    expect(isVisibleOnMyJobs({ status: "assigned", date: "2026-07-06" }, today)).toBe(true);
  });

  it("future job is visible", () => {
    expect(isVisibleOnMyJobs({ status: "assigned", date: "2026-07-09" }, today)).toBe(true);
  });

  it("yesterday's not-completed job is visible", () => {
    expect(isVisibleOnMyJobs({ status: "in_progress", date: "2026-07-05" }, today)).toBe(true);
  });

  it("yesterday's completed job is NOT visible", () => {
    expect(isVisibleOnMyJobs({ status: "completed", date: "2026-07-05" }, today)).toBe(false);
  });

  it("job from 2+ days ago is not visible even if not completed", () => {
    expect(isVisibleOnMyJobs({ status: "assigned", date: "2026-07-03" }, today)).toBe(false);
  });

  it("job from 2+ days ago that is completed is not visible", () => {
    expect(isVisibleOnMyJobs({ status: "completed", date: "2026-07-01" }, today)).toBe(false);
  });
});
