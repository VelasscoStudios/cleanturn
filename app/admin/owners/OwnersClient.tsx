"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import type { OwnerRow } from "./page";

function formatCad(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

type FormState = {
  name: string;
  email: string;
  phone: string;
  billingNotes: string;
};

const emptyForm: FormState = { name: "", email: "", phone: "", billingNotes: "" };

export default function OwnersClient({ owners }: { owners: OwnerRow[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActive, setEditingActive] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setEditingId(null);
    setEditingActive(true);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(o: OwnerRow) {
    setEditingId(o.id);
    setEditingActive(o.active);
    setForm({
      name: o.name,
      email: o.email,
      phone: o.phone ?? "",
      billingNotes: o.billingNotes,
    });
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setError(null);
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
    if (!form.email.trim()) {
      setError("Email is required");
      return;
    }

    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      billingNotes: form.billingNotes,
    };

    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/api/owners/${editingId}`, { method: "PATCH", body });
      } else {
        await apiFetch("/api/owners", { method: "POST", body });
      }
      setModalOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save owner");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(active: boolean) {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/owners/${editingId}`, { method: "PATCH", body: { active } });
      setModalOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update owner");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="add-btn" onClick={openAdd}>
        + Add owner
      </button>
      <table>
        <thead>
          <tr>
            <th>Owner</th>
            <th>Contact</th>
            <th>Properties</th>
            <th>Billing notes</th>
            <th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((o) => (
            <tr key={o.id} className="clickable" title="Click to edit" onClick={() => openEdit(o)}>
              <td>
                <b>{o.name}</b>
                {!o.active && (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}> (inactive)</span>
                )}
              </td>
              <td>
                {o.email}
                <br />
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{o.phone}</span>
              </td>
              <td>{o.propertyNicknames.join(", ")}</td>
              <td>{o.billingNotes}</td>
              <td>
                {o.outstandingCents > 0 ? (
                  <span className="err">{formatCad(o.outstandingCents)} unpaid</span>
                ) : (
                  <span className="ok">$0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        className={`modal-overlay${modalOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div className="modal">
          <h3>{editingId ? `Edit ${form.name || "owner"}` : "Add owner"}</h3>
          <p className="sub">Owners are billing records — they don&apos;t log in.</p>

          <div className="fgroup">
            <label>Name</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. David Kim"
            />
          </div>
          <div className="frow">
            <div className="fgroup">
              <label>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="owner@mail.com"
              />
            </div>
            <div className="fgroup">
              <label>Phone</label>
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+1 555-0201"
              />
            </div>
          </div>
          <div className="fgroup">
            <label>Billing notes</label>
            <textarea
              value={form.billingNotes}
              onChange={(e) => set("billingNotes", e.target.value)}
              placeholder="e.g. Pays monthly by bank transfer"
            />
          </div>

          {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}

          <div className="modal-actions">
            {editingId && editingActive && (
              <button
                className="cancel"
                style={{ color: "var(--red)", borderColor: "var(--red)", marginRight: "auto" }}
                onClick={() => setActive(false)}
                disabled={saving}
              >
                Deactivate
              </button>
            )}
            {editingId && !editingActive && (
              <button
                className="cancel"
                style={{ color: "var(--green)", borderColor: "var(--green)", marginRight: "auto" }}
                onClick={() => setActive(true)}
                disabled={saving}
              >
                Reactivate
              </button>
            )}
            <button className="cancel" onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button className="save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save owner"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
