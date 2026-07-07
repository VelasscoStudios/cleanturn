import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { todayStr, addDays } from "@/lib/dates";
import { scheduleQuerySchema } from "@/lib/validation";

export async function GET(req: Request) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawQuery = {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    propertyId: url.searchParams.get("propertyId") ?? undefined,
    cleanerId: url.searchParams.get("cleanerId") ?? undefined,
    unassigned: url.searchParams.get("unassigned") ?? undefined,
  };

  const parsed = scheduleQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const { from, to, propertyId, cleanerId, unassigned } = parsed.data;

  const today = todayStr();
  const fromDate = from ?? today;
  const toDate = to ?? addDays(today, 7);

  try {
    const jobs = await prisma.job.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        ...(propertyId ? { propertyId } : {}),
        ...(cleanerId ? { cleanerId } : {}),
        ...(unassigned ? { cleanerId: null } : {}),
      },
      include: {
        property: {
          select: {
            id: true,
            nickname: true,
            address: true,
            arriveTime: true,
            outByTime: true,
            accessCode: true,
          },
        },
        cleaner: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ jobs });
  } catch {
    return NextResponse.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}
