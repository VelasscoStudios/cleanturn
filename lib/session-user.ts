import { prisma } from "@/lib/db";
import type { SessionData } from "@/lib/auth";

/**
 * A sealed cookie can outlive its user (deleted or deactivated).
 * Pages must not trust session.id blindly — verify it still resolves.
 */
export async function sessionUserExists(session: SessionData): Promise<boolean> {
  if (session.role === "admin") {
    const admin = await prisma.adminUser.findUnique({
      where: { id: session.id },
      select: { id: true },
    });
    return admin !== null;
  }
  const cleaner = await prisma.cleaner.findUnique({
    where: { id: session.id },
    select: { active: true },
  });
  return cleaner !== null && cleaner.active;
}
