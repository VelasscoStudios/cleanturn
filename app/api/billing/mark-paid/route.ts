import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { markPaidSchema } from "@/lib/validation";
import { jobsToMarkPaid, type BillingJob, type BillingProperty } from "@/lib/billing";

export async function POST(req: Request) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = markPaidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "cleanerId or ownerId is required" }, { status: 400 });
  }
  const { cleanerId, ownerId, from, to } = parsed.data;

  try {
    // Scope the property fetch to the owner when given so we load only what we
    // need; the cleaner filter is applied per-job below.
    const properties = await prisma.property.findMany({
      where: ownerId ? { ownerId } : undefined,
      select: { id: true, nickname: true, ownerId: true },
    });
    const propertiesById: Record<string, BillingProperty> = Object.fromEntries(
      properties.map((p) => [p.id, p])
    );
    const propertyIds = properties.map((p) => p.id);

    const jobs = await prisma.job.findMany({
      where: { propertyId: { in: propertyIds } },
    });
    const billingJobs: BillingJob[] = jobs.map((j) => ({
      id: j.id,
      propertyId: j.propertyId,
      date: j.date,
      costCents: j.costCents,
      status: j.status,
      paid: j.paid,
      paidAt: j.paidAt,
      cleanerId: j.cleanerId,
    }));

    const idsToMark = jobsToMarkPaid(billingJobs, propertiesById, {
      // Pass cleanerId through only when the caller sent the key (including
      // null for "unassigned"); omitting it means "any cleaner".
      ...("cleanerId" in parsed.data ? { cleanerId } : {}),
      ownerId,
      from,
      to,
    });

    // Guard against a concurrent mark-paid: only flip jobs still unpaid, so a
    // job someone else just paid keeps its original paidAt. That `paid: false`
    // condition means updateMany can affect fewer rows than idsToMark, so
    // capture its count rather than assuming every candidate flipped.
    const { count } =
      idsToMark.length > 0
        ? await prisma.job.updateMany({
            where: { id: { in: idsToMark }, paid: false },
            data: { paid: true, paidAt: new Date() },
          })
        : { count: 0 };

    // jobIds are the requested candidates (completed+unpaid at read time);
    // markedCount is how many rows the update actually flipped.
    return NextResponse.json({ markedCount: count, jobIds: idsToMark });
  } catch {
    return NextResponse.json({ error: "Failed to mark cleans paid" }, { status: 500 });
  }
}
