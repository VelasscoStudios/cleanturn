"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { addDays } from "@/lib/dates";

type Option = { id: string; name: string };

/** Monday (YYYY-MM-DD) of the week containing `dateStr`. */
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isoDow = dow === 0 ? 7 : dow; // Sunday (0) -> 7, so Monday is always day 1.
  return addDays(dateStr, -(isoDow - 1));
}

export default function BillingFilters({
  cleaners,
  owners,
  from,
  to,
  today,
}: {
  cleaners: Option[];
  owners: Option[];
  from: string;
  to: string;
  // Computed server-side (todayStr() reads APP_TIMEZONE, unavailable in the
  // client bundle) so presets use the business timezone, not the browser's.
  today: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const cleanerId = searchParams.get("cleanerId") ?? "";
  const ownerId = searchParams.get("ownerId") ?? "";
  const status = searchParams.get("status") ?? "unpaid";

  // Set/delete multiple keys in one navigation — presets need to update
  // from+to together without one push clobbering the other.
  function updateParams(entries: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(entries)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    router.push(`/admin/billing?${params.toString()}`);
  }

  function updateParam(key: string, value: string | null) {
    updateParams({ [key]: value });
  }

  // Clamp inverted ranges client-side: dragging one end of the range past the
  // other moves both, instead of letting the server-side swap (page.tsx)
  // silently make a typed value jump into the other box.
  function onFromChange(v: string) {
    if (v && v > to) {
      updateParams({ from: v, to: v });
    } else {
      updateParam("from", v || null);
    }
  }

  function onToChange(v: string) {
    if (v && v < from) {
      updateParams({ from: v, to: v });
    } else {
      updateParam("to", v || null);
    }
  }

  const thisMonday = mondayOf(today);
  const presets = [
    { label: "This week", from: thisMonday, to: addDays(thisMonday, 6) },
    { label: "Last week", from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
    { label: "Last 7 days", from: addDays(today, -6), to: today },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
  ];

  return (
    <div className="filters">
      <select value={cleanerId} onChange={(e) => updateParam("cleanerId", e.target.value || null)}>
        <option value="">All cleaners</option>
        {cleaners.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={ownerId} onChange={(e) => updateParam("ownerId", e.target.value || null)}>
        <option value="">All owners</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select value={status} onChange={(e) => updateParam("status", e.target.value || null)}>
        <option value="unpaid">Owing</option>
        <option value="paid">Settled</option>
        <option value="">All</option>
      </select>
      <label style={{ padding: 0, border: "none", background: "none" }}>
        From
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          style={{
            fontSize: "13px",
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid var(--line)",
            background: "#fff",
            color: "var(--ink)",
            marginLeft: "6px",
          }}
        />
      </label>
      <label style={{ padding: 0, border: "none", background: "none" }}>
        To
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          style={{
            fontSize: "13px",
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid var(--line)",
            background: "#fff",
            color: "var(--ink)",
            marginLeft: "6px",
          }}
        />
      </label>
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          className={`preset${p.from === from && p.to === to ? " on" : ""}`}
          onClick={() => updateParams({ from: p.from, to: p.to })}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
