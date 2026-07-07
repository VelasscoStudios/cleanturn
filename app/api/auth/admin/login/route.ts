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
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(200),
});

const GENERIC_ERROR = "Invalid credentials";

// Precomputed bcrypt hash of a random string. Compared against when the
// account does not exist so a login attempt takes the same time whether or
// not the email is registered — removes the user-enumeration timing channel.
const DUMMY_HASH = "$2a$12$IjCLd2Y23crcX1e/kRcVUOpqTqVMYhVfVTiSXd6jCdhqW3sloa3W6";

function clientIp(req: Request): string {
  // NOTE: x-forwarded-for is client-controllable when the app is reached
  // directly, so it is used ONLY for the per-IP throttle. The account-level
  // cap (identifierKey) below does not depend on it and is what actually
  // bounds brute force.
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

  const { email, password } = parsed.data;
  const ip = clientIp(req);
  const ipKey = rateLimitKey(ip, email);
  const idKey = identifierKey(email);

  if (!checkRateLimit(ipKey) || !checkRateLimit(idKey)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 429 });
  }

  try {
    const admin = await prisma.adminUser.findUnique({ where: { email } });
    // Always run a bcrypt comparison (against a dummy hash when the account is
    // absent) so the response time does not reveal whether the email exists.
    const match = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);

    if (!admin || !match) {
      recordAttempt(ipKey);
      recordAttempt(idKey);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    clearAttempts(ipKey);
    clearAttempts(idKey);
    await createSession({ role: "admin", id: admin.id });
    return NextResponse.json({ ok: true, role: "admin" });
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
