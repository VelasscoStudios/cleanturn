import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { checkRateLimit, recordAttempt, clearAttempts, rateLimitKey } from "@/lib/ratelimit";

const bodySchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const GENERIC_ERROR = "Invalid credentials";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const ip = clientIp(req);
  const key = rateLimitKey(ip, email);

  if (!checkRateLimit(key)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 429 });
  }

  try {
    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin) {
      recordAttempt(key);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      recordAttempt(key);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    clearAttempts(key);
    await createSession({ role: "admin", id: admin.id });
    return NextResponse.json({ ok: true, role: "admin" });
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
