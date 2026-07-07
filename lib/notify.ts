import { prisma } from "./db";

/**
 * lib/notify.ts — exact contract required by brief §5 (frozen for A3 to
 * import as-is).
 *
 * Both functions: load whatever they need themselves, write a
 * NotificationLog row, console.log the message, and NEVER throw into the
 * caller — a notification failure must never fail the request/sync that
 * triggered it.
 *
 * Templates (spec §4.3): no access codes, no costs in message text.
 */

/**
 * Day-one kill switch: SMS/WhatsApp/email are not in use yet, so the whole
 * notification pipeline is PARKED unless NOTIFICATIONS_ENABLED=true in .env.
 * While parked, notifyCleaner/notifyAdmin are silent no-ops — no console
 * output, no NotificationLog rows. All callers already treat notifications
 * as fire-and-forget, so nothing else changes. Flip the flag to un-park;
 * real providers (Twilio/Resend) slot in below when the time comes.
 */
function notificationsEnabled(): boolean {
  return process.env.NOTIFICATIONS_ENABLED === "true";
}

const CLEANER_TEMPLATES = {
  job_assigned: "New clean",
  job_moved: "Clean rescheduled",
  job_cancelled: "Clean cancelled",
} as const;

type CleanerTemplate = keyof typeof CLEANER_TEMPLATES;

async function logNotification(entry: {
  jobId: string | null;
  channel: string;
  recipient: string;
  template: string;
  status: "sent" | "failed";
  error?: string | null;
}): Promise<void> {
  try {
    await prisma.notificationLog.create({
      data: {
        jobId: entry.jobId,
        channel: entry.channel,
        recipient: entry.recipient,
        template: entry.template,
        status: entry.status,
        error: entry.error ?? null,
      },
    });
  } catch (err) {
    // Never throw — logging the log failure to console is the best we can
    // do here.
    console.error("[notify] failed to write NotificationLog row:", err);
  }
}

export async function notifyCleaner(
  template: CleanerTemplate,
  jobId: string
): Promise<void> {
  if (!notificationsEnabled()) return;
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { property: true, cleaner: true },
    });

    if (!job) {
      await logNotification({
        jobId,
        channel: "console",
        recipient: "unknown",
        template,
        status: "failed",
        error: "Job not found",
      });
      return;
    }

    if (!job.cleaner) {
      // Nothing to notify — no cleaner assigned. Not an error condition.
      return;
    }

    const label = CLEANER_TEMPLATES[template];
    const message = `[CleanTurn] ${label}: ${job.property.nickname}, ${job.date}. Arrive ${job.property.arriveTime}, out by ${job.property.outByTime}. Details: /my`;

    console.log(`[notify:cleaner:${template}] -> ${job.cleaner.phone}: ${message}`);

    await logNotification({
      jobId: job.id,
      channel: "console",
      recipient: job.cleaner.phone,
      template,
      status: "sent",
    });
  } catch (err) {
    console.error("[notify] notifyCleaner failed:", err);
    await logNotification({
      jobId,
      channel: "console",
      recipient: "unknown",
      template,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function notifyAdmin(message: string): Promise<void> {
  if (!notificationsEnabled()) return;
  try {
    console.log(`[notify:admin] ${message}`);

    await logNotification({
      jobId: null,
      channel: "console",
      recipient: "admin",
      template: "admin_alert",
      status: "sent",
    });
  } catch (err) {
    console.error("[notify] notifyAdmin failed:", err);
    await logNotification({
      jobId: null,
      channel: "console",
      recipient: "admin",
      template: "admin_alert",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
