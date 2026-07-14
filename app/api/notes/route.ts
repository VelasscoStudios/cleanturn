import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi, assertFetchHeader } from "@/lib/auth";
import { createNoteSchema } from "@/lib/validation";

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

export async function GET() {
  const session = await requireAdminApi();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const notes = await prisma.note.findMany({
      include: noteInclude,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ notes });
  } catch {
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
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

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note data" }, { status: 400 });
  }
  const data = parsed.data;

  try {
    if (data.cleanerId) {
      const cleaner = await prisma.cleaner.findUnique({
        where: { id: data.cleanerId },
        select: { id: true },
      });
      if (!cleaner) {
        return NextResponse.json({ error: "Cleaner not found" }, { status: 400 });
      }
    }
    if (data.jobId) {
      const job = await prisma.job.findUnique({
        where: { id: data.jobId },
        select: { id: true },
      });
      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 400 });
      }
    }

    const note = await prisma.note.create({
      data: {
        body: data.body,
        date: data.date ?? null,
        cleanerId: data.cleanerId ?? null,
        jobId: data.jobId ?? null,
        authorId: session.id,
      },
      include: noteInclude,
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
