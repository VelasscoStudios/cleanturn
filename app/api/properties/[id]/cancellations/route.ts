import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { previewCancellations, applyApprovedCancellations } from "@/lib/sync";

/**
 * Held-cancellation review for a property whose sync circuit breaker tripped.
 * GET  -> the future bookings the live feed would cancel (read-only).
 * POST -> { bookingIds } apply those cancellations after the admin confirmed
 *         them in Airbnb. Ids no longer missing from the feed are ignored.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const cancellations = await previewCancellations(id);
    return NextResponse.json({ cancellations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read feed";
    return NextResponse.json({ error: message }, { status: message === "Property not found" ? 404 : 502 });
  }
}

const applySchema = z.object({
  bookingIds: z.array(z.string().min(1)).min(1).max(500),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = applySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bookingIds required" }, { status: 400 });
  }

  const { id } = await params;
  try {
    const result = await applyApprovedCancellations(id, parsed.data.bookingIds);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply";
    return NextResponse.json({ error: message }, { status: message === "Property not found" ? 404 : 502 });
  }
}
