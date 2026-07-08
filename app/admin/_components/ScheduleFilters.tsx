"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Option = { id: string; name: string };

export default function ScheduleFilters({
  properties,
  cleaners,
}: {
  properties: Option[];
  cleaners: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const propertyId = searchParams.get("propertyId") ?? "";
  const cleanerId = searchParams.get("cleanerId") ?? "";
  const unassigned = searchParams.get("unassigned") === "true";
  const days = searchParams.get("days") ?? "7";
  const status = searchParams.get("status") ?? "";

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`/admin?${params.toString()}`);
  }

  return (
    <div className="filters">
      <select
        value={propertyId}
        onChange={(e) => updateParam("propertyId", e.target.value || null)}
      >
        <option value="">All properties</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select
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
      <select
        value={days}
        onChange={(e) => updateParam("days", e.target.value === "7" ? null : e.target.value)}
      >
        <optgroup label="Upcoming">
          <option value="7">Next 7 days</option>
          <option value="14">Next 14 days</option>
          <option value="30">Next 30 days</option>
          <option value="90">Next 90 days</option>
          <option value="365">Next 12 months</option>
          <option value="all">All upcoming</option>
        </optgroup>
        <optgroup label="History">
          <option value="-7">Past 7 days</option>
          <option value="-30">Past 30 days</option>
          <option value="-90">Past 90 days</option>
          <option value="past">All past</option>
        </optgroup>
      </select>
      <select
        value={status}
        onChange={(e) => updateParam("status", e.target.value || null)}
      >
        <option value="">All statuses</option>
        <option value="unassigned">Unassigned</option>
        <option value="assigned">Assigned</option>
        <option value="in_progress">In progress</option>
        <option value="awaiting_confirm">Awaiting confirm</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <label>
        <input
          type="checkbox"
          checked={unassigned}
          onChange={(e) => updateParam("unassigned", e.target.checked ? "true" : null)}
        />
        Unassigned only
      </label>
    </div>
  );
}
