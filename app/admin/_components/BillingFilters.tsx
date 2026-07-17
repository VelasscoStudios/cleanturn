"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addDays, diffDays, lastDayOfMonth, saturdayOf } from "@/lib/dates";
import { formatCents } from "./format";

type Option = { id: string; name: string };
type WeekTally = { weekStart: string; count: number; dueCents: number };
type Summary = { paidCents: number; paidCount: number; unpaidCents: number; unpaidCount: number };

// Sentinel passed to updateParams to force a literal `key=` (empty value) into
// the URL, distinct from the default "" / null behavior (delete the key).
// Needed for status=All: a missing status param already means "unpaid" server
// side, so "All" has to be a real, present-but-empty param to be reachable.
const EMPTY = Symbol("explicit-empty-param");

const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const monthOnlyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" });

/** "Jul 6" for a YYYY-MM-DD string. */
function fmtMonthDay(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return monthDayFmt.format(new Date(Date.UTC(y, m - 1, day, 12, 0, 0)));
}

/** Day-of-month with no leading zero, e.g. "05" -> "5". */
function dayOnly(d: string): string {
  return String(Number(d.slice(8, 10)));
}

/** Full month name, e.g. "July", for the month containing `d`. */
function monthName(d: string): string {
  const [y, m] = d.split("-").map(Number);
  return monthOnlyFmt.format(new Date(Date.UTC(y, m - 1, 1, 12, 0, 0)));
}

// "Jul 6 – 12" within a month, "Jun 29 – Jul 5" across months. `yearAnchor`,
// when given, appends the year to both ends as soon as either endpoint's year
// differs from it (used by custom-range mode; week/month modes don't show a year).
function rangeText(from: string, to: string, yearAnchor?: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  let fromText = fmtMonthDay(from);
  let toText = sameMonth ? dayOnly(to) : fmtMonthDay(to);
  if (yearAnchor && (from.slice(0, 4) !== yearAnchor || to.slice(0, 4) !== yearAnchor)) {
    fromText += `, ${from.slice(0, 4)}`;
    toText += `, ${to.slice(0, 4)}`;
  }
  return `${fromText} – ${toText}`;
}

type Mode = "week" | "month" | "custom";

function computeMode(from: string, to: string, today: string): Mode {
  // Pay weeks run Saturday→Friday (paid each Friday), not calendar Mon–Sun.
  if (from === saturdayOf(from) && to === addDays(from, 6)) return "week";
  const isFirstOfMonth = from.slice(8, 10) === "01";
  const fromMonth = from.slice(0, 7);
  const todayMonth = today.slice(0, 7);
  if (isFirstOfMonth && (to === lastDayOfMonth(from) || (fromMonth === todayMonth && to === today))) {
    return "month";
  }
  return "custom";
}

function computeLabel(mode: Mode, from: string, to: string, today: string): string {
  if (mode === "week") {
    const text = rangeText(from, to);
    return from === saturdayOf(today) ? `This week · ${text}` : `Week of ${text}`;
  }
  if (mode === "month") {
    const isCurrentMonth = from.slice(0, 7) === today.slice(0, 7);
    const name = monthName(from);
    if (isCurrentMonth) return `${name} · so far`;
    return from.slice(0, 4) !== today.slice(0, 4) ? `${name}, ${from.slice(0, 4)}` : name;
  }
  return rangeText(from, to, today.slice(0, 4));
}

/** Row label for a week in the "Jump to a week" list. */
function weekRowLabel(index: number, weekStart: string): string {
  const text = rangeText(weekStart, addDays(weekStart, 6));
  if (index === 0) return `This week · ${text}`;
  if (index === 1) return `Last week · ${text}`;
  return text;
}

function weekBadge(index: number, tally: WeekTally): { text: string; cls: string } {
  // The current pay week (index 0) shows real tallies as cleans complete —
  // useful on Friday, payday — and only reads "in progress" while empty.
  if (tally.count === 0) return { text: index === 0 ? "in progress" : "no cleans", cls: "muted" };
  if (tally.dueCents > 0) return { text: `${formatCents(tally.dueCents)} due`, cls: "red" };
  return { text: index === 0 ? "✓ so far" : "✓ settled", cls: "green" };
}

