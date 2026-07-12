"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/client";
import { STRINGS, type Lang, type Strings } from "./translations";

type MyJob = {
  id: string;
  date: string;
  status: "assigned" | "in_progress" | "completed" | "cancelled";
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

function fmtDayLocal(d: string, locale: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat(locale, {
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
  in_progress: "completed",
};

const ACTION_LABEL_KEY: Record<string, keyof Strings> = {
  assigned: "actionArrived",
  in_progress: "actionClean",
};

const ACTION_CLASS: Record<string, string> = {
  assigned: "arrive",
  in_progress: "clean",
};

function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (lang: Lang) => void;
}) {
  const btn = (value: Lang, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={lang === value}
      style={{
        border: "1px solid rgba(255,255,255,0.5)",
        background: lang === value ? "rgba(255,255,255,0.9)" : "transparent",
        color: lang === value ? "#333" : "inherit",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 7px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {btn("en", "EN")}
      {btn("uk", "УКР")}
    </div>
  );
}

export function MyJobsView({
  cleanerName,
  initialLanguage,
}: {
  cleanerName: string;
  initialLanguage: Lang;
}) {
  const [jobs, setJobs] = useState<MyJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const t = STRINGS[lang];

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ jobs: MyJob[] }>("/api/my/jobs");
      setJobs(res.jobs);
      setError(null);
    } catch {
      setError("loadError");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changeLanguage(next: Lang) {
    if (next === lang) return;
    const prev = lang;
    // Optimistic — flip the UI now, persist in the background.
    setLang(next);
    try {
      await apiFetch("/api/my/language", {
        method: "PATCH",
        body: { language: next },
      });
    } catch {
      setLang(prev);
      setError("actionError");
    }
  }

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
      setError("actionError");
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

  // Errors are stored as translation keys so they re-render in the right
  // language if the cleaner flips the toggle while one is showing.
  const errorText =
    error === "loadError" ? t.loadError : error === "actionError" ? t.actionError : error;

  if (jobs === null && !error) {
    return (
      <div className="cleaner-wrap">
        <div style={{ width: 375, maxWidth: "100%" }}>
          <div className="phone">
            <div className="phone-head">
              <h2>{t.hi(cleanerName)}</h2>
              <p>{t.loading}</p>
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <h2>{t.hi(cleanerName)}</h2>
              <LangToggle lang={lang} onChange={changeLanguage} />
            </div>
            <p>{t.headline(todays.length, upcoming.length)}</p>
          </div>
          <div className="phone-body">
            {errorText && (
              <div className="alert" style={{ marginBottom: 12 }}>
                {errorText}
              </div>
            )}

            {todays.length === 0 && upcoming.length === 0 && !error && (
              <div className="empty-state">
                {t.emptyLine1}
                <br />
                {t.emptyLine2}
              </div>
            )}

            {todays.length > 0 && (
              <>
                <div className="section-label">{t.today}</div>
                {todays.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    isToday
                    busy={busyId === j.id}
                    onAdvance={() => advance(j)}
                    t={t}
                  />
                ))}
              </>
            )}

            {upcoming.length > 0 && (
              <>
                <div className="section-label">{t.upcoming}</div>
                {upcoming.map((j) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    isToday={false}
                    busy={false}
                    onAdvance={() => {}}
                    t={t}
                  />
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
            {t.logout}
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
  t,
}: {
  job: MyJob;
  isToday: boolean;
  busy: boolean;
  onAdvance: () => void;
  t: Strings;
}) {
  const p = job.property;
  // Only trust an http(s) mapsUrl as an href; otherwise fall back to a Maps
  // query. Defense-in-depth against a stored javascript:/data: URL becoming a
  // clickable XSS sink even if it slipped past input validation.
  const safeMapsUrl =
    p.mapsUrl && /^https?:\/\//i.test(p.mapsUrl) ? p.mapsUrl : null;
  const mapsHref = safeMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(p.address)}`;

  let actionEl: React.ReactNode = null;
  if (isToday) {
    if (job.status === "completed") {
      actionEl = (
        <button className="action-btn completed" disabled>
          {t.completed}
        </button>
      );
    } else if (ACTION_LABEL_KEY[job.status]) {
      const label = t[ACTION_LABEL_KEY[job.status]] as string;
      actionEl = (
        <button
          className={`action-btn ${ACTION_CLASS[job.status]}`}
          onClick={onAdvance}
          disabled={busy}
        >
          {busy ? t.saving : label}
        </button>
      );
    }
  } else {
    actionEl = (
      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
        {t.scheduledFor(fmtDayLocal(job.date, t.dateLocale))}
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
        ⏰ {t.arrive} <b>{p.arriveTime}</b> {t.mustBeOutBy} <b>{p.outByTime}</b>
      </div>
      {job.sameDayTurnover && (
        <div className="flagline">
          <span className="flag">
            {t.sameDayTurnover}
            {job.nextCheckinNote ? ` — ${job.nextCheckinNote}` : ""}
          </span>
        </div>
      )}
      <div className="notes">
        🧭 <b>{t.directions}</b> {p.directions || "—"}
        <br />
        {p.accessCode !== undefined && (
          <>
            🔑 <b>{t.access}</b> {p.accessCode || "—"}
            <br />
          </>
        )}
        📝 {p.notes || "—"}
      </div>
      {actionEl}
    </div>
  );
}
