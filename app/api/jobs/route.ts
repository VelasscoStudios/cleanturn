import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { createManualJobSchema } from "@/lib/validation";
import { recomputeSameDayForProperty } from "@/lib/sync";
import { todayStr } from "@/lib/dates";
import { notifyCleaner } from "@/lib/notify";

// Manual clean: a job with no booking behind it. Sync reconciles the Booking
// table against the feed, so it can never create, move, or cancel these —
// they live and die by admin actions alone.
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

  const parsed = createManualJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const property = await prisma.property.findUnique({ where: { id: data.propertyId } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 400 });
    }

    if (data.cleanerId) {
      const cleaner = await prisma.cleaner.findUnique({ where: { id: data.cleanerId } });
      if (!cleaner || !cleaner.active) {
        return NextResponse.json({ error: "Cleaner not found" }, { status: 400 });
      }
    }

    const job = await prisma.job.create({
      data: {
        bookingId: null,
        propertyId: property.id,
        date: data.date,
        costCents: data.costCents ?? property.cleanCostCents,
        cleanerId: data.cleanerId ?? null,
        status: "assigned",
      },
    });

    // Same-day flag: a manual clean on a day a guest checks in is still a
    // same-day turnover for the cleaner.
    await recomputeSameDayForProperty(property.id, todayStr());

    if (job.cleanerId) {
      await notifyCleaner("job_assigned", job.id);
    }

    return NextResponse.json({ job }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}
