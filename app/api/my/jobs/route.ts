import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCleanerApi } from "@/lib/auth";
import { todayStr, addDays } from "@/lib/dates";
import { accessCodeVisible, isVisibleOnMyJobs } from "@/lib/state";

export async function GET() {
  const session = await requireCleanerApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayStr();
  const yesterday = addDays(today, -1);

  try {
    // Own jobs only: today + future, plus yesterday (further filtered to
    // "not completed" below via isVisibleOnMyJobs).
    const jobs = await prisma.job.findMany({
      where: {
        cleanerId: session.id,
        date: { gte: yesterday },
        status: { not: "cancelled" },
      },
      include: {
        property: {
          select: {
            nickname: true,
            address: true,
            mapsUrl: true,
            directions: true,
            notes: true,
            arriveTime: true,
            outByTime: true,
            accessCode: true,
          },
        },
      },
      orderBy: { date: "asc" },
    });

    const visible = jobs.filter((j) => isVisibleOnMyJobs({ status: j.status, date: j.date }, today));

    const result = visible.map((j) => {
      const showAccessCode = accessCodeVisible(
        { status: j.status, cleanerId: j.cleanerId, date: j.date },
        session.id,
        today
      );

      return {
        id: j.id,
        date: j.date,
        status: j.status,
        costCents: j.costCents,
        sameDayTurnover: j.sameDayTurnover,
        nextCheckinNote: j.nextCheckinNote,
        property: {
          nickname: j.property.nickname,
          address: j.property.address,
          mapsUrl: j.property.mapsUrl,
          directions: j.property.directions,
          notes: j.property.notes,
          arriveTime: j.property.arriveTime,
          outByTime: j.property.outByTime,
          ...(showAccessCode ? { accessCode: j.property.accessCode } : {}),
        },
      };
    });

    return NextResponse.json({ jobs: result });
  } catch {
    return NextResponse.json({ error: "Failed to load your jobs" }, { status: 500 });
  }
}
