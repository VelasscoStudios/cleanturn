import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import CleanersClient from "./CleanersClient";

export type CleanerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
};

export default async function CleanersPage() {
  await requireRolePage("admin");

  const cleaners = await prisma.cleaner.findMany({
    select: { id: true, name: true, phone: true, email: true, active: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Cleaners</h1>
      <CleanersClient cleaners={cleaners} />
    </div>
  );
}
