import { NextResponse } from "next/server";
import { demoProperties, demoEvents, eventsToIcs } from "@/lib/fixtures";
import { todayStr } from "@/lib/dates";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
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
