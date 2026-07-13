import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";

// The sync timer fires every 10 min; a last-good-sync older than this means
// the scheduler itself is dead or every feed is failing. This is the ONLY
// out-of-band canary — all other sync alerts fire from inside runSync, so a
// dead timer can never report itself.
const SYNC_STALE_MS = 35 * 60 * 1000;

export async function GET() {
  // Liveness/readiness probe. Anonymous callers get up/down plus a single
  // syncFresh boolean (for external uptime pingers to keyword-match on — it
  // leaks no dates or DB state). The HTTP status stays tied to DB health only,
  // so the deploy health-check gate is unaffected by sync staleness. Admins
  // get the detailed view for troubleshooting.
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  let lastSyncAt: Date | null = null;
  let activeProperties = 0;
  try {
    const [latest, count] = await Promise.all([
      prisma.property.findFirst({
        where: { lastSyncAt: { not: null } },
        orderBy: { lastSyncAt: "desc" },
        select: { lastSyncAt: true },
      }),
      prisma.property.count({ where: { active: true } }),
    ]);
    lastSyncAt = latest?.lastSyncAt ?? null;
    activeProperties = count;
  } catch {
    lastSyncAt = null;
  }

  // Fresh when there is nothing to sync, or the newest lastSyncAt is recent.
  const syncFresh =
    activeProperties === 0 ||
    (lastSyncAt !== null && Date.now() - lastSyncAt.getTime() < SYNC_STALE_MS);

  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ ok: dbOk, syncFresh }, { status: dbOk ? 200 : 503 });
  }

  return NextResponse.json(
    {
      ok: dbOk,
      dbOk,
      syncFresh,
      lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
    },
    { status: dbOk ? 200 : 503 }
  );
}
