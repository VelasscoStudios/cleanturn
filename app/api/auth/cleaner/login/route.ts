import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { checkRateLimit, recordAttempt, clearAttempts, rateLimitKey } from "@/lib/ratelimit";

const bodySchema = z.object({
  phone: z.string().min(1),
  pin: z.string().min(1),
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

  const { phone, pin } = parsed.data;
  const ip = clientIp(req);
  const key = rateLimitKey(ip, phone);

  if (!checkRateLimit(key)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 429 });
  }

  try {
    const cleaner = await prisma.cleaner.findUnique({ where: { phone } });
    if (!cleaner || !cleaner.active) {
      recordAttempt(key);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    const match = await bcrypt.compare(pin, cleaner.pinHash);
    if (!match) {
      recordAttempt(key);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    clearAttempts(key);
    await createSession({ role: "cleaner", id: cleaner.id });
    return NextResponse.json({ ok: true, role: "cleaner" });
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