export default function BillingFilters({
  cleaners,
  owners,
  from,
  to,
  today,
  summary,
  weekTallies,
}: {
  cleaners: Option[];
  owners: Option[];
  from: string;
  to: string;
  // Computed server-side (todayStr() reads APP_TIMEZONE, unavailable in the
  // client bundle) so presets/mode detection use the business timezone, not
  // the browser's.
  today: string;
  summary: Summary;
  weekTallies: WeekTally[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const cleanerId = searchParams.get("cleanerId") ?? "";
  const ownerId = searchParams.get("ownerId") ?? "";
  // Missing param -> "unpaid" (Owing); "" -> All; "paid" -> Settled.
  const status = searchParams.get("status") ?? "unpaid";

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [visibleWeeks, setVisibleWeeks] = useState(5);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  // Set/delete multiple keys in one navigation — presets need to update
  // from+to together without one push clobbering the other. `EMPTY` sets a
  // literal empty value instead of deleting the key; plain "" or null still
  // delete, exactly as before.
  function updateParams(entries: Record<string, string | null | typeof EMPTY>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(entries)) {
      if (value === EMPTY) {
        params.set(key, "");
      } else if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    router.push(`/admin/billing?${params.toString()}`);
  }

  function updateParam(key: string, value: string | null | typeof EMPTY) {
    updateParams({ [key]: value });
  }

  function openPopover() {
    setCustomFrom(from);
    setCustomTo(to);
    setVisibleWeeks(5);
    setPopoverOpen(true);
  }

  function closePopover() {
    setPopoverOpen(false);
  }

  function applyRange(newFrom: string, newTo: string) {
    updateParams({ from: newFrom, to: newTo });
    closePopover();
  }

  useEffect(() => {
    if (!popoverOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popoverOpen]);

  const mode = computeMode(from, to, today);
  const label = computeLabel(mode, from, to, today);

  // Step the whole range backward/forward. Week/custom ranges shift by their
  // own length (inclusive), so a 7-day range pages exactly one week per
  // click. Month ranges step by full calendar months instead.
  function stepPrev() {
    if (mode === "month") {
      const prevLast = addDays(from, -1); // day before the 1st = last day of previous month
      const prevFirst = `${prevLast.slice(0, 8)}01`;
      updateParams({ from: prevFirst, to: prevLast });
    } else {
      const len = diffDays(from, to) + 1;
      updateParams({ from: addDays(from, -len), to: addDays(to, -len) });
    }
  }

  function stepNext() {
    if (mode === "month") {
      const nextFirst = addDays(lastDayOfMonth(from), 1);
      const nextLast = lastDayOfMonth(nextFirst);
      updateParams({ from: nextFirst, to: nextLast < today ? nextLast : today });
    } else {
      const len = diffDays(from, to) + 1;
      updateParams({ from: addDays(from, len), to: addDays(to, len) });
    }
  }

  function applyCustom() {
    const [a, b] = customFrom > customTo ? [customTo, customFrom] : [customFrom, customTo];
    applyRange(a, b);
  }

  const shownWeeks = weekTallies.slice(0, visibleWeeks);
  const hasMoreWeeks = visibleWeeks < weekTallies.length;
  // Week rows start on pay-week Saturdays, so only a 7-day-inclusive range
  // whose `from` is one of those Saturdays can match a row.
  const headerIsWeekRange = to === addDays(from, 6);

  const thisMonthFirst = `${today.slice(0, 8)}01`;

  return (
    <div className="bill-head">
      <div className="bill-head-row">
        <div className="pager-wrap">
          <div className="pager">
            <button type="button" aria-label="Previous period" onClick={stepPrev}>
              ◀
            </button>
            <button
              type="button"
              className="pager-label"
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
              onClick={() => (popoverOpen ? closePopover() : openPopover())}
            >
              {label} <span className="caret">{popoverOpen ? "▴" : "▾"}</span>
            </button>
            <button type="button" aria-label="Next period" disabled={to >= today} onClick={stepNext}>
              ▶
            </button>
          </div>

          {popoverOpen && (
            <>
              <div className="date-pop-backdrop" onClick={closePopover} />
              <div className="date-pop" role="dialog" aria-label="Choose a date range">
                <div className="pop-label">Jump to a week</div>
                {shownWeeks.map((w, i) => {
                  const active = headerIsWeekRange && w.weekStart === from;
                  const badge = weekBadge(i, w);
                  return (
                    <button
                      key={w.weekStart}
                      type="button"
                      className={`week-row${active ? " active" : ""}`}
                      onClick={() => applyRange(w.weekStart, addDays(w.weekStart, 6))}
                    >
                      <span>{weekRowLabel(i, w.weekStart)}</span>
                      <span className={`week-badge ${badge.cls}`}>{badge.text}</span>
                    </button>
                  );
                })}
                {hasMoreWeeks && (
                  <button
                    type="button"
                    className="more-row"
                    onClick={() => setVisibleWeeks((v) => Math.min(v + 6, weekTallies.length))}
                  >
                    Earlier weeks…
                  </button>
                )}

                <div className="pop-divider" />
                <div className="pop-label">Presets</div>
                <div className="pop-chips">
                  <button
                    type="button"
                    className="pop-chip"
                    onClick={() => applyRange(addDays(today, -6), today)}
                  >
                    Last 7 days
                  </button>
                  <button type="button" className="pop-chip" onClick={() => applyRange(thisMonthFirst, today)}>
                    This month
                  </button>
                </div>

                <div className="pop-divider" />
                <div className="pop-label">Custom range</div>
                <div className="custom-row">
                  <input
                    type="date"
                    aria-label="From"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                  <input type="date" aria-label="To" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                  {/* Disabled while either input is cleared — an empty value would
                      delete its URL param and silently snap back to the default week. */}
                  <button
                    type="button"
                    className="apply-btn"
                    disabled={!customFrom || !customTo}
                    onClick={applyCustom}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="paidline">
          <span className="paid">
            ✓ Paid {formatCents(summary.paidCents)} · {summary.paidCount} clean{summary.paidCount === 1 ? "" : "s"}
          </span>
          {summary.unpaidCount > 0 && (
            <span className="owing">
              {" "}
              · Outstanding {formatCents(summary.unpaidCents)} · {summary.unpaidCount} clean
              {summary.unpaidCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <div className="bill-head-row">
        <div className="seg">
          <button
            type="button"
            className={status === "unpaid" ? "active" : ""}
            aria-pressed={status === "unpaid"}
            onClick={() => updateParam("status", null)}
          >
            Owing
          </button>
          <button
            type="button"
            className={status === "paid" ? "active" : ""}
            aria-pressed={status === "paid"}
            onClick={() => updateParam("status", "paid")}
          >
            Settled
          </button>
          <button
            type="button"
            className={status === "" ? "active" : ""}
            aria-pressed={status === ""}
            onClick={() => updateParam("status", EMPTY)}
          >
            All
          </button>
        </div>
        <select
          className="quiet-sel"
          value={cleanerId}
          onChange={(e) => updateParam("cleanerId", e.target.value || null)}
        >
          <option value="">All cleaners</option>
          {cleaners.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="quiet-sel" value={ownerId} onChange={(e) => updateParam("ownerId", e.target.value || null)}>
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
