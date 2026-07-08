import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { createAdminUserSchema } from "@/lib/validation";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admins = await prisma.adminUser.findMany({
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ admins });
  } catch {
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
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

  const parsed = createAdminUserSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid user data" },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.adminUser.create({
      data: { email, passwordHash },
      select: { id: true, email: true, createdAt: true },
    });
    // The plaintext password is never stored or logged; the caller already
    // has it (they chose it) so it is not echoed back either.
    return NextResponse.json({ admin }, { status: 201 });
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
        ? "A user with this email already exists"
        : "Failed to create user";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
