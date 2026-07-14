"use client";

import { useMemo, useState } from "react";
import NoteModal, { type EditingNote } from "@/app/admin/_components/NoteModal";
import type { NoteRow, CleanerOption, JobOption } from "./page";

type FilterType = "all" | "general" | "cleaner" | "job";

const FILTER_LABEL: Record<FilterType, string> = {
  all: "All",
  general: "General",
  cleaner: "Cleaner",
  job: "Job",
};

export default function NotesClient({
  notes,
  cleaners,
  jobs,
}: {
  notes: NoteRow[];
  cleaners: CleanerOption[];
  jobs: JobOption[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EditingNote | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (filterType === "general" && (n.cleanerId || n.jobId)) return false;
      if (filterType === "cleaner" && !n.cleanerId) return false;
      if (filterType === "job" && !n.jobId) return false;
      if (q) {
        const hay = `${n.body} ${n.cleanerName ?? ""} ${n.jobLabel ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notes, filterType, search]);

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(n: NoteRow) {
    setEditing({
      id: n.id,
      body: n.body,
      cleanerId: n.cleanerId,
      jobId: n.jobId,
      date: n.date,
    });
    setModalOpen(true);
  }

  return (
    <>
      <button className="add-btn" onClick={openAdd}>
        + New note
      </button>

      <div className="filters">
        <div className="cleaner-picker">
          {(Object.keys(FILTER_LABEL) as FilterType[]).map((f) => (
            <button
              key={f}
              type="button"
              className={filterType === f ? "active" : ""}
              onClick={() => setFilterType(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes…"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {notes.length === 0 ? "No notes yet." : "No notes match your filters."}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Note</th>
              <th>Linked to</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => (
              <tr key={n.id} className="clickable" title="Click to edit" onClick={() => openEdit(n)}>
                <td>
                  <span
                    title={n.body}
                    style={{
                      display: "block",
                      maxWidth: 420,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {n.body}
                  </span>
                </td>
                <td>
                  {n.cleanerId ? (
                    <span className="chip note-cleaner">🧹 {n.cleanerName ?? "Cleaner"}</span>
                  ) : n.jobId ? (
                    <span className="chip note-job">🏠 {n.jobLabel ?? "Job"}</span>
                  ) : (
                    <span className="chip note-general">General</span>
                  )}
                </td>
                <td>{n.date ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NoteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        cleaners={cleaners}
        jobs={jobs}
        editing={editing}
      />
    </>
  );
}
