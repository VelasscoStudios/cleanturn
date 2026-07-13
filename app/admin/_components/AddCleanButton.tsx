"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

type PropertyOption = { id: string; name: string; cleanCostCents: number };
type CleanerOption = { id: string; name: string };

function dollarsToCents(v: string): number {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

function todayStrLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Adds a manual clean — a job the iCal feed knows nothing about (owner request,
// deep clean, re-clean after a complaint, …). Sync never touches these.
export default function AddCleanButton({
  properties,
  cleaners,
}: {
  properties: PropertyOption[];
  cleaners: CleanerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState(todayStrLocal());
  const [cost, setCost] = useState("");
  const [cleanerId, setCleanerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  function openModal() {
    setPropertyId("");
    setDate(todayStrLocal());
    setCost("");
    setCleanerId("");
    setError(null);
    setOpen(true);
  }

  function pickProperty(id: string) {
    setPropertyId(id);
    const p = properties.find((x) => x.id === id);
    if (p) setCost((p.cleanCostCents / 100).toString());
  }

  async function save() {
    setError(null);
    if (!propertyId) {
      setError("Pick a property");
      return;
    }
    if (!date) {
      setError("Pick a date");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/jobs", {
        method: "POST",
        body: {
          propertyId,
          date,
          costCents: dollarsToCents(cost),
          cleanerId: cleanerId || null,
        },
      });
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add clean");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button className="add-btn" style={{ marginBottom: 12 }} onClick={openModal}>
        + Add manual clean
      </button>

      <div
        className={`modal-overlay${open ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="modal">
          <h3>Add manual clean</h3>
          <p className="sub">
            For cleans that don&apos;t come from a booking calendar — owner requests, deep
            cleans, re-cleans. Sync won&apos;t move or cancel these.
          </p>

          <div className="fgroup">
            <label>Property</label>
            <select value={propertyId} onChange={(e) => pickProperty(e.target.value)}>
              <option value="">— Select property —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="frow">
            <div className="fgroup">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="fgroup">
              <label>Cost ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="65"
              />
            </div>
          </div>
          <div className="fgroup">
            <label>Assign cleaner (optional)</label>
            <select value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
              <option value="">— Leave unassigned —</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}

          <div className="modal-actions">
            <button className="cancel" onClick={() => setOpen(false)} disabled={saving}>
              Close
            </button>
            <button className="save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Add clean"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
