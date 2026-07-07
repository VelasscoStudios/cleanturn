"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Option = { id: string; name: string };

export default function BillingFilters({ owners }: { owners: Option[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const ownerId = searchParams.get("ownerId") ?? "";
  const status = searchParams.get("status") ?? "unpaid";
  const month = searchParams.get("month") ?? "";

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`/admin/billing?${params.toString()}`);
  }

  return (
    <div className="filters">
      <select value={ownerId} onChange={(e) => updateParam("ownerId", e.target.value || null)}>
        <option value="">All owners</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select value={status} onChange={(e) => updateParam("status", e.target.value || null)}>
        <option value="unpaid">Unpaid</option>
        <option value="paid">Paid</option>
        <option value="">All</option>
      </select>
      <label style={{ padding: 0, border: "none", background: "none" }}>
        <input
          type="month"
          value={month}
          onChange={(e) => updateParam("month", e.target.value || null)}
          style={{
            fontSize: "13px",
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid var(--line)",
            background: "#fff",
            color: "var(--ink)",
          }}
        />
      </label>
    </div>
  );
}
