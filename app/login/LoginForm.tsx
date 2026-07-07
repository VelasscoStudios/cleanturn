"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

type Tab = "admin" | "cleaner";

const GENERIC_ERROR = "Invalid credentials";

export function LoginForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchTab(next: Tab) {
    setTab(next);
    setError(null);
  }

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ ok: true; role: "admin" }>(
        "/api/auth/admin/login",
        { method: "POST", body: { email, password } }
      );
      router.push(res.role === "admin" ? "/admin" : "/my");
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCleanerSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ ok: true; role: "cleaner" }>(
        "/api/auth/cleaner/login",
        { method: "POST", body: { phone, pin } }
      );
      router.push(res.role === "cleaner" ? "/my" : "/admin");
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white border p-5" style={{ borderColor: "var(--line)" }}>
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className={tab === "admin" ? "active" : ""}
          onClick={() => switchTab("admin")}
        >
          👔 Admin
        </button>
        <button
          type="button"
          className={tab === "cleaner" ? "active" : ""}
          onClick={() => switchTab("cleaner")}
        >
          🧹 Cleaner
        </button>
      </div>

      {error && (
        <div className="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      {tab === "admin" ? (
        <form onSubmit={handleAdminSubmit}>
          <div className="fgroup">
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="fgroup">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="add-btn"
            style={{ width: "100%", padding: "12px", fontSize: 15 }}
            disabled={submitting}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCleanerSubmit}>
          <div className="fgroup">
            <label htmlFor="cleaner-phone">Phone</label>
            <input
              id="cleaner-phone"
              type="tel"
              autoComplete="username"
              placeholder="+15550101"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div className="fgroup">
            <label htmlFor="cleaner-pin">PIN</label>
            <input
              id="cleaner-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="6-digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="action-btn arrive"
            style={{ marginTop: 4 }}
            disabled={submitting}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}

      {process.env.NODE_ENV !== "production" && (
        <div className="ical-box" style={{ marginTop: 18, marginBottom: 0 }}>
          <b>Localhost demo credentials</b>
          <br />
          Admin: admin@cleanturn.local / cleanturn-demo
          <br />
          Cleaner: +15550101 / 111111
        </div>
      )}
    </div>
  );
}
