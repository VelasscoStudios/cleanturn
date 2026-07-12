/**
 * Pure job state machine.
 *
 * Cleaner-driven transitions are strictly forward, one step at a time, and
 * only permitted on the cleaner's OWN job:
 *   assigned -> in_progress -> completed
 * Each transition stamps a timestamp server-side:
 *   assigned -> in_progress stamps arrivedAt
 *   in_progress -> completed stamps cleanedAt
 * "cancelled" is deliberately unreachable from the cleaner path: only an
 * admin (the owner) or the iCal sync (a booking disappearing from the feed)
 * may cancel a job.
 *
 * Admins may set any status (corrections) without the forward-only guard,
 * subject only to the JOB_STATUSES enum. Admin transitions still stamp the
 * appropriate timestamp fields when moving forward through the normal
 * sequence, but are not restricted to it (e.g. an admin can jump straight to
 * "completed" or move a job backwards).
 *
 * There is no "unassigned" status: whether a job has a cleaner is carried by
 * cleanerId alone (null = unassigned), so the two axes can't disagree.
 */

export type JobStatus = "assigned" | "in_progress" | "completed" | "cancelled";

export const JOB_STATUSES: readonly JobStatus[] = [
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
];

export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

/** The single legal next status for a cleaner-driven forward transition. */
const CLEANER_FORWARD: Partial<Record<JobStatus, JobStatus>> = {
  assigned: "in_progress",
  in_progress: "completed",
};

export type TimestampField = "arrivedAt" | "cleanedAt";

/** Which timestamp field a transition stamps, keyed by the resulting status. */
const STAMP_FOR_RESULT: Partial<Record<JobStatus, TimestampField>> = {
  in_progress: "arrivedAt",
  completed: "cleanedAt",
};

export type JobLike = {
  id: string;
  status: string;
  cleanerId: string | null;
};

export type TransitionResult =
  | { ok: true; nextStatus: JobStatus; stamp: TimestampField | null }
  | { ok: false; error: string };

/**
 * Validate + compute a cleaner-initiated status transition.
 * Returns the resulting status and which timestamp field (if any) to stamp
 * with `new Date()` by the caller. Never mutates anything — pure function.
 */
export function cleanerTransition(
  job: JobLike,
  requestingCleanerId: string,
  desiredStatus: string
): TransitionResult {
  if (!isJobStatus(desiredStatus)) {
    return { ok: false, error: `Invalid status: ${desiredStatus}` };
  }
  if (job.cleanerId !== requestingCleanerId) {
    return { ok: false, error: "Job is not assigned to you" };
  }
  if (!isJobStatus(job.status)) {
    return { ok: false, error: `Job has invalid current status: ${job.status}` };
  }
  const allowedNext = CLEANER_FORWARD[job.status];
  if (!allowedNext || allowedNext !== desiredStatus) {
    return {
      ok: false,
      error: `Cannot transition from ${job.status} to ${desiredStatus}`,
    };
  }
  return {
    ok: true,
    nextStatus: allowedNext,
    stamp: STAMP_FOR_RESULT[allowedNext] ?? null,
  };
}

/**
 * Validate an admin-initiated status transition. Admins may set any status
 * (corrections) — the only guard is that the target is a legal JobStatus.
 * If the transition matches a normal forward step, the corresponding
 * timestamp is still stamped (keeps timestamps meaningful); arbitrary jumps
 * stamp nothing extra.
 */
export function adminTransition(
  job: JobLike,
  desiredStatus: string
): TransitionResult {
  if (!isJobStatus(desiredStatus)) {
    return { ok: false, error: `Invalid status: ${desiredStatus}` };
  }
  const isNormalForwardStep =
    isJobStatus(job.status) && CLEANER_FORWARD[job.status] === desiredStatus;
  return {
    ok: true,
    nextStatus: desiredStatus,
    stamp: isNormalForwardStep ? STAMP_FOR_RESULT[desiredStatus] ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// Cleaner-visibility rules (pure, date-string arithmetic only — no I/O).
// ---------------------------------------------------------------------------

/** Absolute difference in days between two YYYY-MM-DD strings (lexicographic-safe, calendar-correct). */
export function dayDiff(a: string, b: string): number {
  const toUtcDays = (s: string): number => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return Math.abs(toUtcDays(a) - toUtcDays(b));
}

/**
 * Access code is included in a cleaner's job payload ONLY when the job is
 * assigned to that cleaner AND the job date is within 1 day of today
 * (|job.date - today| <= 1). Never true for unassigned (cleanerId null) jobs
 * or other cleaners' jobs — callers must additionally ensure the job belongs
 * to the requesting cleaner before calling this.
 */
export function accessCodeVisible(
  job: { status: string; cleanerId: string | null; date: string },
  requestingCleanerId: string,
  today: string
): boolean {
  if (job.cleanerId !== requestingCleanerId) return false;
  if (job.status === "cancelled") return false;
  return dayDiff(job.date, today) <= 1;
}

/**
 * Whether a job (by date + status) belongs on a cleaner's /my/jobs list:
 * today + future, plus yesterday if not completed. Pure date/status check —
 * cleaner-ownership must be checked separately by the caller.
 */
export function isVisibleOnMyJobs(
  job: { status: string; date: string },
  today: string
): boolean {
  if (job.date >= today) return true;
  const yesterday = dayDiff(job.date, today) === 1 && job.date < today;
  if (yesterday && job.status !== "completed") return true;
  return false;
}
