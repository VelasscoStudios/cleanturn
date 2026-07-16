"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import { formatCents } from "./format";

const shortDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Format a YYYY-MM-DD string as e.g. "Jul 7" — compact, for the confirm dialog's range line. */
function fmtShort(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return shortDayFmt.format(new Date(Date.UTC(y, m - 1, day, 12)));
}

/**
 * Bulk "mark paid" for a group in the cleaner-first billing tree. Pass a
 * cleanerId (null = the unassigned bucket) to settle a whole cleaner, plus an
 * ownerId to settle just that owner's cleans under the cleaner. `from`/`to`
 * scope the bulk update to the report's currently selected date range.
 *
 * Click opens a confirm dialog (amount + clean count + range) before firing
 * the bulk update — this touches many cleans at once, unlike a per-clean
 * action, so it's worth an extra step. Reuses NoteModal's
 * modal-overlay/modal pattern.
 */
export default function MarkAllPaidButton({
  cleanerId,
  ownerId,
  from,
  to,
  amountCents,
  cleanCount,
  confirmName,
  label = "Mark paid",
  ghost = false,
}: {
  cleanerId?: string | null;
  ownerId?: string;
  from: string;
  to: string;
  amountCents: number;
  cleanCount: number;
  confirmName: string;
  label?: string;
  ghost?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) setConfirming(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, loading]);

  // The modal is always mounted (`.open` toggles visibility via CSS), so
  // `autoFocus` never fires on mount — focus the cancel button manually
  // whenever the dialog opens.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/billing/mark-paid", {
        method: "POST",
        // cleanerId is included only when the caller passed the prop, so the
        // "any cleaner" case never leaks a null the API would read as
        // "unassigned only".
        body: {
          ...(cleanerId !== undefined ? { cleanerId } : {}),
          ...(ownerId !== undefined ? { ownerId } : {}),
          from,
          to,
        },
      });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      // Leave the dialog open so the admin sees the error and can retry.
      setError(err instanceof Error ? err.message : "Failed to mark paid");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className={`mark-all${ghost ? " ghost" : ""}`}
        onClick={() => setConfirming(true)}
        disabled={loading}
      >
        {label}
      </button>

      <div
        className={`modal-overlay${confirming ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget && !loading) setConfirming(false);
        }}
      >
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
          <h3 id={headingId}>Mark paid — {confirmName}</h3>
          <p className="sub">
            {cleanCount} clean{cleanCount === 1 ? "" : "s"} · {fmtShort(from)} – {fmtShort(to)}
          </p>
          <p className="confirm-amount">{formatCents(amountCents)}</p>

          {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}

          <div className="modal-actions">
            <button
              ref={cancelRef}
              className="cancel"
              onClick={() => setConfirming(false)}
              disabled={loading}
            >
              Not yet
            </button>
            <button className="save" onClick={handleConfirm} disabled={loading}>
              {loading ? "Saving…" : "Yes, mark paid"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
