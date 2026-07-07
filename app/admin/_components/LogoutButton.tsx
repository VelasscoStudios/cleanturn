"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if logout fails server-side, still send the user to /login.
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      style={{
        background: "#1e293b",
        color: "#cbd5e1",
        border: "1px solid #334155",
        padding: "6px 14px",
        borderRadius: "20px",
        cursor: loading ? "default" : "pointer",
        fontSize: "13px",
      }}
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
