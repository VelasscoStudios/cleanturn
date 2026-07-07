import { NextResponse } from "next/server";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { runSync } from "@/lib/sync";

export async function POST(req: Request) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const counts = await runSync();
    return NextResponse.json(counts, { status: 200 });
  } catch (err) {
    console.error("[sync-now] runSync threw:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
