"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/client";

export default function MarkAllPaidButton({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const month = searchParams.get("month") || undefined;
      await apiFetch("/api/billing/mark-owner-paid", {
        method: "POST",
        body: { ownerId, month },
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark owner paid");
      setLoading(false);
    }
  }

  return (
    <>
      <button className="mark-all" onClick={handleClick} disabled={loading}>
        {loading ? "Marking…" : "✓ Mark all paid"}
      </button>
      {error && (
        <span style={{ color: "var(--red)", fontSize: "11px", marginLeft: "6px" }}>
          {error}
        </span>
      )}
    </>
  );
}
