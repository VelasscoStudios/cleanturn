import { NextResponse } from "next/server";
import { demoProperties, demoEvents, eventsToIcs } from "@/lib/fixtures";
import { todayStr } from "@/lib/dates";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  // Dev-only fixture feed. Never expose it in production, even though it only
  // returns synthetic data — keep the deployed surface minimal.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { key } = await params;

  const known = demoProperties.some((p) => p.key === key);
  if (!known) {
    return NextResponse.json({ error: "Unknown feed" }, { status: 404 });
  }

  const events = demoEvents(key, todayStr());
  const ics = eventsToIcs(events);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}
