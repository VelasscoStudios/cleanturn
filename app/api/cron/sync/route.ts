import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { runSyncExclusive } from "@/lib/sync";

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against a same-length dummy to keep timing constant-ish even
    // on length mismatch, then always return false.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${cronSecret}`;

  if (!constantTimeEquals(authHeader, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const counts = await runSyncExclusive();
    return NextResponse.json(counts, { status: 200 });
  } catch (err) {
    console.error("[cron/sync] runSync threw:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
