import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { updatePropertySchema } from "@/lib/validation";

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
    const property = await prisma.property.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true } } },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    return NextResponse.json({ property });
  } catch {
    return NextResponse.json({ error: "Failed to load property" }, { status: 500 });
  }
}

export async function PATCH(
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

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updatePropertySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    if (data.ownerId) {
      const owner = await prisma.owner.findUnique({ where: { id: data.ownerId } });
      if (!owner) {
        return NextResponse.json({ error: "Owner not found" }, { status: 400 });
      }
    }

    const property = await prisma.property.update({
      where: { id },
      data: {
        ...(data.ownerId !== undefined ? { ownerId: data.ownerId } : {}),
        ...(data.nickname !== undefined ? { nickname: data.nickname } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.icalUrl !== undefined ? { icalUrl: data.icalUrl } : {}),
        ...(data.cleanCostCents !== undefined ? { cleanCostCents: data.cleanCostCents } : {}),
        ...(data.directions !== undefined ? { directions: data.directions } : {}),
        ...(data.mapsUrl !== undefined ? { mapsUrl: data.mapsUrl } : {}),
        ...(data.accessCode !== undefined ? { accessCode: data.accessCode } : {}),
        ...(data.arriveTime !== undefined ? { arriveTime: data.arriveTime } : {}),
        ...(data.outByTime !== undefined ? { outByTime: data.outByTime } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });

    return NextResponse.json({ property });
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
        ? "A property with this iCal URL already exists"
        : "Failed to update property";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
