import { redirect } from "next/navigation";
import { requireRolePage } from "@/lib/auth";
import { prisma } from "@/lib/db";
import LogoutButton from "../_components/LogoutButton";

export default async function AccountPage() {
  const session = await requireRolePage("admin");

  const admin = await prisma.adminUser.findUnique({
    where: { id: session.id },
    select: { email: true, createdAt: true },
  });
  if (!admin) {
    redirect("/login");
  }

  return (
    <div className="admin">
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Account</h1>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "16px 18px",
          maxWidth: 420,
        }}
      >
        <div style={{ fontSize: 13, color: "var(--muted)" }}>Signed in as</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
          {admin.email}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          Admin since{" "}
          {admin.createdAt.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>
        <div style={{ marginTop: 16 }}>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
