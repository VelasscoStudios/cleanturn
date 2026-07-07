import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { updateOwnerSchema } from "@/lib/validation";

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
    const owner = await prisma.owner.findUnique({
      where: { id },
      include: { properties: true },
    });
    if (!owner) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }
    return NextResponse.json({ owner });
  } catch {
    return NextResponse.json({ error: "Failed to load owner" }, { status: 500 });
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

  const parsed = updateOwnerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid owner data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const existing = await prisma.owner.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const owner = await prisma.owner.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.billingNotes !== undefined ? { billingNotes: data.billingNotes } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });

    return NextResponse.json({ owner });
  } catch {
    return NextResponse.json({ error: "Failed to update owner" }, { status: 400 });
  }
}
