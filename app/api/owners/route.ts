import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { createOwnerSchema } from "@/lib/validation";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const owners = await prisma.owner.findMany({
      include: { properties: { select: { id: true, nickname: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ owners });
  } catch {
    return NextResponse.json({ error: "Failed to load owners" }, { status: 500 });
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

  const parsed = createOwnerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid owner data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const owner = await prisma.owner.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        billingNotes: data.billingNotes,
      },
    });
    return NextResponse.json({ owner }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create owner" }, { status: 400 });
  }
}
