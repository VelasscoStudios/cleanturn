"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/client";

type MyJob = {
  id: string;
  date: string;
  status: "unassigned" | "assigned" | "in_progress" | "awaiting_confirm" | "done" | "cancelled";
  costCents: number;
  sameDayTurnover: boolean;
  nextCheckinNote: string | null;
  property: {
    nickname: string;
    address: string;
    mapsUrl: string | null;
    directions: string;
    notes: string;
    arriveTime: string;
    outByTime: string;
    accessCode?: string;
  };
};

function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function fmtDayLocal(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function todayStrLocal(): string {
  // Best-effort client mirror of lib/dates.ts todayStr(); server is
  // authoritative for what "today" means for visibility/access-code rules —
  // this is only used to decide Today vs Upcoming grouping in the UI.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

const NEXT_ACTION: Partial<Record<MyJob["status"], MyJob["status"]>> = {
  assigned: "in_progress",
  in_progress: "awaiting_confirm",
  awaiting_confirm: "done",
};

const ACTION_LABEL: Record<string, string> = {
  assigned: "🚗 I've arrived",
  in_progress: "🚪 I've left",
  awaiting_confirm: "✨ Unit is clean",
};

const ACTION_CLASS: Record<string, string> = {
  assigned: "arrive",
  in_progress: "leave",
  awaiting_confirm: "clean",
};

export function MyJobsView({ cleanerName }: { cleanerName: string }) {
  const [jobs, setJobs] = useState<MyJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ jobs: MyJob[] }>("/api/my/jobs");
      setJobs(res.jobs);
      setError(null);
    } catch {
      setError("Couldn't load your jobs. Pull down to try again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function advance(job: MyJob) {
    const next = NEXT_ACTION[job.status];
    if (!next || busyId) return;

    setBusyId(job.id);
    const prevJobs = jobs;
    // Optimistic update
    setJobs((cur) =>
      (cur ?? []).map((j) => (j.id === job.id ? { ...j, status: next } : j))
    );

    try {
      await apiFetch(`/api/jobs/${job.id}/status`, {
        method: "PATCH",
        body: { status: next },
      });
      // Re-sync from server (access code visibility etc. may change).
      await load();
    } catch {
      setJobs(prevJobs ?? null);
      setError("That didn't go through — try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  if (jobs === null && !error) {
    return (
      <div className="cleaner-wrap">
        <div style={{ width: 375, maxWidth: "100%" }}>
          <div className="phone">
            <div className="phone-head">
              <h2>Hi {cleanerName}</h2>
              <p>Loading your cleans…</p>
            </div>
            <div className="phone-body" />
          </div>
        </div>
      </div>
    );
  }

  const today = todayStrLocal();
  const list = jobs ?? [];
  const todays = list.filter((j) => j.date === today);
  const upcoming = list
    .filter((j) => j.date > today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="cleaner-wrap">
      <div style={{ width: 375, maxWidth: "100%" }}>
        <div className="phone">
          <div className="phone-head">
            <h2>Hi {cleanerName}</h2>
            <p>
              {todays.length} clean{todays.length !== 1 ? "s" : ""} today · {upcoming.length}{" "}
              upcoming
            </p>
          </div>
          <div className="phone-body">
            {error && (
              <div className="alert" style={{ marginBottom: 12 }}>
                {error}
              </div>
            )}

            {todays.length === 0 && upcoming.length === 0 && !error && (
              <div className="empty-state">
                🎉 No cleans assigned.
                <br />
                Enjoy the day off!
              </div>
            )}

            {todays.length > 0 && (
              <>
                <div className="section-label">Today</div>
                {todays.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    isToday
                    busy={busyId === j.id}
                    onAdvance={() => advance(j)}
                  />
                ))}
              </>
            )}

            {upcoming.length > 0 && (
              <>
                <div className="section-label">Upcoming</div>
                {upcoming.map((j) => (
                  <JobCard key={j.id} job={j} isToday={false} busy={false} onAdvance={() => {}} />
                ))}
              </>
            )}
          </div>
        </div>
        <div style={{ textAlign: "center", marginTop: 14 }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              logout();
            }}
            style={{ fontSize: 13, color: "var(--muted)", textDecoration: "underline" }}
          >
            Log out
          </a>
        </div>
      </div>
    </div>
  );
}

function JobCard({
  job,
  isToday,
  busy,
  onAdvance,
}: {
  job: MyJob;
  isToday: boolean;
  busy: boolean;
  onAdvance: () => void;
}) {
  const p = job.property;
  const mapsHref = p.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(p.address)}`;

  let actionEl: React.ReactNode = null;
  if (isToday) {
    if (job.status === "done") {
      actionEl = (
        <button className="action-btn done" disabled>
          ✅ Done — nice work!
        </button>
      );
    } else if (ACTION_LABEL[job.status]) {
      actionEl = (
        <button
          className={`action-btn ${ACTION_CLASS[job.status]}`}
          onClick={onAdvance}
          disabled={busy}
        >
          {busy ? "Saving…" : ACTION_LABEL[job.status]}
        </button>
      );
    }
  } else {
    actionEl = (
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
        Scheduled for {fmtDayLocal(job.date)}
      </div>
    );
  }

  return (
    <div className="ccard">
      <div className="prop">
        {p.nickname}
        <span style={{ float: "right", color: "var(--green)", fontSize: 15 }}>
          {formatCents(job.costCents)}
        </span>
      </div>
      <a
        className="addr"
        href={mapsHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "block" }}
      >
        📍 {p.address}
      </a>
      <div className="window">
        ⏰ Arrive <b>{p.arriveTime}</b> — must be out by <b>{p.outByTime}</b>
      </div>
      {job.sameDayTurnover && (
        <div className="flagline">
          <span className="flag">
            ⚡ Same-day turnover
            {job.nextCheckinNote ? ` — ${job.nextCheckinNote}` : ""}
          </span>
        </div>
      )}
      <div className="notes">
        🧭 <b>Directions:</b> {p.directions || "—"}
        <br />
        {p.accessCode !== undefined && (
          <>
            🔑 <b>Access:</b> {p.accessCode || "—"}
            <br />
          </>
        )}
        📝 {p.notes || "—"}
      </div>
      {actionEl}
    </div>
  );
}
