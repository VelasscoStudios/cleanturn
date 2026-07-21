import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCleanerApi } from "@/lib/auth";
import { todayStr, monthOf } from "@/lib/dates";

/** Accept only a well-formed YYYY-MM month; anything else falls back to null. */
function parseMonth(raw: string | null): string | null {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return null;
}

// A cleaner's own COMPLETED cleans for one month, newest first. This is the
// deliberate mirror of /api/my/jobs (which hides the past): history is past-
// only and read-only. It never exposes the property access code or the job's
// `paid` state — both stay admin-scoped.
export async function GET(req: Request) {
  const session = await requireCleanerApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const month = parseMonth(url.searchParams.get("month")) ?? monthOf(todayStr());
  // Job.date is a "YYYY-MM-DD" string, so a month is a lexicographic range.
  // "<month>-32" sorts after any real day ("...-31"), giving a clean upper bound.
  const start = `${month}-01`;
  const end = `${month}-32`;

  try {
    const jobs = await prisma.job.findMany({
      where: {
        cleanerId: session.id,
        status: "completed",
        date: { gte: start, lt: end },
      },
      include: {
        property: {
          select: { nickname: true, address: true, mapsUrl: true },
        },
      },
      orderBy: { date: "desc" },
    });

    // Distinct months this cleaner has completed cleans in — powers the picker
    // so it only ever offers months that actually have history.
    const monthRows = await prisma.job.findMany({
      where: { cleanerId: session.id, status: "completed" },
      select: { date: true },
    });
    const availableMonths = Array.from(
      new Set(monthRows.map((r) => monthOf(r.date)))
    ).sort((a, b) => (a < b ? 1 : -1)); // newest first

    const result = jobs.map((j) => ({
      id: j.id,
      date: j.date,
      costCents: j.costCents,
      arrivedAt: j.arrivedAt,
      cleanedAt: j.cleanedAt,
      property: {
        nickname: j.property.nickname,
        address: j.property.address,
        mapsUrl: j.property.mapsUrl,
      },
    }));

    const totalCents = result.reduce((sum, j) => sum + j.costCents, 0);

    return NextResponse.json({
      month,
      jobs: result,
      summary: { count: result.length, totalCents },
      availableMonths,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load your history" }, { status: 500 });
  }
}
