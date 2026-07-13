import { NextResponse } from "next/server";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { runSyncExclusive } from "@/lib/sync";

export async function POST(req: Request) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Coalesces with any in-flight run (e.g. a timer tick) — the button may
    // return that run's counts rather than starting a fresh one.
    const counts = await runSyncExclusive();
    return NextResponse.json(counts, { status: 200 });
  } catch (err) {
    console.error("[sync-now] runSync threw:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
