import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRolePage } from "@/lib/auth";
import { MyJobsView } from "./MyJobsView";

export default async function MyJobsPage() {
  const session = await requireRolePage("cleaner");

  const cleaner = await prisma.cleaner.findUnique({
    where: { id: session.id },
    select: { name: true, active: true },
  });
  if (!cleaner || !cleaner.active) {
    redirect("/login");
  }

  return <MyJobsView cleanerName={cleaner.name} />;
}
