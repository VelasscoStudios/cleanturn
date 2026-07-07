import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { markOwnerPaidSchema } from "@/lib/validation";
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

  const parsed = markOwnerPaidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "ownerId is required" }, { status: 400 });
  }
  const { ownerId, month } = parsed.data;

  try {
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const properties = await prisma.property.findMany({
      where: { ownerId },
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

    const idsToMark = jobsToMarkPaid(billingJobs, ownerId, propertiesById, month);

    if (idsToMark.length > 0) {
      await prisma.job.updateMany({
        where: { id: { in: idsToMark } },
        data: { paid: true, paidAt: new Date() },
      });
    }

    return NextResponse.json({ markedCount: idsToMark.length, jobIds: idsToMark });
  } catch {
    return NextResponse.json({ error: "Failed to mark owner paid" }, { status: 500 });
  }
}
