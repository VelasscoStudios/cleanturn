import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// Coarse guard only: presence of the session cookie is enough to pass
// through here. Authoritative role checks happen in the handlers/pages
// themselves (requireRolePage / requireAdminApi / requireCleanerApi).
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/my/:path*"],
};
