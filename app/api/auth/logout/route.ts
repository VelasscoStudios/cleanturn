import { NextResponse } from "next/server";
import { getSession, destroySession, assertFetchHeader } from "@/lib/auth";

export async function POST(req: Request) {
  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await destroySession();
  return NextResponse.json({ ok: true });
}
