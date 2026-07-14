"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import AssignSelect from "./AssignSelect";
import StatusSelect from "./StatusSelect";
import NoteModal from "./NoteModal";
import { formatCents } from "./format";

type Cleaner = { id: string; name: string; hasNotes?: boolean };

type JobNote = { id: string; body: string; date: string | null };

export type JobRowData = {
  id: string;
  arriveTime: string;
  outByTime: string;
  nickname: string;
  address: string;
  accessCode: string;
  directions: string;
  costCents: number;
  status: string;
  cleanerId: string | null;
  cleanerName: string | null;
  sameDayTurnover: boolean;
  nextCheckinNote: string | null;
  manual: boolean;
  notes: JobNote[];
  // Notes linked to the assigned cleaner (not the job) — e.g. "cannot clean
  // houses larger than 3 beds". Empty when unassigned.
  cleanerNotes: JobNote[];
};

// One dense schedule row. Click anywhere on the row (except the assign
// dropdown) to expand the address / access code / directions detail line.
export default function JobRow({ job, cleaners }: { job: JobRowData; cleaners: Cleaner[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [, startTransition] = useTransition();
  // "Unassigned" is not a status — it's the absence of a cleaner on a job
  // that still needs doing.
  const unassigned = !job.cleanerId && job.status === "assigned";

  // Synced jobs are cancelled by the feed; a manual clean has no feed, so it
  // needs an explicit way off the schedule.
  async function cancelManual() {
    setCancelling(true);
    setCancelError(null);
    try {
      await apiFetch(`/api/jobs/${job.id}/status`, {
        method: "PATCH",
        body: { status: "cancelled" },
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <tr
        className={`srow ${unassigned ? "unassigned" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="c-caret">{open ? "▾" : "▸"}</td>
        <td className="c-time">{job.arriveTime}</td>
        <td className="c-prop">
          <span className="nick">{job.nickname}</span>
          {job.manual && (
            <span className="flag mini" title="Manual clean — not from the booking calendar">
              ✍️ manual
            </span>
          )}
          {job.sameDayTurnover && (
            <span className="flag mini" title="Same-day turnover">
              ⚡{job.nextCheckinNote ? ` ${job.nextCheckinNote}` : ""}
            </span>
          )}
          {job.notes.length > 0 && (
            <span
              className="note-badge"
              title={`${job.notes.length} note${job.notes.length > 1 ? "s" : ""}`}
            >
              📝 {job.notes.length}
            </span>
          )}
          {job.cleanerNotes.length > 0 && (
            <span
              className="note-badge cleaner"
              title={`${job.cleanerNotes.length} note${job.cleanerNotes.length > 1 ? "s" : ""} about ${job.cleanerName ?? "cleaner"}`}
            >
              🧹 {job.cleanerNotes.length}
            </span>
          )}
        </td>
        <td className="c-cost">{formatCents(job.costCents)}</td>
        {/* Stop propagation so using the dropdown doesn't also toggle the row. */}
        <td className="c-assign" onClick={(e) => e.stopPropagation()}>
          <AssignSelect
            jobId={job.id}
            cleanerId={job.cleanerId}
            cleanerName={job.cleanerName}
            cleaners={cleaners}
          />
        </td>
        {/* Unassigned jobs keep a read-only chip: their stage is driven by
            the assign dropdown (picking a cleaner makes them Assigned). Once
            a cleaner is set, the owner can move the stage to Completed. */}
        <td className="c-status" onClick={(e) => e.stopPropagation()}>
          {unassigned ? (
            <span className="chip unassigned">Unassigned</span>
          ) : (
            <StatusSelect jobId={job.id} status={job.status} />
          )}
        </td>
      </tr>
      {open && (
        <tr className="srow-detail">
          <td />
          <td colSpan={5}>
            <div className="detail">
              <span>⏰ {job.arriveTime} → out by {job.outByTime}</span>
              <span>📍 {job.address || "—"}</span>
              <span>🔑 {job.accessCode || "—"}</span>
              {job.directions ? <span>🧭 {job.directions}</span> : null}
              {job.notes.length > 0 && (
                <div className="note-list">
                  {job.notes.map((n) => (
                    <div className="note-callout" key={n.id}>
                      {n.date && <div className="note-date">{n.date}</div>}
                      {n.body}
                    </div>
                  ))}
                </div>
              )}
              {job.cleanerNotes.length > 0 && (
                <div className="note-list">
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                    🧹 Notes about {job.cleanerName ?? "cleaner"}
                  </div>
                  {job.cleanerNotes.map((n) => (
                    <div className="note-callout cleaner" key={n.id}>
                      {n.date && <div className="note-date">{n.date}</div>}
                      {n.body}
                    </div>
                  ))}
                </div>
              )}
              <span onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="cancel"
                  style={{ color: "var(--brand)", borderColor: "var(--brand)" }}
                  onClick={() => setNoteOpen(true)}
                >
                  📝 Add note
                </button>
              </span>
              {job.manual && job.status !== "cancelled" && job.status !== "completed" && (
                <span onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="cancel"
                    style={{ color: "var(--red)", borderColor: "var(--red)" }}
                    onClick={cancelManual}
                    disabled={cancelling}
                  >
                    {cancelling ? "Cancelling…" : "Cancel manual clean"}
                  </button>
                  {cancelError && (
                    <span style={{ color: "var(--red)", fontSize: 11, marginLeft: 6 }}>
                      {cancelError}
                    </span>
                  )}
                </span>
              )}
            </div>
            <NoteModal
              open={noteOpen}
              onClose={() => setNoteOpen(false)}
              cleaners={[]}
              jobs={[]}
              lockedLink={{ type: "job", jobId: job.id }}
              title="Add note"
            />
          </td>
        </tr>
      )}
    </>
  );
}
