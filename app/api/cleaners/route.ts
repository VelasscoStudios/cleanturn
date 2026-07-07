import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { createCleanerSchema } from "@/lib/validation";

function generatePin(): string {
  // Random 6-digit PIN, zero-padded, using a CSPRNG.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function GET() {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cleaners = await prisma.cleaner.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ cleaners });
  } catch {
    return NextResponse.json({ error: "Failed to load cleaners" }, { status: 500 });
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

  const parsed = createCleanerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cleaner data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, 12);

    const cleaner = await prisma.cleaner.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email ?? null,
        pinHash,
      },
    });

    // Plaintext PIN returned ONCE, never stored or logged.
    return NextResponse.json(
      {
        cleaner: {
          id: cleaner.id,
          name: cleaner.name,
          phone: cleaner.phone,
          email: cleaner.email,
          active: cleaner.active,
        },
        pin,
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
        ? "A cleaner with this phone number already exists"
        : "Failed to create cleaner";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
