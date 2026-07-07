"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import type { CleanerRow } from "./page";

type FormState = {
  name: string;
  phone: string;
  email: string;
};

const emptyForm: FormState = { name: "", phone: "", email: "" };

type CleanerApiResult = { cleaner: CleanerRow; pin?: string };

export default function CleanersClient({ cleaners }: { cleaners: CleanerRow[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActive, setEditingActive] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedPin, setRevealedPin] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState(false);

  function openAdd() {
    setEditingId(null);
    setEditingActive(true);
    setForm(emptyForm);
    setError(null);
    setRevealedPin(null);
    setModalOpen(true);
  }

  function openEdit(c: CleanerRow) {
    setEditingId(c.id);
    setEditingActive(c.active);
    setForm({ name: c.name, phone: c.phone, email: c.email ?? "" });
    setError(null);
    setRevealedPin(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setError(null);
    setRevealedPin(null);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!form.phone.trim()) {
      setError("Phone is required");
      return;
    }

    const body = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
    };

    setSaving(true);
    try {
      if (editingId) {
        const result = await apiFetch<CleanerApiResult>(`/api/cleaners/${editingId}`, {
          method: "PATCH",
          body,
        });
        if (result.pin) setRevealedPin(result.pin);
      } else {
        const result = await apiFetch<CleanerApiResult>("/api/cleaners", {
          method: "POST",
          body,
        });
        setEditingId(result.cleaner.id);
        setEditingActive(result.cleaner.active);
        if (result.pin) setRevealedPin(result.pin);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save cleaner");
    } finally {
      setSaving(false);
    }
  }

  async function resetPin() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<CleanerApiResult>(`/api/cleaners/${editingId}`, {
        method: "PATCH",
        body: { resetPin: true },
      });
      if (result.pin) setRevealedPin(result.pin);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset PIN");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active: boolean) {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/cleaners/${editingId}`, { method: "PATCH", body: { active } });
      setEditingActive(active);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update cleaner");
    } finally {
      setSaving(false);
    }
  }

  async function copyPin() {
    if (!revealedPin) return;
    try {
      await navigator.clipboard.writeText(revealedPin);
      setCopyHint(true);
      setTimeout(() => setCopyHint(false), 2000);
    } catch {
      // Clipboard API unavailable — ignore, PIN is still shown on screen.
    }
  }

  return (
    <>
      <button className="add-btn" onClick={openAdd}>
        + Add cleaner
      </button>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Login</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {cleaners.map((c) => (
            <tr key={c.id} className="clickable" title="Click to edit" onClick={() => openEdit(c)}>
              <td>
                <b>{c.name}</b>
              </td>
              <td>{c.phone}</td>
              <td>Phone + PIN</td>
              <td>
                {c.active ? (
                  <span className="ok">Active</span>
                ) : (
                  <span className="err">Inactive</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted-note">Cleaners log in with phone + PIN. They only ever see their own jobs.</p>

      <div
        className={`modal-overlay${modalOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="modal">
          <h3>{editingId ? `Edit ${form.name || "cleaner"}` : "Add cleaner"}</h3>
          <p className="sub">Cleaners log in with phone + a 6-digit PIN — no email needed.</p>

          <div className="fgroup">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Maria"
            />
          </div>
          <div className="frow">
            <div className="fgroup">
              <label>Phone (used to log in)</label>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+15550101"
              />
            </div>
            <div className="fgroup">
              <label>Email (optional)</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="maria@mail.com"
              />
            </div>
          </div>

          {revealedPin && (
            <div className="ical-box" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span>
                <b>PIN (shown once):</b>{" "}
                <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.1em" }}>
                  {revealedPin}
                </span>
                <br />
                Share this with the cleaner now — it will not be shown again.
              </span>
              <button
                className="mark-one"
                style={{ whiteSpace: "nowrap" }}
                onClick={copyPin}
                type="button"
              >
                {copyHint ? "Copied!" : "Copy"}
              </button>
            </div>
          )}

          {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}

          <div className="modal-actions">
            {editingId && (
              <button className="cancel" onClick={resetPin} disabled={saving} style={{ marginRight: "auto" }}>
                Reset PIN
              </button>
            )}
            {editingId && editingActive && (
              <button
                className="cancel"
                style={{ color: "var(--red)", borderColor: "var(--red)" }}
                onClick={() => setActive(false)}
                disabled={saving}
              >
                Deactivate
              </button>
            )}
            {editingId && !editingActive && (
              <button
                className="cancel"
                style={{ color: "var(--green)", borderColor: "var(--green)" }}
                onClick={() => setActive(true)}
                disabled={saving}
              >
                Reactivate
              </button>
            )}
            <button className="cancel" onClick={closeModal} disabled={saving}>
              Close
            </button>
            <button className="save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save cleaner"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
