import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sessionUserExists } from "@/lib/session-user";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const session = await getSession();
  // A stale cookie (user deleted/deactivated) must land on the form,
  // not bounce back to a broken page; logging in overwrites the cookie.
  if (session && (await sessionUserExists(session))) {
    redirect(session.role === "admin" ? "/admin" : "/my");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold">
            Clean<span style={{ color: "var(--brand)" }}>Turn</span>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Sign in to continue
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
