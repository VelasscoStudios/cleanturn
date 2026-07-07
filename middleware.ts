import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

const PROTECTED_PREFIXES = ["/admin", "/my"];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  // Scripts are allowed only via the per-request nonce (plus 'strict-dynamic',
  // so a nonced script may load its own chunks). No 'unsafe-inline' for
  // scripts — an injected inline <script> without the nonce will not execute.
  // Dev needs 'unsafe-eval' for React Fast Refresh; production does not.
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind/Next inject inline <style>; style injection is far lower risk
    // than script injection, so 'unsafe-inline' is retained only for styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  // Auth gate (coarse): protected pages require the session cookie's presence;
  // authoritative role checks happen in the handlers/pages themselves.
  const pathname = req.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected && !req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Per-request CSP nonce. Set it on the request headers so Next.js applies it
  // to its own scripts, and on the response so the browser enforces it.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Run on all routes except API and static assets (which don't need a nonce).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
