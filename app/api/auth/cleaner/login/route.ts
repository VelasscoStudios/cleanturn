import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, assertFetchHeader } from "@/lib/auth";
import {
  checkRateLimit,
  recordAttempt,
  clearAttempts,
  rateLimitKey,
  identifierKey,
} from "@/lib/ratelimit";

const bodySchema = z.object({
  phone: z.string().min(1).max(40),
  pin: z.string().min(1).max(64),
});

const GENERIC_ERROR = "Invalid credentials";

// See admin login: a real bcrypt hash of a random string, compared against
// when the phone is unknown/inactive so timing is constant either way.
const DUMMY_HASH = "$2a$12$IjCLd2Y23crcX1e/kRcVUOpqTqVMYhVfVTiSXd6jCdhqW3sloa3W6";

function clientIp(req: Request): string {
  // x-forwarded-for is client-controllable; used only for the per-IP throttle.
  // The identifier-only cap below is what bounds PIN brute force.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

export async function POST(req: Request) {
  if (!assertFetchHeader(req)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 403 });
  }

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
  const ipKey = rateLimitKey(ip, phone);
  const idKey = identifierKey(phone);

  try {
    if (!(await checkRateLimit(ipKey)) || !(await checkRateLimit(idKey))) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 429 });
    }

    const cleaner = await prisma.cleaner.findUnique({ where: { phone } });
    // Always run bcrypt (dummy hash when absent/inactive) for constant timing.
    const usable = cleaner && cleaner.active ? cleaner : null;
    const match = await bcrypt.compare(pin, usable?.pinHash ?? DUMMY_HASH);

    if (!usable || !match) {
      await recordAttempt(ipKey);
      await recordAttempt(idKey);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    await clearAttempts(ipKey);
    await clearAttempts(idKey);
    await createSession({ role: "cleaner", id: usable.id });
    return NextResponse.json({ ok: true, role: "cleaner" });
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
