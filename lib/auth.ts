import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession, type SessionOptions } from "iron-session";
import { prisma } from "./db";

export const SESSION_COOKIE = "cleanturn_session";

export type SessionData = { role: "admin" | "cleaner"; id: string };

// Only these environments may fall back to the insecure dev secret / non-Secure
// cookie. Anything else — including an UNSET NODE_ENV, the dangerous case on a
// misconfigured production host — fails closed rather than sealing sessions
// with a secret that is public in this repo.
const isLocalDev =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-please-set-env-1234567890";

const sessionSecret = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters");
    }
    return fromEnv;
  }
  if (isLocalDev) return DEV_FALLBACK_SECRET;
  throw new Error(
    "SESSION_SECRET must be set (NODE_ENV is not development/test — refusing the insecure fallback)",
  );
})();

function sessionOptions(maxAgeSeconds: number): SessionOptions {
  return {
    password: sessionSecret,
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      // Secure everywhere except explicit local dev/test (localhost is http).
      // Decoupled from a production-only check so a host that forgot to set
      // NODE_ENV=production still ships a Secure cookie.
      secure: !isLocalDev,
      sameSite: "lax",
      maxAge: maxAgeSeconds,
      path: "/",
    },
  };
}

// Default TTL used just for reading; actual TTL is set at creation time via
// cookieOptions.maxAge, which iron-session bakes into the cookie itself.
const DEFAULT_OPTIONS = sessionOptions(60 * 60 * 24 * 7);

type SessionRecord = Partial<SessionData>;

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionRecord>(cookieStore, DEFAULT_OPTIONS);
  if (!session.role || !session.id) return null;
  return { role: session.role, id: session.id };
}

export async function createSession(data: SessionData): Promise<void> {
  const maxAge = data.role === "admin" ? 60 * 60 * 24 * 7 : 60 * 60 * 24 * 30;
  const cookieStore = await cookies();
  const session = await getIronSession<SessionRecord>(cookieStore, sessionOptions(maxAge));
  session.role = data.role;
  session.id = data.id;
  await session.save();
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionRecord>(cookieStore, DEFAULT_OPTIONS);
  session.destroy();
}

export async function requireAdminApi(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  // Re-validate on every request: a sealed cookie can outlive its user. A
  // deleted admin's 7-day cookie must not keep working. Fail CLOSED on a DB
  // error (return null / deny) rather than throwing — an unhandled throw here
  // would turn every guarded route into a 500 during a DB blip.
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: session.id },
      select: { id: true },
    });
    if (!admin) return null;
  } catch {
    return null;
  }
  return session;
}

export async function requireCleanerApi(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session || session.role !== "cleaner") return null;
  // Re-validate existence AND active status: deactivating a cleaner must
  // immediately revoke their API access (incl. door/access codes), not wait
  // for the 30-day cookie to expire. Fail closed on a DB error.
  try {
    const cleaner = await prisma.cleaner.findUnique({
      where: { id: session.id },
      select: { active: true },
    });
    if (!cleaner || !cleaner.active) return null;
  } catch {
    return null;
  }
  return session;
}

export async function requireRolePage(role: "admin" | "cleaner"): Promise<SessionData> {
  const session = await getSession();
  if (!session || session.role !== role) {
    redirect("/login");
  }
  return session;
}

export function assertFetchHeader(req: Request): boolean {
  return req.headers.get("X-Requested-With") === "fetch";
}
