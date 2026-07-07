import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { setJobPaidSchema } from "@/lib/validation";

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

  const parsed = setJobPaidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "paid must be a boolean" }, { status: 400 });
  }
  const { paid } = parsed.data;

  try {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const updated = await prisma.job.update({
      where: { id },
      data: { paid, paidAt: paid ? new Date() : null },
    });

    return NextResponse.json({ job: updated });
  } catch {
    return NextResponse.json({ error: "Failed to update paid status" }, { status: 500 });
  }
}
