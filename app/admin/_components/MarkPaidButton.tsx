"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

export default function MarkPaidButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/jobs/${jobId}/paid`, {
        method: "PATCH",
        body: { paid: true },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark paid");
      setLoading(false);
    }
  }

  return (
    <>
      <button className="mark-one" onClick={handleClick} disabled={loading}>
        {loading ? "Marking…" : "Mark paid"}
      </button>
      {error && (
        <span style={{ color: "var(--red)", fontSize: "11px", marginLeft: "6px" }}>
          {error}
        </span>
      )}
    </>
  );
}
