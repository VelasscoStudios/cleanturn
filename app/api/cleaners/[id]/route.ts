import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { updateCleanerSchema } from "@/lib/validation";

function generatePin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

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
    const cleaner = await prisma.cleaner.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        language: true,
        active: true,
        createdAt: true,
      },
    });
    if (!cleaner) {
      return NextResponse.json({ error: "Cleaner not found" }, { status: 404 });
    }
    return NextResponse.json({ cleaner });
  } catch {
    return NextResponse.json({ error: "Failed to load cleaner" }, { status: 500 });
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

  const parsed = updateCleanerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cleaner data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const existing = await prisma.cleaner.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Cleaner not found" }, { status: 404 });
    }

    let newPin: string | null = null;
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.language !== undefined) updateData.language = data.language;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.resetPin) {
      newPin = generatePin();
      updateData.pinHash = await bcrypt.hash(newPin, 12);
    }

    const cleaner = await prisma.cleaner.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        language: true,
        active: true,
      },
    });

    // Deactivating a cleaner must release their open jobs so the schedule
    // doesn't hold work against someone who can no longer log in. Terminal
    // jobs (completed/cancelled) keep their history.
    if (data.active === false) {
      await prisma.job.updateMany({
        where: {
          cleanerId: id,
          status: { in: ["assigned", "in_progress"] },
        },
        data: { cleanerId: null, status: "assigned", arrivedAt: null, leftAt: null },
      });
    }

    // Plaintext PIN returned ONCE on reset, never stored or logged.
    return NextResponse.json(newPin ? { cleaner, pin: newPin } : { cleaner });
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
        ? "A cleaner with this phone number already exists"
        : "Failed to update cleaner";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
