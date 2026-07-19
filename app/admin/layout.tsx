import { redirect } from "next/navigation";
import { requireRolePage } from "@/lib/auth";
import { sessionUserExists } from "@/lib/session-user";
import AdminNav from "./_components/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRolePage("admin");
  if (!(await sessionUserExists(session))) {
    redirect("/login");
  }

  return (
    <div>
      <div className="topbar">
        <div className="logo">
          Clean<span>Turn</span>
        </div>
        <AdminNav />
      </div>
      {children}
    </div>
  );
}
