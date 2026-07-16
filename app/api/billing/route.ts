import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { billingQuerySchema } from "@/lib/validation";
import { filterCompletedJobs, filterByPaidStatus, groupJobsByOwner } from "@/lib/billing";

export async function GET(req: Request) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawQuery = {
    ownerId: url.searchParams.get("ownerId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };

  const parsed = billingQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const { ownerId, status, from, to } = parsed.data;

  try {
    const properties = await prisma.property.findMany({
      select: { id: true, nickname: true, ownerId: true },
      ...(ownerId ? { where: { ownerId } } : {}),
    });
    const propertiesById = Object.fromEntries(properties.map((p) => [p.id, p]));
    const propertyIds = properties.map((p) => p.id);

    const jobs = await prisma.job.findMany({
      where: { propertyId: { in: propertyIds } },
      include: { cleaner: { select: { id: true, name: true } } },
    });

    const billingJobs = jobs.map((j) => ({
      id: j.id,
      propertyId: j.propertyId,
      date: j.date,
      costCents: j.costCents,
      status: j.status,
      paid: j.paid,
      paidAt: j.paidAt,
      cleanerId: j.cleanerId,
      cleanerName: j.cleaner?.name ?? null,
    }));

    const completed = filterCompletedJobs(billingJobs, { from, to });
    const filtered = filterByPaidStatus(completed, status);
    const groups = groupJobsByOwner(filtered, propertiesById);

    // Attach owner display info.
    const ownerIds = groups.map((g) => g.ownerId);
    const owners = await prisma.owner.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, name: true, billingNotes: true },
    });
    const ownersById = Object.fromEntries(owners.map((o) => [o.id, o]));

    const result = groups.map((g) => ({
      owner: ownersById[g.ownerId] ?? { id: g.ownerId, name: "Unknown", billingNotes: "" },
      jobs: g.jobs,
      unpaidCents: g.unpaidCents,
      unpaidCount: g.unpaidCount,
      totalCents: g.totalCents,
    }));

    return NextResponse.json({ owners: result });
  } catch {
    return NextResponse.json({ error: "Failed to load billing" }, { status: 500 });
  }
}
