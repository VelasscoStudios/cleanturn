import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PropertiesClient from "./PropertiesClient";

export type PropertyRow = {
  id: string;
  nickname: string;
  address: string;
  ownerId: string;
  ownerName: string;
  cleanCostCents: number;
  arriveTime: string;
  outByTime: string;
  accessCode: string;
  icalUrl: string;
  directions: string;
  notes: string;
  active: boolean;
  syncStatus: string;
  syncError: string | null;
  lastSyncAt: string | null; // ISO string, formatted client-side
};

export type OwnerOption = { id: string; name: string };

export default async function PropertiesPage() {
  await requireRolePage("admin");

  const [properties, owners] = await Promise.all([
    prisma.property.findMany({
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.owner.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows: PropertyRow[] = properties.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    address: p.address,
    ownerId: p.ownerId,
    ownerName: p.owner.name,
    cleanCostCents: p.cleanCostCents,
    arriveTime: p.arriveTime,
    outByTime: p.outByTime,
    accessCode: p.accessCode,
    icalUrl: p.icalUrl,
    directions: p.directions,
    notes: p.notes,
    active: p.active,
    syncStatus: p.syncStatus,
    syncError: p.syncError,
    lastSyncAt: p.lastSyncAt ? p.lastSyncAt.toISOString() : null,
  }));

  const ownerOptions: OwnerOption[] = owners;

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Properties</h1>
      <PropertiesClient properties={rows} owners={ownerOptions} />
    </div>
  );
}
