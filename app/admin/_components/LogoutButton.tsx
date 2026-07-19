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
        background: "var(--red-bg)",
        color: "var(--red)",
        border: "1px solid transparent",
        padding: "8px 18px",
        borderRadius: "10px",
        cursor: loading ? "default" : "pointer",
        fontSize: "14px",
        fontWeight: 600,
      }}
    >
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}
