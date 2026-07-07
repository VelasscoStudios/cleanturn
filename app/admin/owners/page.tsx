import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import OwnersClient from "./OwnersClient";

export type OwnerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  billingNotes: string;
  active: boolean;
  propertyNicknames: string[];
  outstandingCents: number;
};

export default async function OwnersPage() {
  await requireRolePage("admin");

  const owners = await prisma.owner.findMany({
    include: {
      properties: {
        select: {
          id: true,
          nickname: true,
          jobs: {
            where: { status: "done", paid: false },
            select: { costCents: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: OwnerRow[] = owners.map((o) => {
    const outstandingCents = o.properties.reduce(
      (sum, p) => sum + p.jobs.reduce((s, j) => s + j.costCents, 0),
      0
    );
    return {
      id: o.id,
      name: o.name,
      email: o.email,
      phone: o.phone,
      billingNotes: o.billingNotes,
      active: o.active,
      propertyNicknames: o.properties.map((p) => p.nickname),
      outstandingCents,
    };
  });

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Owners</h1>
      <OwnersClient owners={rows} />
    </div>
  );
}
