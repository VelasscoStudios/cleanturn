"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

type Option = { id: string; name: string; hasNotes?: boolean };

export default function AssignSelect({
  jobId,
  cleanerId,
  cleanerName,
  cleaners,
}: {
  jobId: string;
  cleanerId: string | null;
  cleanerName?: string | null;
  cleaners: Option[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(cleanerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // If the job's assigned cleaner is inactive (so absent from the active
  // `cleaners` list passed in), still render them as a selectable option so
  // the select doesn't silently show blank for an assigned job.
  const options =
    cleanerId && !cleaners.some((c) => c.id === cleanerId)
      ? [...cleaners, { id: cleanerId, name: cleanerName ? `${cleanerName} (inactive)` : "Unknown" }]
      : cleaners;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = e.target.value;
    const previous = value;
    setValue(newValue);
    setError(null);
    try {
      await apiFetch(`/api/jobs/${jobId}/assign`, {
        method: "PATCH",
        body: { cleanerId: newValue || null },
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : "Failed to assign");
    }
  }

  return (
    <div>
      <select
        className={!value ? "empty" : ""}
        value={value}
        onChange={handleChange}
        disabled={isPending}
      >
        <option value="">— Assign cleaner —</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.hasNotes ? " 📝" : ""}
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
