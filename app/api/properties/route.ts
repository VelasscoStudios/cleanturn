import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { createPropertySchema } from "@/lib/validation";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const properties = await prisma.property.findMany({
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ properties });
  } catch {
    return NextResponse.json({ error: "Failed to load properties" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPropertySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid property data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const owner = await prisma.owner.findUnique({ where: { id: data.ownerId } });
    if (!owner) {
      return NextResponse.json({ error: "Owner not found" }, { status: 400 });
    }

    const property = await prisma.property.create({
      data: {
        ownerId: data.ownerId,
        nickname: data.nickname,
        address: data.address,
        icalUrl: data.icalUrl,
        cleanCostCents: data.cleanCostCents,
        directions: data.directions,
        mapsUrl: data.mapsUrl ?? null,
        accessCode: data.accessCode,
        arriveTime: data.arriveTime,
        outByTime: data.outByTime,
        notes: data.notes,
        syncStatus: "pending",
      },
    });

    return NextResponse.json({ property }, { status: 201 });
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
        ? "A property with this iCal URL already exists"
        : "Failed to create property";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
