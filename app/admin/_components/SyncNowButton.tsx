"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";

type SyncCounts = {
  created: number;
  moved: number;
  cancelled: number;
  errors: number;
};

export default function SyncNowButton({ lastSyncedLabel }: { lastSyncedLabel: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const counts = await apiFetch<SyncCounts>("/api/sync-now", { method: "POST" });
      setResult(counts);
      router.refresh();
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setTimeout(() => setError(null), 5000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
      <button
        className="add-btn"
        style={{ marginBottom: 0 }}
        onClick={handleSync}
        disabled={loading}
      >
        {loading ? "Syncing…" : "🔄 Sync now"}
      </button>
      <span className="muted-note" style={{ marginTop: 0 }}>
        Last synced: {lastSyncedLabel}
      </span>
      {result && (
        <span className="ok">
          ✓ {result.created} new · {result.moved} moved · {result.cancelled} cancelled
          {result.errors > 0 ? ` · ${result.errors} errors` : ""}
        </span>
      )}
      {error && <span className="err">✗ {error}</span>}
    </div>
  );
}
