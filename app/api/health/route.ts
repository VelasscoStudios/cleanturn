import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";

export async function GET() {
  // Liveness/readiness probe. Anonymous callers get only a bare up/down with
  // the correct HTTP status — no DB state or sync timestamps leaked. Admins
  // get the detailed view for troubleshooting.
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ ok: dbOk }, { status: dbOk ? 200 : 503 });
  }

  let lastSyncAt: string | null = null;
  try {
    const latest = await prisma.property.findFirst({
      where: { lastSyncAt: { not: null } },
      orderBy: { lastSyncAt: "desc" },
      select: { lastSyncAt: true },
    });
    lastSyncAt = latest?.lastSyncAt ? latest.lastSyncAt.toISOString() : null;
  } catch {
    lastSyncAt = null;
  }

  return NextResponse.json({ ok: dbOk, dbOk, lastSyncAt }, { status: dbOk ? 200 : 503 });
}
