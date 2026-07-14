"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

type LinkType = "none" | "cleaner" | "job";

export type EditingNote = {
  id: string;
  body: string;
  cleanerId: string | null;
  jobId: string | null;
  date: string | null;
};

// Force a link and hide the picker — e.g. adding a note from a job row, where
// the note is always attached to that job.
type LockedLink =
  | { type: "cleaner"; cleanerId: string }
  | { type: "job"; jobId: string };

type Props = {
  open: boolean;
  onClose: () => void;
  cleaners: { id: string; name: string }[];
  jobs: { id: string; label: string }[];
  /** Present ⇒ edit an existing note (PATCH) and show Delete. Absent ⇒ create (POST). */
  editing?: EditingNote | null;
  /** When set, the note is force-linked and the link picker is hidden. */
  lockedLink?: LockedLink;
  /** Heading override; defaults to "Edit note" / "New note". */
  title?: string;
};

// The one note create/edit modal, shared by the Notes admin page, the
// schedule's "Add note" button, and each schedule row's inline "Add note".
// Controlled: the caller owns `open` and renders its own trigger. On a
// successful save/delete it refreshes the router and calls onClose.
export default function NoteModal({
  open,
  onClose,
  cleaners,
  jobs,
  editing,
  lockedLink,
  title,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [linkType, setLinkType] = useState<LinkType>("none");
  const [cleanerId, setCleanerId] = useState("");
  const [jobId, setJobId] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(false);

  // Initialise the form only on the closed→open transition, so a parent
  // re-render (which can hand us a fresh `editing`/`lockedLink` object) never
  // wipes what the admin is mid-way through typing.
  useEffect(() => {
    if (open && !wasOpen.current) {
      if (editing) {
        setBody(editing.body);
        setLinkType(editing.cleanerId ? "cleaner" : editing.jobId ? "job" : "none");
        setCleanerId(editing.cleanerId ?? "");
        setJobId(editing.jobId ?? "");
        setDate(editing.date ?? "");
      } else {
        setBody("");
        setLinkType(lockedLink?.type ?? "none");
        setCleanerId(lockedLink?.type === "cleaner" ? lockedLink.cleanerId : "");
        setJobId(lockedLink?.type === "job" ? lockedLink.jobId : "");
        setDate("");
      }
      setError(null);
      bodyRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, editing, lockedLink]);

  function pickLinkType(type: LinkType) {
    setLinkType(type);
    if (type === "cleaner") setCleanerId((id) => id || cleaners[0]?.id || "");
    if (type === "job") setJobId((id) => id || jobs[0]?.id || "");
  }

  async function save() {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Note text is required");
      return;
    }

    let cleanerOut: string | null = null;
    let jobOut: string | null = null;
    if (lockedLink) {
      if (lockedLink.type === "cleaner") cleanerOut = lockedLink.cleanerId;
      else jobOut = lockedLink.jobId;
    } else if (linkType === "cleaner") {
      if (!cleanerId) {
        setError("Choose a cleaner");
        return;
      }
      cleanerOut = cleanerId;
    } else if (linkType === "job") {
      if (!jobId) {
        setError("Choose a job");
        return;
      }
      jobOut = jobId;
    }

    const payload = { body: trimmed, date: date || null, cleanerId: cleanerOut, jobId: jobOut };

    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/notes/${editing.id}`, { method: "PATCH", body: payload });
      } else {
        await apiFetch("/api/notes", { method: "POST", body: payload });
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!editing) return;
    if (!confirm("Delete this note? This cannot be undone.")) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/notes/${editing.id}`, { method: "DELETE" });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`modal-overlay${open ? " open" : ""}`}
      onClick={(e) => {
        // stopPropagation: the schedule renders this inside a click-to-expand
        // row, so a backdrop click must not also toggle the row.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title ?? (editing ? "Edit note" : "New note")}</h3>
        <p className="sub">
          Notes are visible to admins only — except job-linked notes, which also show to that
          job&apos;s cleaner.
        </p>

        <div className="fgroup">
          <label>Note</label>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note…"
            rows={4}
          />
        </div>

        {!lockedLink && (
          <div className="fgroup">
            <label>Link to</label>
            <div className="cleaner-picker">
              <button
                type="button"
                className={linkType === "none" ? "active" : ""}
                onClick={() => pickLinkType("none")}
              >
                None (general)
              </button>
              <button
                type="button"
                className={linkType === "cleaner" ? "active" : ""}
                onClick={() => pickLinkType("cleaner")}
              >
                Cleaner
              </button>
              <button
                type="button"
                className={linkType === "job" ? "active" : ""}
                onClick={() => pickLinkType("job")}
              >
                Job
              </button>
            </div>
          </div>
        )}

        {!lockedLink && linkType === "cleaner" && (
          <div className="fgroup">
            <label>Cleaner</label>
            <select value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
              {cleaners.length === 0 && <option value="">No active cleaners</option>}
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {!lockedLink && linkType === "job" && (
          <div className="fgroup">
            <label>Job</label>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.length === 0 && <option value="">No jobs</option>}
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="fgroup">
          <label>Date (optional)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}

        <div className="modal-actions">
          {editing && (
            <button
              className="cancel"
              style={{ color: "var(--red)", borderColor: "var(--red)", marginRight: "auto" }}
              onClick={del}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button className="cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="save" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}
