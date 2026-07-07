"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import type { PropertyRow, OwnerOption } from "./page";

function formatCad(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function dollarsToCents(v: string): number {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type FormState = {
  ownerId: string;
  nickname: string;
  address: string;
  icalUrl: string;
  cost: string; // euros, string for input
  arriveTime: string;
  outByTime: string;
  accessCode: string;
  directions: string;
  notes: string;
};

const emptyForm = (owners: OwnerOption[]): FormState => ({
  ownerId: owners[0]?.id ?? "",
  nickname: "",
  address: "",
  icalUrl: "",
  cost: "",
  arriveTime: "11:00",
  outByTime: "16:00",
  accessCode: "",
  directions: "",
  notes: "",
});

export default function PropertiesClient({
  properties,
  owners,
}: {
  properties: PropertyRow[];
  owners: OwnerOption[];
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingActive, setEditingActive] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm(owners));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setEditingId(null);
    setEditingActive(true);
    setForm(emptyForm(owners));
    setError(null);
    setModalOpen(true);
  }

  function openEdit(p: PropertyRow) {
    setEditingId(p.id);
    setEditingActive(p.active);
    setForm({
      ownerId: p.ownerId,
      nickname: p.nickname,
      address: p.address,
      icalUrl: p.icalUrl,
      cost: (p.cleanCostCents / 100).toString(),
      arriveTime: p.arriveTime,
      outByTime: p.outByTime,
      accessCode: p.accessCode,
      directions: p.directions,
      notes: p.notes,
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
    if (!form.nickname.trim() || !form.address.trim()) {
      setError("Nickname and address are required");
      return;
    }
    if (!form.icalUrl.trim()) {
      setError("Paste the Airbnb iCal link — without it bookings cannot sync");
      return;
    }
    if (!form.ownerId) {
      setError("Choose an owner");
      return;
    }

    const body = {
      ownerId: form.ownerId,
      nickname: form.nickname.trim(),
      address: form.address.trim(),
      icalUrl: form.icalUrl.trim(),
      cleanCostCents: dollarsToCents(form.cost),
      arriveTime: form.arriveTime,
      outByTime: form.outByTime,
      accessCode: form.accessCode,
      directions: form.directions,
      notes: form.notes,
    };

    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/api/properties/${editingId}`, { method: "PATCH", body });
      } else {
        await apiFetch("/api/properties", { method: "POST", body });
      }
      setModalOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save property");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/properties/${editingId}`, {
        method: "PATCH",
        body: { active: false },
      });
      setModalOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deactivate property");
    } finally {
      setSaving(false);
    }
  }

  async function reactivate() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/properties/${editingId}`, {
        method: "PATCH",
        body: { active: true },
      });
      setModalOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reactivate property");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="add-btn" onClick={openAdd}>
        + Add property
      </button>
      <table>
        <thead>
          <tr>
            <th>Nickname</th>
            <th>Owner</th>
            <th>Address</th>
            <th>$/clean</th>
            <th>Window</th>
            <th>Access</th>
            <th>iCal sync</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr
              key={p.id}
              className="clickable"
              title="Click to edit"
              onClick={() => openEdit(p)}
            >
              <td>
                <b>{p.nickname}</b>
                {!p.active && (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}> (inactive)</span>
                )}
              </td>
              <td>{p.ownerName}</td>
              <td>{p.address}</td>
              <td>
                <b>{formatCad(p.cleanCostCents)}</b>
              </td>
              <td>
                {p.arriveTime}–{p.outByTime}
              </td>
              <td>{p.accessCode}</td>
              <td>
                {p.syncStatus === "ok" ? (
                  <span className="ok">● Synced {timeAgo(p.lastSyncAt)}</span>
                ) : p.syncStatus === "error" ? (
                  <span className="err">
                    ● {p.syncError ? p.syncError : "Feed error — check iCal URL"}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>● Pending first sync</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted-note">
        Click any row to edit. Feeds re-sync every 30 min. A failing feed shows a red badge.
      </p>

      <div className={`modal-overlay${modalOpen ? " open" : ""}`} onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}>
        <div className="modal">
          <h3>{editingId ? `Edit ${form.nickname || "property"}` : "Add property"}</h3>
          <p className="sub">Everything the app needs to sync bookings and brief the cleaner.</p>

          <div className="frow">
            <div className="fgroup">
              <label>Owner (pays for cleans)</label>
              <select value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="fgroup">
              <label>Nickname</label>
              <input
                value={form.nickname}
                onChange={(e) => set("nickname", e.target.value)}
                placeholder="e.g. Sunset Loft"
              />
            </div>
          </div>

          <div className="fgroup">
            <label>Address</label>
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Street, number, unit"
            />
          </div>

          <div className="fgroup">
            <label>Airbnb calendar link (iCal URL)</label>
            <input
              value={form.icalUrl}
              onChange={(e) => set("icalUrl", e.target.value)}
              placeholder="https://www.airbnb.com/calendar/ical/12345678.ics?s=…"
            />
            <div className="hint">Bookings sync from this link automatically every 30 min.</div>
          </div>
          <div className="ical-box">
            <b>Where to find it:</b> Airbnb → Calendar for this listing → <b>Availability</b> →{" "}
            <b>Connect calendars</b> → <b>Export calendar</b> → copy the link. Each listing has its
            own link.
          </div>

          <div className="frow">
            <div className="fgroup">
              <label>Cost per clean (CAD $)</label>
              <input
                type="number"
                value={form.cost}
                onChange={(e) => set("cost", e.target.value)}
                placeholder="65"
              />
            </div>
            <div className="fgroup">
              <label>Arrive from</label>
              <input
                type="time"
                value={form.arriveTime}
                onChange={(e) => set("arriveTime", e.target.value)}
              />
            </div>
            <div className="fgroup">
              <label>Must be out by</label>
              <input
                type="time"
                value={form.outByTime}
                onChange={(e) => set("outByTime", e.target.value)}
              />
            </div>
          </div>

          <div className="fgroup">
            <label>Security / access code</label>
            <input
              value={form.accessCode}
              onChange={(e) => set("accessCode", e.target.value)}
              placeholder="e.g. Lockbox 0455, alarm 8821#"
            />
          </div>
          <div className="fgroup">
            <label>Directions</label>
            <textarea
              value={form.directions}
              onChange={(e) => set("directions", e.target.value)}
              placeholder="Parking, entrance, landmarks… e.g. Blue gate behind the bakery"
            />
          </div>
          <div className="fgroup">
            <label>Notes for cleaner</label>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Linen location, supplies, quirks…"
            />
          </div>

          {error && (
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>
          )}

          <div className="modal-actions">
            {editingId && editingActive && (
              <button
                className="cancel"
                style={{ color: "var(--red)", borderColor: "var(--red)", marginRight: "auto" }}
                onClick={deactivate}
                disabled={saving}
              >
                Deactivate
              </button>
            )}
            {editingId && !editingActive && (
              <button
                className="cancel"
                style={{ color: "var(--green)", borderColor: "var(--green)", marginRight: "auto" }}
                onClick={reactivate}
                disabled={saving}
              >
                Reactivate
              </button>
            )}
            <button className="cancel" onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button className="save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save property"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
