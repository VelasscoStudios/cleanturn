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
  notes: { id: string; body: string; date: string | null }[];
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
  const [tab, setTab] = useState<"jobs" | "history">("jobs");
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
            <p>
              {tab === "jobs"
                ? t.headline(todays.length, upcoming.length)
                : t.historySubhead}
            </p>
          </div>
          <div className="phone-tabs">
            <button
              type="button"
              className={`ptab ${tab === "jobs" ? "active" : ""}`}
              onClick={() => setTab("jobs")}
              aria-pressed={tab === "jobs"}
            >
              {t.myJobsTab}
            </button>
            <button
              type="button"
              className={`ptab ${tab === "history" ? "active" : ""}`}
              onClick={() => setTab("history")}
              aria-pressed={tab === "history"}
            >
              {t.historyTab}
            </button>
          </div>
          {tab === "history" ? (
            <HistoryView t={t} />
          ) : jobs === null && !error ? (
            <div className="phone-body">
              <div className="empty-state">{t.loading}</div>
            </div>
          ) : (
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
          )}
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
      {job.notes.length > 0 && (
        <div className="admin-notes">
          📌 <b>{t.adminNotes}</b>
          {job.notes.map((n) => (
            <div key={n.id} className="note-item">
              {n.body}
            </div>
          ))}
        </div>
      )}
      {actionEl}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab: a cleaner's own completed cleans, browsable by month.
// ---------------------------------------------------------------------------

type HistJob = {
  id: string;
  date: string;
  costCents: number;
  arrivedAt: string | null;
  cleanedAt: string | null;
  property: { nickname: string; address: string; mapsUrl: string | null };
};

type HistoryResponse = {
  month: string;
  jobs: HistJob[];
  summary: { count: number; totalCents: number };
  availableMonths: string[];
};

/** Format an ISO timestamp as a local HH:MM, or null if absent/invalid. */
function fmtTimeLocal(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Long month name (e.g. "July" / "Липень") for a YYYY-MM string. */
function monthName(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long" }).format(dt);
}

function HistoryView({ t }: { t: Strings }) {
  const [month, setMonth] = useState<string>(() => todayStrLocal().slice(0, 7));
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<HistoryResponse>(`/api/my/history?month=${m}`);
      setData(res);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
  }, [load, month]);

  const [yy, mm] = month.split("-").map(Number);

  // Offer every year the cleaner actually has history in, plus the selected and
  // current years (so the picker is never empty before data loads).
  const currentYear = Number(todayStrLocal().slice(0, 4));
  const years = Array.from(
    new Set<number>([
      currentYear,
      yy,
      ...(data?.availableMonths ?? []).map((ym) => Number(ym.slice(0, 4))),
    ])
  ).sort((a, b) => b - a);

  const setYear = (y: number) => setMonth(`${y}-${String(mm).padStart(2, "0")}`);
  const setMonthNum = (m: number) => setMonth(`${yy}-${String(m).padStart(2, "0")}`);
  const step = (delta: number) => {
    const dt = new Date(Date.UTC(yy, mm - 1 + delta, 1, 12, 0, 0));
    setMonth(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="phone-body">
      <div className="monthbar">
        <button type="button" className="mstep" onClick={() => step(-1)} aria-label={t.prevMonth}>
          ‹
        </button>
        <div className="msel">
          <div className="sel">
            <select
              aria-label={t.monthLabel}
              value={mm}
              onChange={(e) => setMonthNum(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(`${yy}-${String(m).padStart(2, "0")}`, t.dateLocale)}
                </option>
              ))}
            </select>
          </div>
          <div className="sel">
            <select
              aria-label={t.yearLabel}
              value={yy}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" className="mstep" onClick={() => step(1)} aria-label={t.nextMonth}>
          ›
        </button>
      </div>

      {error && (
        <div className="alert" style={{ marginBottom: 12 }}>
          {t.loadError}
        </div>
      )}

      {!error && (
        <>
          <div className="summary">
            <div className="stat">
              <div className="k">{t.cleansLabel}</div>
              <div className="v">{loading ? "…" : data?.summary.count ?? 0}</div>
            </div>
            <div className="stat">
              <div className="k">{t.totalLabel}</div>
              <div className="v money">
                {loading ? "…" : formatCents(data?.summary.totalCents ?? 0)}
              </div>
            </div>
          </div>

          {!loading && (data?.jobs.length ?? 0) === 0 && (
            <div className="empty-state">{t.historyEmpty}</div>
          )}

          {(data?.jobs ?? []).map((j) => (
            <HistoryCard key={j.id} job={j} t={t} />
          ))}
        </>
      )}
    </div>
  );
}

function HistoryCard({ job, t }: { job: HistJob; t: Strings }) {
  const arrived = fmtTimeLocal(job.arrivedAt, t.dateLocale);
  const done = fmtTimeLocal(job.cleanedAt, t.dateLocale);
  return (
    <div className="hcard">
      <div className="hcard-top">
        <span className="hprop">{job.property.nickname}</span>
        <span className="hcost">{formatCents(job.costCents)}</span>
      </div>
      <div className="hdate">{fmtDayLocal(job.date, t.dateLocale)}</div>
      {arrived && done && (
        <div className="hmeta">
          {t.arrivedLabel} {arrived} · {t.doneLabel} {done}
        </div>
      )}
    </div>
  );
}
