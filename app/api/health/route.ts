import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  let dbOk = false;
  let lastSyncAt: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

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

  return NextResponse.json({ ok: true, dbOk, lastSyncAt });
}
