import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { assignJobSchema } from "@/lib/validation";
import { notifyCleaner } from "@/lib/notify";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = assignJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "cleanerId is required (string or null)" }, { status: 400 });
  }
  const { cleanerId } = parsed.data;

  try {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status === "cancelled") {
      return NextResponse.json({ error: "Cannot assign a cancelled job" }, { status: 409 });
    }

    if (cleanerId) {
      const cleaner = await prisma.cleaner.findUnique({ where: { id: cleanerId } });
      if (!cleaner || !cleaner.active) {
        return NextResponse.json({ error: "Cleaner not found" }, { status: 400 });
      }
    }

    const wasUnassigned = job.cleanerId === null;
    // Removing the cleaner from an in-progress job resets it to assigned
    // (nobody is on site anymore); terminal/assigned statuses are kept.
    const resetInProgress = !cleanerId && job.status === "in_progress";

    const updated = await prisma.job.update({
      where: { id },
      data: {
        cleanerId,
        ...(resetInProgress ? { status: "assigned", arrivedAt: null } : {}),
      },
    });

    // Notify only when a cleaner is newly assigned (was unassigned/different, now set).
    if (cleanerId && (wasUnassigned || job.cleanerId !== cleanerId)) {
      await notifyCleaner("job_assigned", updated.id);
    }

    return NextResponse.json({ job: updated });
  } catch {
    return NextResponse.json({ error: "Failed to assign job" }, { status: 500 });
  }
}
