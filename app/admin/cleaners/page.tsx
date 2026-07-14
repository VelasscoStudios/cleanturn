import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import CleanersClient from "./CleanersClient";

export type NoteRow = {
  id: string;
  body: string;
  date: string | null;
  createdAt: string; // ISO string — serialized for the client component
};

export type CleanerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  language: string;
  active: boolean;
  notes: NoteRow[];
};

export default async function CleanersPage() {
  await requireRolePage("admin");

  const cleaners = await prisma.cleaner.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      language: true,
      active: true,
      notes: {
        select: { id: true, body: true, date: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: CleanerRow[] = cleaners.map((c) => ({
    ...c,
    notes: c.notes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
  }));

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Cleaners</h1>
      <CleanersClient cleaners={rows} />
    </div>
  );
}
