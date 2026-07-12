"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

// Statuses an admin can set directly from the schedule. Whether a job has a
// cleaner is driven by the assign dropdown, so the two controls never fight
// over the same state.
const OPTIONS: { value: string; label: string }[] = [
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed ✅" },
  { value: "cancelled", label: "Cancelled" },
];

const CHIP_CLASS: Record<string, string> = {
  assigned: "assigned",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

export default function StatusSelect({
  jobId,
  status,
}: {
  jobId: string;
  status: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = e.target.value;
    const previous = value;
    setValue(newValue);
    setError(null);
    try {
      await apiFetch(`/api/jobs/${jobId}/status`, {
        method: "PATCH",
        body: { status: newValue },
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  }

  return (
    <div>
      <select
        className={`chip chip-select ${CHIP_CLASS[value] ?? value}`}
        value={value}
        onChange={handleChange}
        disabled={isPending}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <div style={{ color: "var(--red)", fontSize: "11px", marginTop: "4px" }}>
          {error}
        </div>
      )}
    </div>
  );
}
