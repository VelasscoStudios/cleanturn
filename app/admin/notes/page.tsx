import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import NotesClient from "./NotesClient";

export type NoteRow = {
  id: string;
  body: string;
  date: string | null;
  cleanerId: string | null;
  cleanerName: string | null;
  jobId: string | null;
  jobLabel: string | null; // "nickname - date"
};

export type CleanerOption = { id: string; name: string };
export type JobOption = { id: string; label: string }; // "nickname - date"

export default async function NotesPage() {
  await requireRolePage("admin");

  const [notes, cleaners, jobs] = await Promise.all([
    prisma.note.findMany({
      include: {
        cleaner: { select: { id: true, name: true } },
        job: {
          select: { id: true, date: true, property: { select: { nickname: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cleaner.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.job.findMany({
      select: { id: true, date: true, property: { select: { nickname: true } } },
      orderBy: { date: "desc" },
      take: 60,
    }),
  ]);

  const rows: NoteRow[] = notes.map((n) => ({
    id: n.id,
    body: n.body,
    date: n.date,
    cleanerId: n.cleanerId,
    cleanerName: n.cleaner?.name ?? null,
    jobId: n.jobId,
    jobLabel: n.job ? `${n.job.property.nickname} - ${n.job.date}` : null,
  }));

  const cleanerOptions: CleanerOption[] = cleaners;
  const jobOptions: JobOption[] = jobs.map((j) => ({
    id: j.id,
    label: `${j.property.nickname} - ${j.date}`,
  }));

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Notes</h1>
      <NotesClient notes={rows} cleaners={cleanerOptions} jobs={jobOptions} />
    </div>
  );
}
