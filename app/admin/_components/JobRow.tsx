"use client";

import { useState } from "react";
import AssignSelect from "./AssignSelect";
import { formatCents } from "./format";

type Cleaner = { id: string; name: string };

export type JobRowData = {
  id: string;
  arriveTime: string;
  outByTime: string;
  nickname: string;
  address: string;
  accessCode: string;
  directions: string;
  costCents: number;
  status: string;
  cleanerId: string | null;
  cleanerName: string | null;
  sameDayTurnover: boolean;
  nextCheckinNote: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  in_progress: "In progress",
  awaiting_confirm: "Awaiting",
  done: "Done ✅",
  cancelled: "Cancelled",
};

const STATUS_CHIP_CLASS: Record<string, string> = {
  unassigned: "unassigned",
  assigned: "assigned",
  in_progress: "in_progress",
  awaiting_confirm: "awaiting",
  done: "done",
  cancelled: "cancelled",
};

// One dense schedule row. Click anywhere on the row (except the assign
// dropdown) to expand the address / access code / directions detail line.
export default function JobRow({ job, cleaners }: { job: JobRowData; cleaners: Cleaner[] }) {
  const [open, setOpen] = useState(false);
  const unassigned = !job.cleanerId && job.status !== "cancelled";

  return (
    <>
      <tr
        className={`srow ${unassigned ? "unassigned" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="c-caret">{open ? "▾" : "▸"}</td>
        <td className="c-time">{job.arriveTime}</td>
        <td className="c-prop">
          <span className="nick">{job.nickname}</span>
          {job.sameDayTurnover && (
            <span className="flag mini" title="Same-day turnover">
              ⚡{job.nextCheckinNote ? ` ${job.nextCheckinNote}` : ""}
            </span>
          )}
        </td>
        <td className="c-cost">{formatCents(job.costCents)}</td>
        {/* Stop propagation so using the dropdown doesn't also toggle the row. */}
        <td className="c-assign" onClick={(e) => e.stopPropagation()}>
          <AssignSelect
            jobId={job.id}
            cleanerId={job.cleanerId}
            cleanerName={job.cleanerName}
            cleaners={cleaners}
          />
        </td>
        <td className="c-status">
          <span className={`chip ${STATUS_CHIP_CLASS[job.status] ?? job.status}`}>
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="srow-detail">
          <td />
          <td colSpan={5}>
            <div className="detail">
              <span>⏰ {job.arriveTime} → out by {job.outByTime}</span>
              <span>📍 {job.address || "—"}</span>
              <span>🔑 {job.accessCode || "—"}</span>
              {job.directions ? <span>🧭 {job.directions}</span> : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
