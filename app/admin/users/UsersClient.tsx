"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import type { AdminUserRow } from "./page";

const MIN_PASSWORD_LENGTH = 12;

function generatePassword(): string {
  // 20 chars from an unambiguous alphanumeric set, via CSPRNG.
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(20));
  return Array.from(bytes, (b) => charset[b % charset.length]).join("");
}

type AdminApiResult = { admin: AdminUserRow };

export default function UsersClient({
  admins,
  selfId,
}: {
  admins: AdminUserRow[];
  selfId: string;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function openAdd() {
    setEditingId(null);
    setEmail("");
    setPassword("");
    setError(null);
    setRevealedPassword(null);
    setConfirmRemove(false);
    setModalOpen(true);
  }

  function openEdit(a: AdminUserRow) {
    setEditingId(a.id);
    setEmail(a.email);
    setPassword("");
    setError(null);
    setRevealedPassword(null);
    setConfirmRemove(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setError(null);
    setRevealedPassword(null);
    setConfirmRemove(false);
  }

  async function save() {
    setError(null);
    const trimmedEmail = email.trim();
    if (!editingId && !trimmedEmail) {
      setError("Email is required");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await apiFetch<AdminApiResult>(`/api/admins/${editingId}`, {
          method: "PATCH",
          body: { password },
        });
      } else {
        const result = await apiFetch<AdminApiResult>("/api/admins", {
          method: "POST",
          body: { email: trimmedEmail, password },
        });
        setEditingId(result.admin.id);
        setEmail(result.admin.email);
      }
      // Reveal once so a generated password can still be copied; never stored.
      setRevealedPassword(password);
      setPassword("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save user");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editingId) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/admins/${editingId}`, { method: "DELETE" });
      closeModal();
      router.refresh();
    } catch (e) {
      setConfirmRemove(false);
      setError(e instanceof Error ? e.message : "Failed to remove user");
    } finally {
      setSaving(false);
    }
  }

  async function copyPassword() {
    if (!revealedPassword) return;
    try {
      await navigator.clipboard.writeText(revealedPassword);
      setCopyHint(true);
      setTimeout(() => setCopyHint(false), 2000);
    } catch {
      // Clipboard API unavailable — ignore, password is still shown on screen.
    }
  }

  const isSelf = editingId === selfId;

  return (
    <>
      <button className="add-btn" onClick={openAdd}>
        + Add user
      </button>
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Login</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.id} className="clickable" title="Click to edit" onClick={() => openEdit(a)}>
              <td>
                <b>{a.email}</b>
                {a.id === selfId && <span className="ok"> (you)</span>}
              </td>
              <td>Email + password</td>
              <td>{a.createdAt.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted-note">
        Users have full admin access. Removing a user locks them out immediately; changing a
        password doesn&apos;t end sessions that are already signed in.
      </p>

      <div
        className={`modal-overlay${modalOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="modal">
          <h3>{editingId ? `Edit ${email || "user"}` : "Add user"}</h3>
          <p className="sub">
            {editingId
              ? "Set a new password for this user."
              : "Staff log in with email + password and get full admin access."}
          </p>

          {!editingId && (
            <div className="fgroup">
              <label>Email (used to log in)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </div>
          )}

          <div className="fgroup">
            <label>{editingId ? "New password" : "Password"} (min {MIN_PASSWORD_LENGTH} characters)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ flex: 1, fontFamily: "monospace" }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Type or generate a password"
                autoComplete="off"
              />
              <button
                className="cancel"
                type="button"
                onClick={() => setPassword(generatePassword())}
                disabled={saving}
                style={{ whiteSpace: "nowrap" }}
              >
                Generate
              </button>
            </div>
          </div>

          {revealedPassword && (
            <div className="ical-box" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>
                <b>Password set:</b>{" "}
                <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{revealedPassword}</span>
                <br />
                Share it now — it won&apos;t be shown again after you close this.
              </span>
              <button
                className="mark-one"
                style={{ whiteSpace: "nowrap" }}
                onClick={copyPassword}
                type="button"
              >
                {copyHint ? "Copied!" : "Copy"}
              </button>
            </div>
          )}

          {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}

          <div className="modal-actions">
            {editingId && !isSelf && (
              <button
                className="cancel"
                style={{ color: "var(--red)", borderColor: "var(--red)", marginRight: "auto" }}
                onClick={remove}
                disabled={saving}
              >
                {confirmRemove ? "Confirm remove" : "Remove user"}
              </button>
            )}
            <button className="cancel" onClick={closeModal} disabled={saving}>
              Close
            </button>
            <button className="save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save password" : "Save user"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
