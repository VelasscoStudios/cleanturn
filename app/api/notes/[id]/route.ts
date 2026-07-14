import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { updateNoteSchema } from "@/lib/validation";

const noteInclude = {
  cleaner: { select: { id: true, name: true } },
  job: {
    select: {
      id: true,
      date: true,
      property: { select: { id: true, nickname: true } },
    },
  },
} as const;

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

  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Setting one link clears the other unless explicitly kept null. This is
    // computed against the MERGED result (existing note + patch) so a patch
    // that only touches cleanerId still correctly drops a pre-existing jobId.
    let cleanerId = existing.cleanerId;
    let jobId = existing.jobId;
    if (data.cleanerId !== undefined) {
      cleanerId = data.cleanerId;
      if (data.cleanerId) jobId = null;
    }
    if (data.jobId !== undefined) {
      jobId = data.jobId;
      if (data.jobId) cleanerId = null;
    }
    if (cleanerId && jobId) {
      return NextResponse.json(
        { error: "A note can link to a cleaner or a job, not both" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = { cleanerId, jobId };
    if (data.body !== undefined) updateData.body = data.body;
    if (data.date !== undefined) updateData.date = data.date;

    const note = await prisma.note.update({
      where: { id },
      data: updateData,
      include: noteInclude,
    });

    return NextResponse.json({ note });
  } catch (e: unknown) {
    const message =
      typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2003"
        ? "Referenced cleaner or job does not exist"
        : "Failed to update note";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

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

  try {
    const existing = await prisma.note.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    await prisma.note.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
