import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession, type SessionOptions } from "iron-session";

export const SESSION_COOKIE = "cleanturn_session";

export type SessionData = { role: "admin" | "cleaner"; id: string };

const sessionSecret =
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("SESSION_SECRET must be set to a 32+ char secret");
      })()
    : "dev-only-insecure-secret-please-set-env-1234567890");

function sessionOptions(maxAgeSeconds: number): SessionOptions {
  return {
    password: sessionSecret,
    cookieName: SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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
  return session;
}

export async function requireCleanerApi(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session || session.role !== "cleaner") return null;
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
