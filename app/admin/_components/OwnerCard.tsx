"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Collapsible owner card inside a billing cleaner group. The header carries
 * everything needed to settle on payday — tallies and the Mark paid button —
 * so cards start collapsed; expanding reveals the server-rendered
 * property/clean detail passed as children. The settle button is isolated
 * from the toggle so paying never accidentally expands/collapses.
 */
export default function OwnerCard({
  ownerName,
  initials,
  propertyCount,
  cleanCount,
  paidNote,
  oweNote,
  settledNote,
  payButton,
  children,
}: {
  ownerName: string;
  initials: string;
  propertyCount: number;
  cleanCount: number;
  /** e.g. "✓ $155 paid" — shown only while the owner still has unpaid cleans. */
  paidNote?: string;
  /** e.g. "$90" — the owner's unpaid total. */
  oweNote?: string;
  /** e.g. "Paid ✓ · Jul 10" — shown when the owner is fully settled. */
  settledNote?: string;
  payButton?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Keydown bubbles from children — without this guard, Enter on the
    // Mark paid button would toggle the card and suppress the payment click.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
  }

  return (
    <div className="owner-card">
      <div
        className="owner-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className="avatar">{initials}</span>
        <span className="oname">
          <b>{ownerName}</b>{" "}
          <span className="ometa">
            · {propertyCount} propert{propertyCount === 1 ? "y" : "ies"} · {cleanCount} clean
            {cleanCount === 1 ? "" : "s"}
          </span>
        </span>
        <span className="oright">
          {paidNote && <span className="paid-tally">{paidNote}</span>}
          {oweNote && <span className="owe-sub">{oweNote}</span>}
          {settledNote && <span className="chip completed">{settledNote}</span>}
          {/* Keep settle clicks out of the expand/collapse toggle. */}
          {payButton && <span onClick={(e) => e.stopPropagation()}>{payButton}</span>}
        </span>
      </div>
      {open && <div className="owner-card-body">{children}</div>}
    </div>
  );
}
