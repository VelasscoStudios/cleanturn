import { prisma } from "@/lib/db";
import type { SessionData } from "@/lib/auth";

/**
 * A sealed cookie can outlive its user (deleted or deactivated).
 * Pages must not trust session.id blindly — verify it still resolves.
 */
export async function sessionUserExists(session: SessionData): Promise<boolean> {
  // Fail closed on any DB error: treat as "does not exist" (deny) rather than
  // letting the exception propagate into a 500.
  try {
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
  } catch {
    return false;
  }
}
