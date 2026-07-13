import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import UsersClient from "./UsersClient";

export type AdminUserRow = {
  id: string;
  email: string;
  createdAt: string; // ISO string — serialized for the client component
};

export default async function UsersPage() {
  const session = await requireRolePage("admin");

  const admins = await prisma.adminUser.findMany({
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Users</h1>
      <UsersClient
        admins={admins.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
        selfId={session.id}
      />
    </div>
  );
}
