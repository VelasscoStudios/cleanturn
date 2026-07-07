import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, assertFetchHeader } from "@/lib/auth";
import { sessionUserExists } from "@/lib/session-user";
import { setJobStatusSchema } from "@/lib/validation";
import { cleanerTransition, adminTransition } from "@/lib/state";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Re-validate the account on every request: a deactivated/deleted user must
  // not be able to keep driving job status off a still-sealed cookie.
  if (!(await sessionUserExists(session))) {
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

  const parsed = setJobStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }
  const { status: desiredStatus } = parsed.data;

  try {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const transition =
      session.role === "admin"
        ? adminTransition(job, desiredStatus)
        : cleanerTransition(job, session.id, desiredStatus);

    if (!transition.ok) {
      // Cross-cleaner / not-your-job attempts are denied without leaking
      // whether the job exists in a different state for someone else.
      const status = session.role === "cleaner" && job.cleanerId !== session.id ? 403 : 400;
      return NextResponse.json({ error: transition.error }, { status });
    }

    const data: Record<string, unknown> = { status: transition.nextStatus };
    if (transition.stamp) {
      data[transition.stamp] = new Date();
    }

    const updated = await prisma.job.update({ where: { id }, data });
    return NextResponse.json({ job: updated });
  } catch {
    return NextResponse.json({ error: "Failed to update job status" }, { status: 500 });
  }
}
