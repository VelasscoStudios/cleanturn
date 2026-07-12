import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCleanerApi, assertFetchHeader } from "@/lib/auth";
import { updateMyLanguageSchema } from "@/lib/validation";

export async function PATCH(req: Request) {
  const session = await requireCleanerApi();
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

  const parsed = updateMyLanguageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }

  try {
    const cleaner = await prisma.cleaner.update({
      where: { id: session.id },
      data: { language: parsed.data.language },
      select: { language: true },
    });
    return NextResponse.json({ language: cleaner.language });
  } catch {
    return NextResponse.json({ error: "Failed to update language" }, { status: 500 });
  }
}
