import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { changeAdminPasswordSchema } from "@/lib/validation";

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

  const parsed = changeAdminPasswordSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid password" },
      { status: 400 }
    );
  }

  try {
    const existing = await prisma.adminUser.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const admin = await prisma.adminUser.update({
      where: { id },
      data: { passwordHash },
      select: { id: true, email: true, createdAt: true },
    });
    return NextResponse.json({ admin });
  } catch {
    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }
}

// Sentinels so the transaction below can signal a specific HTTP outcome
// without matching on error-message strings.
const NOT_FOUND = Symbol("not-found");
const LAST_ADMIN = Symbol("last-admin");

export async function DELETE(
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

  // Removing your own account would kill the session mid-flight and, worse,
  // is the only way concurrent deletes could race the admin count to zero.
  if (id === session.id) {
    return NextResponse.json(
      { error: "You can't remove your own account" },
      { status: 400 }
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const target = await tx.adminUser.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!target) throw NOT_FOUND;
      // Belt-and-braces with the self-delete guard: never let the table
      // reach zero admins, even under concurrent deletes.
      const count = await tx.adminUser.count();
      if (count <= 1) throw LAST_ADMIN;
      await tx.adminUser.delete({ where: { id } });
    });
    // requireAdminApi re-validates against the DB on every request, so the
    // removed user's cookie stops working immediately.
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (e === NOT_FOUND) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (e === LAST_ADMIN) {
      return NextResponse.json(
        { error: "Can't remove the last admin user" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to remove user" }, { status: 500 });
  }
}
