"use client";

import { useState } from "react";
import NoteModal from "./NoteModal";

type CleanerOption = { id: string; name: string };
type JobOption = { id: string; label: string }; // "nickname - date"

// Schedule-page "Add note" trigger. The form lives in the shared NoteModal.
export default function AddNoteButton({
  cleaners,
  jobs,
}: {
  cleaners: CleanerOption[];
  jobs: JobOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="add-btn" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
        📝 Add note
      </button>
      <NoteModal
        open={open}
        onClose={() => setOpen(false)}
        cleaners={cleaners}
        jobs={jobs}
        title="Add note"
      />
    </>
  );
}
